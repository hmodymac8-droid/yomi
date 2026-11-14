import { chapterNumber, normalizeTitle } from './repair'

export const ANILIST_AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize'
export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co'
export const ANILIST_REDIRECT_URL = 'https://anilist.co/api/v2/oauth/pin'
export const ANILIST_DEFAULT_CLIENT_ID = ''

export interface OAuthToken {
  accessToken: string
  expiresIn?: number
}

function parseParams(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of raw.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = eq >= 0 ? part.slice(0, eq) : part
    if (!key) continue
    const value = eq >= 0 ? part.slice(eq + 1) : ''
    let decoded = value
    try {
      decoded = decodeURIComponent(value)
    } catch {
      decoded = value
    }
    out.set(key, decoded)
  }
  return out
}

function tokenFrom(raw: string): OAuthToken | null {
  if (!raw) return null
  const params = parseParams(raw)
  const accessToken = (params.get('access_token') ?? '').trim()
  if (!accessToken) return null
  const token: OAuthToken = { accessToken }
  const rawExpires = params.get('expires_in')
  if (rawExpires !== undefined) {
    const expiresIn = Number(rawExpires)
    if (Number.isFinite(expiresIn) && expiresIn > 0) token.expiresIn = expiresIn
  }
  return token
}

export function parseOAuthToken(url: string): OAuthToken | null {
  if (!url) return null
  const hashAt = url.indexOf('#')
  const queryAt = url.indexOf('?')
  const hash = hashAt >= 0 ? url.slice(hashAt + 1) : ''
  const queryEnd = hashAt >= 0 ? hashAt : url.length
  const query = queryAt >= 0 && queryAt < queryEnd ? url.slice(queryAt + 1, queryEnd) : ''
  return tokenFrom(hash) ?? tokenFrom(query)
}

export interface AniListTitle {
  romaji?: string | null
  english?: string | null
  native?: string | null
  userPreferred?: string | null
}

export interface AniListMediaHit {
  id: number
  title: AniListTitle
  format?: string | null
  status?: string | null
  chapters?: number | null
  siteUrl?: string | null
  coverImage?: { medium?: string | null } | null
}

function norm(value: string): string {
  return normalizeTitle(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
}

export function titleCandidates(title: AniListTitle): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [title.userPreferred, title.english, title.romaji, title.native]) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (!value) continue
    const key = norm(value) || value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function containsRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

export function matchScore(query: string, candidate: string): number {
  const q = norm(query)
  const c = norm(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  const qTokens = q.split(' ')
  const cTokens = c.split(' ')
  if (containsRun(cTokens, qTokens) || containsRun(qTokens, cTokens)) {
    const ratio = Math.min(qTokens.length, cTokens.length) / Math.max(qTokens.length, cTokens.length)
    return 0.75 + 0.2 * ratio
  }
  const set = new Set(cTokens)
  let shared = 0
  for (const token of qTokens) if (set.has(token)) shared++
  if (shared === 0) return 0
  return 0.7 * (shared / Math.max(qTokens.length, cTokens.length))
}

export function scoreMedia(query: string, media: AniListMediaHit): number {
  let best = 0
  for (const candidate of titleCandidates(media.title)) {
    const score = matchScore(query, candidate)
    if (score > best) best = score
  }
  return best
}

export function rankAniListMatches(
  query: string,
  hits: AniListMediaHit[]
): { media: AniListMediaHit; score: number }[] {
  const q = norm(query)
  const rows = hits.map((media, index) => {
    const score = scoreMedia(query, media)
    const exact = q !== '' && titleCandidates(media.title).some((c) => norm(c) === q)
    return { media, score, exact, index }
  })
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.exact !== b.exact) return a.exact ? -1 : 1
    return a.index - b.index
  })
  return rows.map((row) => ({ media: row.media, score: row.score }))
}

export function suggestBestMatch(
  query: string,
  hits: AniListMediaHit[],
  minScore = 0.6
): AniListMediaHit | null {
  const top = rankAniListMatches(query, hits)[0]
  if (!top || top.score < minScore) return null
  return top.media
}

