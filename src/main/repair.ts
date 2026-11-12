/**
 * Decides what to do when a source address fails, which other site to read from, and when to try the
 * broken address again. No files and no network here: the main process applies these decisions and
 * saves them (see fallback.ts). Comix is left out of every automatic choice unless the user pinned it.
 */

export type FailureKind = 'network' | 'http' | 'timeout' | 'cloudflare' | 'moved' | 'none'
export type Availability = 'ok' | 'degraded' | 'down'

export interface HealthEvent {
  at: number
  availability: Availability
  reason: string
  kind: FailureKind | 'restored' | 'relocated'
}

export interface ProbeSample {
  status: number
  html: string
  finalUrl: string
  error?: string
}

export interface ProbeVerdict {
  up: boolean
  kind: FailureKind
  /** Origin that answered, when it is a different site host from the one we asked. */
  movedTo?: string
  detail: string
}

export interface OutageState {
  availability: Availability
  reason?: string
  failedAt?: number
  probeAttempt: number
  nextProbeAt?: number
  history: HealthEvent[]
  /** A host a real chapter was served from. The prober checks it before giving up on a move. */
  candidateOrigin?: string
  speedMs?: number
}

export interface AltCandidate {
  sourceId: string
  sourceName: string
  url: string
  pinned: boolean
  lastReadAt: number
  speedMs?: number
  availability?: Availability
  blocked: boolean
}

export interface FallbackPick {
  sourceId: string
  sourceName: string
  url: string
}

export interface Rotatable {
  id: string
  baseUrl?: string
  availability?: Availability
}

/** First retry is a couple of minutes; later ones spread out to a day. */
export const PROBE_BACKOFF_MS = [
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 3600_000,
  6 * 3600_000,
  24 * 3600_000
]

export const HISTORY_KEEP = 8
const DEDUPE_MS = 60_000
const STRIKE_WINDOW_MS = 6 * 3600_000

const CHALLENGE =
  /just a moment|attention required|cf-browser-verification|cf-chl|challenge-platform|enable javascript and cookies|checking your browser|verify you are human|ddos-guard|security verification/i
const PARKED =
  /domain (?:is )?for sale|buy this domain|hugedomains|sedoparking|this webpage is parked|domain parking/i
const BAD_MOVE = /(^|\.)(google|gstatic|facebook|cloudflare|akamai|doubleclick|amazonaws)\./i

const KINDS: readonly FailureKind[] = ['network', 'http', 'timeout', 'cloudflare', 'moved']

export function emptyOutage(): OutageState {
  return { availability: 'ok', probeAttempt: 0, history: [] }
}

export function isOut(availability: Availability | undefined): boolean {
  return availability === 'down' || availability === 'degraded'
}

/** Comix stays out of automatic re-checks and automatic fallback. A pin still wins. */
export function isBlockedSource(id: string, baseUrl?: string): boolean {
  return /comix/i.test(id) || /comix\.to/i.test(baseUrl ?? '')
}

export function bareHost(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase()
}

export function originOf(url: string): string {
  return new URL(url).origin
}

export function sameSiteHost(a: string, b: string): boolean {
  try {
    return bareHost(new URL(a).hostname) === bareHost(new URL(b).hostname)
  } catch {
    return false
  }
}

/** Same title key the catalog uses, so a pin lines up with a search group. */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Chapter number in a title ("Chapter 12.5", "Ep. 3", "الفصل 40"). Null when the title has no number,
 * so we don't guess and open the wrong chapter.
 */
export function chapterNumber(title: string): number | null {
  const t = title.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const m =
    t.match(/(?:chapter|chap|ch|episode|ep|الفصل|فصل|الحلقة)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)/i) ??
    t.match(/(\d+(?:\.\d+)?)(?!.*\d)/)
  return m ? Number(m[1]) : null
}

export function outageError(kind: FailureKind, detail: string): string {
  return `source unavailable (${kind}): ${detail}`
}

