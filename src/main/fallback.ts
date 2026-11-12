import { getSource, openSeries, search, sourceDefs, sourceForHost, updateSource } from './catalog'
import { grabChapterFast } from './fastgrab'
import { peekOutage, recordSpeed, speedOf, writeOutage } from './health'
import { pinnedSite } from './pins'
import { getProgress } from './progress'
import {
  applyFailure,
  applyRecovery,
  chapterNumber,
  classifyFailure,
  isBlockedSource,
  isOut,
  normalizeTitle,
  noteCandidate,
  rankAlternatives,
  sameSiteHost,
  writeSourceStatus,
  type Availability,
  type FailureKind,
  type FallbackPick
} from './repair'

export interface SourceState {
  availability: Availability
  name: string
  baseUrl: string
  reason?: string
}

function blocked(id: string): boolean {
  const src = getSource(id)
  return isBlockedSource(id, src?.baseUrl)
}

/** Current status from the source row (catalog.json), which is what the next request uses. */
export function sourceState(id: string): SourceState {
  const s = getSource(id)
  const availability =
    s?.availability === 'down' || s?.availability === 'degraded' ? s.availability : 'ok'
  return {
    availability,
    name: s?.name ?? id,
    baseUrl: s?.baseUrl ?? '',
    reason: s?.availabilityReason
  }
}

/**
 * Mark a source degraded or down, remember why, and save that on the source row. The same failure
 * reported twice in a minute (the grab and the screen both notice it) is recorded once.
 * Comix is never marked: it stays out of automatic repair, as it stays out of the daily re-check.
 */
export function commitFailure(
  id: string,
  kind: FailureKind,
  detail: string
): { kind: FailureKind; availability: Availability; outOfRotation: boolean } {
  if (!id || kind === 'none' || blocked(id)) {
    const availability = sourceState(id).availability
    return { kind: 'none', availability, outOfRotation: isOut(availability) }
  }
  const applied = applyFailure(peekOutage(id), kind, detail, Date.now(), Math.random())
  if (applied.changed) {
    writeOutage(id, applied.state)
    updateSource(id, (src) =>
      writeSourceStatus(
        src,
        applied.state.availability,
        applied.state.failedAt ?? Date.now(),
        applied.state.reason
      )
    )
  }
  return {
    kind,
    availability: applied.state.availability,
    outOfRotation: isOut(applied.state.availability)
  }
}

/** The address answered. Put the source back in rotation. No-op when it was already healthy. */
export function commitRecovery(id: string, reason: string): void {
  if (!id || blocked(id)) return
  const prev = peekOutage(id)
  if (!isOut(prev.availability) && !prev.candidateOrigin) return
  const next = applyRecovery(prev, reason, Date.now())
  writeOutage(id, next)
  updateSource(id, (src) => writeSourceStatus(src, 'ok', Date.now()))
}

export function rememberCandidate(id: string, origin: string): void {
  if (!id || blocked(id)) return
  const prev = peekOutage(id)
  const next = noteCandidate(prev, origin, Date.now())
  if (next === prev || next.candidateOrigin === prev.candidateOrigin) return
  writeOutage(id, next)
}

/** Called when a chapter fetch finishes. A real outage takes the source out; a new host is only noted. */
export function onSourceSignal(s: {
  url: string
  ok: boolean
  landed?: string
  error?: string
}): void {
  const src = sourceForHost(s.url)
  if (!src || blocked(src.id)) return
  if (s.ok) {
    if (isOut(src.availability) && sameSiteHost(s.url, src.baseUrl)) {
      commitRecovery(src.id, 'A chapter loaded again')
    }
    if (s.landed && !sameSiteHost(s.landed, src.baseUrl)) rememberCandidate(src.id, s.landed)
    return
  }
  const kind = classifyFailure(s.error ?? '')
  if (kind === 'none') return
  commitFailure(src.id, kind, s.error || kind)
}

export function reportFailure(
  id: string,
  message: string
): { kind: FailureKind; availability: Availability; outOfRotation: boolean } {
  return commitFailure(id, classifyFailure(message), message)
}

/**
 * Other sites that have this title, already ordered: your pin, then the one you read last, then the
 * fastest healthy site. Down sites and Comix (unless you pinned it) are left out. At most 5.
 */
