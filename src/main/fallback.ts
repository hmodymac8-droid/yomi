import { getSource, openSeries, search, seriesLinks, sourceDefs, sourceForHost, updateSource } from './catalog'
import { grabChapterFast } from './fastgrab'
import { openSpeedOf, peekOutage, recordSpeed, speedOf, writeOutage } from './health'
import { pinnedSite } from './pins'
import type { SeriesStart, SiteSpeed } from '../preload/index.d'
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

/** The language a site is written in, when known. */
export function langOf(id: string): 'ar' | 'en' | 'other' | undefined {
  return getSource(id)?.lang
}

/** Two sites can stand in for each other: same language, or one of them not known yet. */
export function sameLang(a: string, b: string): boolean {
  const la = langOf(a)
  const lb = langOf(b)
  return !la || !lb || la === lb
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
  // the site being read stands first in excludeIds: a stand-in is in the same language (no English chapter in an
  // Arabic read)
  const reading = excludeIds[0]
  const cands = found.entries
    .filter((e) => !exclude.has(e.sourceId) && (!reading || sameLang(reading, e.sourceId)))
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

/** How a site is doing for the "Read from" buttons: a speed dot and its typical chapter-open time. */
export function siteSpeed(id: string): SiteSpeed {
  const ms = openSpeedOf(id)
  const src = getSource(id)
  const label: SiteSpeed['label'] = isOut(src?.availability)
    ? 'trouble'
    : ms === undefined
      ? 'new'
      : ms < 2000
        ? 'fast'
        : ms < 5000
          ? 'ok'
          : 'slow'
  return { label, ms, lang: src?.lang }
}

/**
 * Which site a series page opens from: the site you picked for it, else the one you last read it on, else the
 * fastest healthy one (the same order a fallback uses). A series that comes in with one site (from Following or
 * Continue reading) first picks up the same title on your other sites; with no pick and nothing read it stays on
 * the site it came from.
 */
export function seriesStart(
  title: string,
  given: { sourceId: string; sourceName: string; url: string }[]
): SeriesStart {
  let entries = given
  const single = given.length === 1
  if (single) {
    const links = seriesLinks(given[0].url)
    if (links.length > 1) entries = links
  }
  const speeds: Record<string, SiteSpeed> = {}
  for (const e of entries) speeds[e.sourceId] ??= siteSpeed(e.sourceId)
  const pin = pinnedSite(title)
  const pinned = entries.find((e) => e.sourceId === pin)
  if (entries.length < 2) return { entries, start: entries[0]?.url ?? '', pinned: pinned?.sourceId, speeds }
  const cands = entries.map((e) => {
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
  const ranked = rankAlternatives(cands, cands.length)
  const readAny = cands.some((c) => c.lastReadAt > 0)
  // with no pick and nothing read, the fastest site in the language of the site it came from
  const lastRead = ranked.find((r) => (getProgress(r.url)?.updatedAt ?? 0) > 0)
  const sameAsCame = ranked.find((r) => sameLang(given[0].sourceId, r.sourceId))
  let start = pinned?.url ?? lastRead?.url ?? sameAsCame?.url ?? ranked[0]?.url ?? entries[0].url
  if (single && !pinned && !readAny) start = given[0].url
  // the sites are listed best first; ones left out of the ranking (down, Comix) go last
  const order = [...ranked.map((r) => r.url), ...entries.map((e) => e.url)]
  const sorted = [...entries].sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url))
  return { entries: sorted, start, pinned: pinned?.sourceId, speeds }
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
