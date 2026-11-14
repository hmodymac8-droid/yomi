import {
  ANILIST_GRAPHQL_URL,
  RateLimiter,
  dueUpdates,
  markAttemptFailure,
  markAttemptSuccess,
  type AniListListStatus,
  type AniListMediaHit,
  type QueuedUpdate
} from './anilistLogic'

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}>

export const SEARCH_MEDIA_QUERY = `query SearchMedia($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: MANGA) {
      id
      title { romaji english native userPreferred }
      format
      status
      chapters
      siteUrl
      coverImage { medium }
    }
  }
}`

export const VIEWER_QUERY = `query { Viewer { id name } }`

export const SAVE_ENTRY_MUTATION = `mutation SaveEntry($id: Int, $progress: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $id, progress: $progress, status: $status) {
    id
    progress
    status
  }
}`

export const MEDIA_PROGRESS_QUERY = `query MediaProgress($id: Int) {
  Media(id: $id, type: MANGA) {
    id
    chapters
    status
    mediaListEntry { progress status }
  }
}`

export interface ViewerInfo {
  id: number
  name: string
}

export interface MediaProgress {
  mediaId: number
  progress: number
  chapters: number | null
  status: string | null
}

export interface SavedEntry {
  id: number
  progress: number
  status: string
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function graphQLMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'errors' in body) {
    const errors = (body as { errors?: { message?: string }[] }).errors
    const msg = errors?.map((e) => e.message).filter(Boolean).join('; ')
    if (msg) return msg
  }
  return `AniList request failed (${status})`
}

export class AniListClient {
  private readonly fetchImpl: FetchLike
  private readonly getToken: () => string | null
  private readonly limiter: RateLimiter
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(opts: {
    fetch: FetchLike
    getToken: () => string | null
    limiter?: RateLimiter
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  }) {
    this.fetchImpl = opts.fetch
    this.getToken = opts.getToken
    this.now = opts.now ?? Date.now
    this.limiter = opts.limiter ?? new RateLimiter(90, this.now)
    this.sleep = opts.sleep ?? sleepMs
  }

  async request<T>(query: string, variables?: Record<string, unknown>, auth = true): Promise<T> {
    const token = auth ? this.getToken() : this.getToken()
    if (auth && !token) throw new Error('Not connected to AniList')
    let lastError = 'AniList request failed'
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = this.limiter.waitMs()
      if (wait > 0) await this.sleep(wait)
      if (!this.limiter.tryTake()) {
        await this.sleep(this.limiter.waitMs() || 1000)
        continue
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
      if (token) headers.Authorization = `Bearer ${token}`
      let res: Awaited<ReturnType<FetchLike>>
      try {
        res = await this.fetchImpl(ANILIST_GRAPHQL_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables })
        })
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        await this.sleep(300)
        continue
      }
      if (res.status === 429) {
        const raw = Number(res.headers.get('retry-after'))
        const retry = Number.isFinite(raw) && raw > 0 ? raw * 1000 : this.limiter.waitMs() || 1000
        await this.sleep(retry)
        continue
      }
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        lastError = `AniList request failed (${res.status})`
        if (res.status >= 400) throw new Error(lastError)
        continue
      }
      if (res.status >= 400) throw new Error(graphQLMessage(body, res.status))
      if (body && typeof body === 'object' && 'errors' in body) {
        const errors = (body as { errors?: { message?: string; status?: number }[] }).errors
        const status = errors?.find((e) => e.status === 429)?.status
        if (status === 429) {
          await this.sleep(this.limiter.waitMs() || 1000)
          continue
        }
        throw new Error(graphQLMessage(body, res.status))
      }
      const data = (body as { data?: T }).data
      if (data === undefined) throw new Error('AniList returned no data')
      return data
    }
    throw new Error(lastError)
  }

  async searchMedia(search: string): Promise<AniListMediaHit[]> {
    const data = await this.request<{
      Page?: { media?: Array<AniListMediaHit | null> | null } | null
    }>(SEARCH_MEDIA_QUERY, { search }, true)
    return (data.Page?.media ?? []).filter((m): m is AniListMediaHit => !!m && typeof m.id === 'number')
  }

  async getViewer(): Promise<ViewerInfo | null> {
    const data = await this.request<{ Viewer?: { id?: number; name?: string } | null }>(
      VIEWER_QUERY,
      undefined,
      true
    )
    const v = data.Viewer
    if (!v || typeof v.id !== 'number' || !v.name) return null
    return { id: v.id, name: v.name }
  }

  async saveMediaListEntry(
    mediaId: number,
    progress: number,
    status: AniListListStatus
  ): Promise<SavedEntry> {
    const data = await this.request<{
      SaveMediaListEntry?: { id?: number; progress?: number; status?: string } | null
    }>(SAVE_ENTRY_MUTATION, { id: mediaId, progress, status }, true)
    const row = data.SaveMediaListEntry
    if (!row || typeof row.id !== 'number') throw new Error('AniList did not save the list entry')
    return { id: row.id, progress: row.progress ?? progress, status: row.status ?? status }
  }

  async getMediaProgress(mediaId: number): Promise<MediaProgress | null> {
    const data = await this.request<{
      Media?: {
        id?: number
        chapters?: number | null
        status?: string | null
        mediaListEntry?: { progress?: number | null; status?: string | null } | null
      } | null
    }>(MEDIA_PROGRESS_QUERY, { id: mediaId }, true)
    const media = data.Media
    if (!media || typeof media.id !== 'number') return null
    return {
      mediaId: media.id,
      progress: media.mediaListEntry?.progress ?? 0,
      chapters: media.chapters ?? null,
      status: media.mediaListEntry?.status ?? media.status ?? null
    }
  }
}

export async function flushQueue(
  queue: QueuedUpdate[],
  client: AniListClient,
  now?: number
): Promise<{ queue: QueuedUpdate[]; sent: number; failed: number }> {
  const at = now ?? Date.now()
  let next = queue
  let sent = 0
  let failed = 0
  for (const item of dueUpdates(next, at)) {
    try {
      await client.saveMediaListEntry(item.mediaId, item.progress, item.status)
      next = markAttemptSuccess(next, item.id)
      sent++
    } catch (err) {
      next = markAttemptFailure(next, item.id, err instanceof Error ? err.message : String(err), at)
      failed++
    }
  }
  return { queue: next, sent, failed }
}