export interface ChapterRef {
  title: string
  url: string
}

export function localProgressNumber(
  chapters: ChapterRef[],
  readUrls: string[],
  current?: { url: string; pos: number }
): number {
  const read = new Set(readUrls)
  let max = 0
  let numbered = false
  for (const chapter of chapters) {
    if (!read.has(chapter.url)) continue
    const n = chapterNumber(chapter.title)
    if (n === null) continue
    numbered = true
    if (n > max) max = n
  }
  if (current && current.pos >= 0.99) {
    const chapter = chapters.find((c) => c.url === current.url)
    if (chapter) {
      const n = chapterNumber(chapter.title)
      if (n !== null) {
        numbered = true
        if (n > max) max = n
      }
    }
  }
  if (numbered) return max
  let count = 0
  for (const chapter of chapters) if (read.has(chapter.url)) count++
  return count
}

export interface MergeProgressInput {
  chapters: ChapterRef[]
  readUrls: string[]
  currentUrl?: string
  currentPos?: number
  remoteProgress: number
}

export interface MergeProgressResult {
  addedRead: string[]
  readUrls: string[]
  currentUrl?: string
  currentPos?: number
  movedForward: boolean
}

function pickChapterAt(chapters: ChapterRef[], progress: number): ChapterRef | undefined {
  let exact: ChapterRef | undefined
  let best: ChapterRef | undefined
  let bestNumber = Number.NEGATIVE_INFINITY
  for (const chapter of chapters) {
    const n = chapterNumber(chapter.title)
    if (n === null || n > progress) continue
    if (n === progress && !exact) exact = chapter
    if (n > bestNumber) {
      bestNumber = n
      best = chapter
    }
  }
  return exact ?? best
}

export function mergeProgressForward(input: MergeProgressInput): MergeProgressResult {
  const readUrls = [...input.readUrls]
  const read = new Set(readUrls)
  const addedRead: string[] = []

  if (input.remoteProgress > 0) {
    for (const chapter of input.chapters) {
      const n = chapterNumber(chapter.title)
      if (n === null || n > input.remoteProgress) continue
      if (read.has(chapter.url)) continue
      read.add(chapter.url)
      readUrls.push(chapter.url)
      addedRead.push(chapter.url)
    }
  }

  let currentUrl = input.currentUrl
  let currentPos = input.currentPos
  let movedCurrent = false

  if (input.remoteProgress > 0) {
    const currentChapter = currentUrl ? input.chapters.find((c) => c.url === currentUrl) : undefined
    const currentNumber = currentChapter ? chapterNumber(currentChapter.title) : null
    const shouldMove = !currentUrl || (currentNumber !== null && currentNumber < input.remoteProgress)
    if (shouldMove) {
      const target = pickChapterAt(input.chapters, input.remoteProgress)
      if (target && target.url !== currentUrl) {
        currentUrl = target.url
        currentPos = 0
        movedCurrent = true
      }
    }
  }

  const result: MergeProgressResult = {
    addedRead,
    readUrls,
    movedForward: addedRead.length > 0 || movedCurrent
  }
  if (currentUrl !== undefined) result.currentUrl = currentUrl
  if (currentPos !== undefined) result.currentPos = currentPos
  return result
}

export function anilistStatusForFinishedChapter(opts: {
  chapterUrl: string
  chapters: ChapterRef[]
  seriesStatus?: 'ongoing' | 'completed' | 'hiatus' | 'cancelled'
}): 'CURRENT' | 'COMPLETED' {
  if (opts.seriesStatus !== 'completed') return 'CURRENT'
  const { chapters, chapterUrl } = opts
  if (chapters.length === 0) return 'CURRENT'
  if (chapters[0].url === chapterUrl) return 'COMPLETED'
  const target = chapters.find((c) => c.url === chapterUrl)
  if (!target) return 'CURRENT'
  const targetNumber = chapterNumber(target.title)
  if (targetNumber === null) return 'CURRENT'
  let max = Number.NEGATIVE_INFINITY
  for (const chapter of chapters) {
    const n = chapterNumber(chapter.title)
    if (n !== null && n > max) max = n
  }
  return targetNumber === max ? 'COMPLETED' : 'CURRENT'
}