export function listFallbackSites(title: string, excludeIds: string[]): FallbackPick[] {
  const want = normalizeTitle(title)
  if (!want) return []
  const found = search(title, [], 'az', 0, 8).hits.find((h) => normalizeTitle(h.title) === want)
  if (!found) return []
  const pin = pinnedSite(title)
  const exclude = new Set(excludeIds)
  const cands = found.entries
    .filter((e) => !exclude.has(e.sourceId))
    .map((e) => {
      const src = getSource(e.sourceId)
      return {
        sourceId: e.sourceId,
        sourceName: e.sourceName,
        url: e.url,
        pinned: e.sourceId === pin,
        lastReadAt: getProgress(e.url)?.updatedAt ?? 0,
        speedMs: speedOf(e.sourceId),
        availability: src?.availability,
        blocked: isBlockedSource(e.sourceId, src?.baseUrl ?? e.url)
      }
    })
  return rankAlternatives(cands, 5)
}

/**
 * The same chapter (same number) on another site. Used by the download queue so a dead source
 * doesn't stop the rest of the queue. Null when nothing else has that chapter.
 */
export async function pagesFromFallback(item: {
  sourceId: string
  seriesTitle: string
  chapterTitle: string
}): Promise<{ pages: string[]; referer: string; notice: string } | null> {
  if (chapterNumber(item.chapterTitle) === null) return null
  const num = chapterNumber(item.chapterTitle)
  const sites = listFallbackSites(item.seriesTitle, [item.sourceId])
  const here = getSource(item.sourceId)?.name ?? item.sourceId
  for (const site of sites) {
    let chapters: { title: string; url: string; alts?: string[] }[]
    try {
      chapters = (await openSeries(site.sourceId, site.url)).chapters
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const kind = classifyFailure(message)
      if (kind !== 'none') commitFailure(site.sourceId, kind, message)
      continue
    }
    const ch = chapters.find((c) => chapterNumber(c.title) === num)
    if (!ch) continue
    for (const u of [ch.url, ...(ch.alts ?? [])]) {
      try {
        const g = await grabChapterFast(u)
        if (g.pages.length > 0) {
          return {
            pages: g.pages,
            referer: new URL(site.url).origin + '/',
            notice: `From ${site.sourceName} — ${here} didn't load`
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const kind = classifyFailure(message)
        if (kind !== 'none') commitFailure(site.sourceId, kind, message)
      }
    }
  }
  return null
}

/** A full re-check agrees with the repair record: healthy puts the site back, a real failure takes it out. */
export function recordCheckOutcome(
  id: string,
  overall: 'ok' | 'warn' | 'fail',
  steps: { status: string; detail: string; ms: number }[]
): void {
  if (blocked(id)) return
  if (overall === 'ok') {
    const ms = steps.reduce((n, s) => n + s.ms, 0)
    if (ms > 0) recordSpeed(id, ms)
    commitRecovery(id, 'Re-check succeeded')
    return
  }
  const failed = steps.find((s) => s.status === 'fail')
  if (!failed) return
  const kind = classifyFailure(failed.detail)
  if (kind === 'none') return
  commitFailure(id, kind, failed.detail)
}

/**
 * catalog.json is the status the app reads; site-health.json is the history and the probe schedule.
 * After a crash between the two writes, trust the source row and give the prober a time to try.
 */
export function reconcileRepair(): void {
  for (const s of sourceDefs()) {
    if (isBlockedSource(s.id, s.baseUrl)) continue
    const peek = peekOutage(s.id)
    const want = s.availability === 'down' || s.availability === 'degraded' ? s.availability : 'ok'
    if (want === 'ok' && isOut(peek.availability)) {
      writeOutage(s.id, applyRecovery(peek, 'Saved source is healthy', Date.now()))
    } else if (want !== 'ok' && peek.availability !== want) {
      const seeded = applyFailure(
        peek,
        'network',
        s.availabilityReason || 'Marked down',
        s.availabilityAt ?? Date.now(),
        Math.random()
      )
      writeOutage(s.id, {
        ...seeded.state,
        availability: want,
        reason: s.availabilityReason || seeded.state.reason
      })
    }
  }
}