export function classifyFailure(message: string, status?: number): FailureKind {
  const msg = message || ''
  const tagged = /^source unavailable \(([a-z]+)\)/i.exec(msg)
  if (tagged && (KINDS as readonly string[]).includes(tagged[1])) return tagged[1] as FailureKind
  if (status === 429 || (status !== undefined && status >= 500 && status <= 599)) return 'http'
  if (CHALLENGE.test(msg) || /cloudflare/i.test(msg)) return 'cloudflare'
  if (/timed out|timeout|took too long|took longer|aborted|etimededout/i.test(msg)) return 'timeout'
  if (
    /enotfound|econnrefused|econnreset|eai_again|err_name_not_resolved|err_connection|err_internet|err_network|fetch failed|getaddrinfo|network error|socket hang/i.test(
      msg
    )
  )
    return 'network'
  if (/moved to|domain changed/i.test(msg)) return 'moved'
  if (/\b5\d\d\b/.test(msg) && /http|error|feed|status|answered/i.test(msg)) return 'http'
  return 'none'
}

function clip(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function isChallenge(html: string, status: number): boolean {
  if (CHALLENGE.test(html)) return true
  return (status === 403 || status === 503) && /cloudflare|cf-ray/i.test(html)
}

/**
 * What a single response means. A missing chapter (404) is not the site being down. The home page
 * answering 404, a 5xx, a timeout, a browser check, or a new host, is.
 */
export function interpretResponse(
  sample: ProbeSample,
  askedUrl: string,
  role: 'home' | 'chapter'
): ProbeVerdict {
  if (sample.error) {
    const kind = classifyFailure(sample.error)
    return { up: false, kind: kind === 'none' ? 'network' : kind, detail: clip(sample.error) }
  }
  const html = sample.html ?? ''
  const head = html.slice(0, 8000)
  if (isChallenge(head, sample.status)) {
    return { up: false, kind: 'cloudflare', detail: 'Blocked by a browser check' }
  }
  if (sample.status === 429) return { up: false, kind: 'http', detail: 'HTTP 429' }
  if (sample.status >= 500 && sample.status <= 599) {
    return { up: false, kind: 'http', detail: 'HTTP ' + sample.status }
  }
  if (role === 'chapter' && sample.status >= 400 && sample.status < 500) {
    return { up: false, kind: 'none', detail: 'HTTP ' + sample.status }
  }
  if (role === 'home' && sample.status >= 400 && sample.status < 500) {
    return { up: false, kind: 'http', detail: 'HTTP ' + sample.status }
  }
  if (PARKED.test(head)) {
    return { up: false, kind: 'http', detail: 'The address is a parked domain' }
  }
  let asked: URL | null
  let final: URL | null
  try {
    asked = new URL(askedUrl)
  } catch {
    asked = null
  }
  try {
    final = new URL(sample.finalUrl || askedUrl)
  } catch {
    final = null
  }
  const moved =
    !!asked &&
    !!final &&
    bareHost(asked.hostname) !== bareHost(final.hostname) &&
    !BAD_MOVE.test(final.hostname)
  const alive =
    sample.status === 200 && html.length > 80 && /<html|<!doctype|<title/i.test(head.slice(0, 800))
  if (alive && moved && final) {
    return { up: true, kind: 'moved', movedTo: final.origin, detail: 'Now at ' + final.origin }
  }
  if (alive) return { up: true, kind: 'none', detail: 'Answered' }
  if (moved && final && role === 'home') {
    return {
      up: false,
      kind: 'moved',
      detail: 'Redirected to ' + final.origin + ' but the page was not usable'
    }
  }
  return {
    up: false,
    kind: role === 'home' ? 'network' : 'none',
    detail: sample.status ? 'HTTP ' + sample.status : 'No usable page'
  }
}

export function interpretChapter(sample: ProbeSample, askedUrl: string): ProbeVerdict {
  return interpretResponse(sample, askedUrl, 'chapter')
}

/**
 * One timeout leaves the site degraded (still out of rotation, retried soon). A second failure, or a
 * hard failure (network, 5xx, browser check, new domain), marks it down.
 */
export function nextAvailability(
  kind: FailureKind,
  detail: string,
  priorStrikes: number,
  current: Availability
): Availability {
  if (kind === 'none') return current === 'ok' ? 'ok' : current
  if (/429/.test(detail) && priorStrikes < 2) return 'degraded'
  if (kind === 'timeout' && priorStrikes < 1 && current !== 'down') return 'degraded'
  return 'down'
}

/** ±20% so a row of sites doesn't get probed on the same second. `rand` is 0..1. */
export function probeDelay(attempt: number, rand: number): number {
  const base = PROBE_BACKOFF_MS[Math.min(Math.max(0, attempt), PROBE_BACKOFF_MS.length - 1)]
  const j = Math.min(1, Math.max(0, rand))
  return Math.round(base * (0.8 + j * 0.4))
}

function strikesOf(history: HealthEvent[], now: number): number {
  return history.filter((h) => h.availability !== 'ok' && now - h.at < STRIKE_WINDOW_MS).length
}

function pushHistory(history: HealthEvent[], event: HealthEvent): HealthEvent[] {
  const next = [...history, event]
  if (next.length <= HISTORY_KEEP) return next
  // Keep the first note (when it originally failed) and the newest ones.
  return [next[0], ...next.slice(next.length - (HISTORY_KEEP - 1))]
}

export function applyFailure(
  prev: OutageState | undefined,
  kind: FailureKind,
  detail: string,
  now: number,
  rand: number
): { state: OutageState; changed: boolean } {
  const state = prev ?? emptyOutage()
  if (kind === 'none') return { state, changed: false }
  const reason = clip(detail || kind)
  if (state.reason === reason && state.failedAt !== undefined && now - state.failedAt < DEDUPE_MS) {
    return { state, changed: false }
  }
  const availability = nextAvailability(
    kind,
    reason,
    strikesOf(state.history, now),
    state.availability
  )
  const attempt = state.probeAttempt
  const next: OutageState = {
    ...state,
    availability,
    reason,
    failedAt: now,
    probeAttempt: attempt + 1,
    nextProbeAt: now + probeDelay(attempt, rand),
    history: pushHistory(state.history, { at: now, availability, reason, kind })
  }
  return { state: next, changed: true }
}

export function applyRecovery(
  prev: OutageState | undefined,
  reason: string,
  now: number,
  kind: 'restored' | 'relocated' = 'restored'
): OutageState {
  const state = prev ?? emptyOutage()
  const note = clip(reason)
  const wasOut = isOut(state.availability) || !!state.candidateOrigin
  return {
    availability: 'ok',
    probeAttempt: 0,
    history: wasOut
      ? pushHistory(state.history, { at: now, availability: 'ok', reason: note, kind })
      : state.history,
    speedMs: state.speedMs
  }
}

export function noteCandidate(
  prev: OutageState | undefined,
  origin: string,
  now: number
): OutageState {
  const state = prev ?? emptyOutage()
  let host: string
  try {
    host = new URL(origin).origin
  } catch {
    return state
  }
  if (state.candidateOrigin === host) return state
  return {
    ...state,
    candidateOrigin: host,
    nextProbeAt: Math.min(state.nextProbeAt ?? now, now)
  }
}

export function applyProbe(
  prev: OutageState | undefined,
  verdict: ProbeVerdict,
  now: number,
  rand: number
): { state: OutageState; action: 'restored' | 'relocated' | 'retry'; movedTo?: string } {
  if (verdict.up && verdict.movedTo) {
    return {
      state: applyRecovery(prev, 'Moved to ' + verdict.movedTo, now, 'relocated'),
      action: 'relocated',
      movedTo: verdict.movedTo
    }
  }
  if (verdict.up) {
    return {
      state: applyRecovery(prev, 'The original address answered again', now, 'restored'),
      action: 'restored'
    }
  }
  const kind = verdict.kind === 'none' ? 'network' : verdict.kind
  const failed = applyFailure(prev, kind, verdict.detail || kind, now, rand)
  return { state: failed.state, action: 'retry' }
}

export interface ProbeTarget {
  id: string
  baseUrl: string
  state: OutageState
}

export interface ProbeOutcome {
  id: string
  action: 'restored' | 'relocated' | 'retry'
  state: OutageState
  movedTo?: string
}

function isDue(t: ProbeTarget, now: number): boolean {
  if (isBlockedSource(t.id, t.baseUrl)) return false
  if (!isOut(t.state.availability) && !t.state.candidateOrigin) return false
  return (t.state.nextProbeAt ?? 0) <= now
}

/**
 * One polite pass: a few of the most overdue sources, one at a time, with a gap between them.
 * A candidate host is fetched only after the original address fails.
 */
export async function runProbePass(opts: {
  targets: ProbeTarget[]
  now: number
  random: () => number
  probe: (url: string) => Promise<ProbeVerdict>
  max: number
  gapMs: number
  sleep: (ms: number) => Promise<void>
}): Promise<ProbeOutcome[]> {
  const due = opts.targets
    .filter((t) => isDue(t, opts.now))
    .sort((a, b) => (a.state.nextProbeAt ?? 0) - (b.state.nextProbeAt ?? 0))
    .slice(0, Math.max(0, opts.max))
  const out: ProbeOutcome[] = []
  for (let i = 0; i < due.length; i++) {
    if (i > 0) {
      const jitter = Math.round(Math.min(1, Math.max(0, opts.random())) * 5_000)
      await opts.sleep(opts.gapMs + jitter)
    }
    const t = due[i]
    let verdict = await opts.probe(t.baseUrl)
    if (
      !verdict.up &&
      t.state.candidateOrigin &&
      !sameSiteHost(t.baseUrl, t.state.candidateOrigin)
    ) {
      const alt = await opts.probe(t.state.candidateOrigin)
      if (alt.up) {
        let movedTo = alt.movedTo
        if (!movedTo) {
          try {
            movedTo = new URL(t.state.candidateOrigin).origin
          } catch {
            movedTo = undefined
          }
        }
        if (movedTo) verdict = { ...alt, up: true, kind: 'moved', movedTo }
      }
    }
    const applied = applyProbe(t.state, verdict, opts.now, opts.random())
    out.push({ id: t.id, action: applied.action, state: applied.state, movedTo: applied.movedTo })
  }
  return out
}

/**
 * Other sites for the same title. The user's pin comes first, then the site they read most recently,
 * then the fastest one we have timed. Down and degraded sites are already out of rotation. Comix is
 * included only when it is the pin. At most `limit` (the reader already stops at 5).
 */
export function rankAlternatives(list: AltCandidate[], limit = 5): FallbackPick[] {
  const usable = list.filter((c) => {
    if (c.blocked && !c.pinned) return false
    if (isOut(c.availability)) return false
    return true
  })
  usable.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.lastReadAt !== b.lastReadAt) return b.lastReadAt - a.lastReadAt
    const as = a.speedMs ?? Number.POSITIVE_INFINITY
    const bs = b.speedMs ?? Number.POSITIVE_INFINITY
    if (as !== bs) return as - bs
    return a.sourceName < b.sourceName ? -1 : a.sourceName > b.sourceName ? 1 : 0
  })
  return usable
    .slice(0, limit)
    .map((c) => ({ sourceId: c.sourceId, sourceName: c.sourceName, url: c.url }))
}