export function progressToSync(
  chapterTitle: string,
  chapters: ChapterRef[],
  chapterUrl: string
): number | null {
  const direct = chapterNumber(chapterTitle)
  if (direct !== null) return direct
  const index = chapters.findIndex((c) => c.url === chapterUrl)
  if (index < 0) return null
  const fromList = chapterNumber(chapters[index].title)
  if (fromList !== null) return fromList
  return chapters.length - index
}

export type AniListListStatus = 'CURRENT' | 'COMPLETED'

export interface QueuedUpdate {
  id: string
  mediaId: number
  progress: number
  status: AniListListStatus
  seriesUrl: string
  attempts: number
  nextAttemptAt: number
  lastError?: string
}

export function enqueueUpdate(
  queue: QueuedUpdate[],
  update: { mediaId: number; progress: number; status: AniListListStatus; seriesUrl: string },
  now?: number
): QueuedUpdate[] {
  const at = now ?? Date.now()
  const index = queue.findIndex((item) => item.mediaId === update.mediaId)
  if (index < 0) {
    const item: QueuedUpdate = {
      id: `${update.mediaId}:${at}:${Math.random().toString(36).slice(2, 8)}`,
      mediaId: update.mediaId,
      progress: update.progress,
      status: update.status,
      seriesUrl: update.seriesUrl,
      attempts: 0,
      nextAttemptAt: at
    }
    return [...queue, item]
  }
  const existing = queue[index]
  const next = [...queue]
  if (update.progress > existing.progress) {
    next[index] = {
      id: existing.id,
      mediaId: existing.mediaId,
      progress: update.progress,
      status: update.status,
      seriesUrl: update.seriesUrl,
      attempts: 0,
      nextAttemptAt: at
    }
  } else if (update.progress === existing.progress && update.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
    next[index] = { ...existing, status: 'COMPLETED' }
  }
  return next
}

const BACKOFF_STEPS = [30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000]
const BACKOFF_CAP = 3_600_000

export function backoffMs(attempts: number): number {
  const index = Math.max(0, Math.floor(attempts))
  if (index >= BACKOFF_STEPS.length) return BACKOFF_CAP
  return BACKOFF_STEPS[index]
}

export function dueUpdates(queue: QueuedUpdate[], now?: number): QueuedUpdate[] {
  const at = now ?? Date.now()
  return queue.filter((item) => item.nextAttemptAt <= at).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
}

export function markAttemptSuccess(queue: QueuedUpdate[], id: string): QueuedUpdate[] {
  return queue.filter((item) => item.id !== id)
}

export function markAttemptFailure(
  queue: QueuedUpdate[],
  id: string,
  error: string,
  now?: number
): QueuedUpdate[] {
  const at = now ?? Date.now()
  return queue.map((item) => {
    if (item.id !== id) return item
    // `attempts` counts failures already made, so the first failure waits backoffMs(0) = 30s.
    const delay = backoffMs(item.attempts)
    return { ...item, attempts: item.attempts + 1, lastError: error, nextAttemptAt: at + delay }
  })
}

export class RateLimiter {
  private readonly maxPerMinute: number
  private readonly now: () => number
  private times: number[] = []

  constructor(maxPerMinute = 90, now?: () => number) {
    this.maxPerMinute = Math.max(1, Math.floor(maxPerMinute))
    this.now = now ?? Date.now
  }

  private prune(at: number): void {
    const cutoff = at - 60_000
    while (this.times.length > 0 && this.times[0] <= cutoff) this.times.shift()
  }

  record(): void {
    this.times.push(this.now())
  }

  tryTake(): boolean {
    const at = this.now()
    this.prune(at)
    if (this.times.length >= this.maxPerMinute) return false
    this.times.push(at)
    return true
  }

  waitMs(): number {
    const at = this.now()
    this.prune(at)
    if (this.times.length < this.maxPerMinute) return 0
    return Math.max(0, this.times[0] + 60_000 - at)
  }

  recordTimes(): number[] {
    return [...this.times]
  }
}