/**
 * Default site for a title on Discover. A pin stays first even while that site is down (the reader
 * falls back for the session and does not forget the pin). Otherwise a down site gives way to a
 * healthy one. Comix is never promoted into that slot.
 */
export function orderSourceIds(members: Rotatable[], pinnedId?: string): string[] {
  if (members.length < 2) return members.map((m) => m.id)
  const pin = pinnedId ? members.find((m) => m.id === pinnedId) : undefined
  if (pin) return [pin.id, ...members.filter((m) => m !== pin).map((m) => m.id)]
  const [first, ...rest] = members
  if (!isOut(first.availability)) return members.map((m) => m.id)
  const next = rest.find((m) => !isOut(m.availability) && !isBlockedSource(m.id, m.baseUrl))
  if (!next) return members.map((m) => m.id)
  return [next.id, first.id, ...rest.filter((m) => m !== next).map((m) => m.id)]
}

/** Drop URLs on a host we already know is down, so a fallback copy on another host is tried at once. */
export function urlsToTry(urls: string[], skipHost: string): string[] {
  if (!skipHost) return urls
  let skip = skipHost
  try {
    skip = bareHost(new URL(skipHost).hostname)
  } catch {
    skip = bareHost(skipHost)
  }
  return urls.filter((u) => {
    try {
      return bareHost(new URL(u).hostname) !== skip
    } catch {
      return true
    }
  })
}

// --- source record (catalog.json) -------------------------------------------------------------

export interface RelocatableSource {
  id: string
  baseUrl: string
  listTemplate: string
  listTemplates?: string[]
  seriesRe: string
  sitemaps?: string[]
  api?: { base: string }
  availability?: Availability
  availabilityAt?: number
  availabilityReason?: string
  previousBaseUrl?: string
}

export interface UrlFields {
  url: string
  cover?: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replace the host and keep the rest of the string, including a `{n}` page marker. */
export function mapHost(url: string, oldHost: string, newOrigin: string): string {
  let u: URL
  let next: URL
  try {
    u = new URL(url)
    next = new URL(newOrigin)
  } catch {
    return url
  }
  if (bareHost(u.hostname) !== bareHost(oldHost)) return url
  const at = url.indexOf(u.origin)
  if (at < 0) return url
  return next.origin + url.slice(at + u.origin.length)
}

function rewriteSeriesRe(re: string, oldOrigin: string, newOrigin: string): string {
  const escapedOld = escapeRe(oldOrigin)
  const escapedNew = escapeRe(newOrigin)
  if (re.includes(escapedOld)) return re.split(escapedOld).join(escapedNew)
  if (re.includes(oldOrigin)) return re.split(oldOrigin).join(newOrigin)
  return re
}

/** Remember a failure or a recovery on the source row future requests read. */
export function writeSourceStatus(
  src: RelocatableSource,
  availability: Availability,
  at: number,
  reason?: string
): void {
  if (availability === 'ok') {
    delete src.availability
    delete src.availabilityAt
    delete src.availabilityReason
    return
  }
  src.availability = availability
  src.availabilityAt = at
  src.availabilityReason = clip(reason || availability)
}

export interface RelocationResult {
  oldHost: string
  previousBaseUrl: string
  rewritten: number
}

/**
 * Point one source, its saved series, and its added-by-url rows at a new origin. Status goes back to
 * healthy because this is only called once that origin has answered. Returns null when the host did
 * not actually change (www versus no www is the same site).
 */
export function applyRelocation(
  src: RelocatableSource,
  series: UrlFields[],
  added: UrlFields[],
  newOrigin: string
): RelocationResult | null {
  let next: URL
  try {
    next = new URL(newOrigin)
  } catch {
    return null
  }
  const old = new URL(src.baseUrl)
  if (bareHost(old.hostname) === bareHost(next.hostname)) return null
  const oldHost = old.hostname
  const previousBaseUrl = src.baseUrl
  const oldOrigin = old.origin
  src.baseUrl = next.origin + '/'
  src.listTemplate = mapHost(src.listTemplate, oldHost, next.origin)
  if (src.listTemplates)
    src.listTemplates = src.listTemplates.map((t) => mapHost(t, oldHost, next.origin))
  src.seriesRe = rewriteSeriesRe(src.seriesRe, oldOrigin, next.origin)
  if (src.sitemaps) src.sitemaps = src.sitemaps.map((t) => mapHost(t, oldHost, next.origin))
  if (src.api) src.api = { ...src.api, base: mapHost(src.api.base, oldHost, next.origin) }
  src.previousBaseUrl = previousBaseUrl
  writeSourceStatus(src, 'ok', Date.now())
  let rewritten = 0
  const touch = (row: UrlFields): void => {
    const url = mapHost(row.url, oldHost, next.origin)
    const cover = row.cover ? mapHost(row.cover, oldHost, next.origin) : row.cover
    if (url !== row.url || cover !== row.cover) rewritten++
    row.url = url
    if (cover !== undefined) row.cover = cover
  }
  for (const row of series) touch(row)
  for (const row of added) touch(row)
  return { oldHost, previousBaseUrl, rewritten }
}

export function rewriteDetailUrls<
  T extends { url: string; cover?: string; chapters?: { url: string; alts?: string[] }[] }
>(detail: T, oldHost: string, newOrigin: string): T {
  return {
    ...detail,
    url: mapHost(detail.url, oldHost, newOrigin),
    cover: detail.cover ? mapHost(detail.cover, oldHost, newOrigin) : detail.cover,
    chapters: detail.chapters?.map((ch) => ({
      ...ch,
      url: mapHost(ch.url, oldHost, newOrigin),
      alts: ch.alts?.map((u) => mapHost(u, oldHost, newOrigin))
    }))
  }
}
