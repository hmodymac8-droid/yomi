import type { FeedApiDef, SeriesDetail, SourceDef } from '../preload/index.d'
import type { GrabResult } from './grabber'
import { fetchHtml, fetchJson } from './http'
import { canonGenres, type SeriesType } from './staticParse'

/*
 * Sites that are JavaScript apps (Next.js and the like) draw their pages from a data feed, a JSON API, so their web
 * pages hold no chapter lists and no pictures until the page's code has run. Yomi reads the feed instead: the whole
 * title list with genres, type and status in a handful of requests, a series' chapter list and a chapter's pages in
 * one request each. No browser window, no waiting for the page to build itself.
 *
 * It is found by itself: the site's home page names its feed in its scripts, and a feed that answers like a
 * 'series-feed' (a paged list of series, and a list of chapters per series) is used. Any site built on such a feed
 * works with no further setup; a feed with another shape needs its own small reader added here.
 *
 * Series live at <site>/series/<id> and chapters at <site>/chapter/<id> (the addresses the site's own pages use).
 */

const PAGE = 200 // the feed gives at most 200 per page
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface FeedItem {
  url: string
  title: string
  cover: string
  type?: SeriesType
  genres: string[]
  /** a novel (text, no pictures): not listed */
  novel?: boolean
}

// ---- which sites have a feed (by host, so a chapter address finds its feed) --------------------------------------

const feeds = new Map<string, { def: FeedApiDef; origin: string }>()
const hostKey = (u: string): string => new URL(u).hostname.replace(/^www\./, '')

export function registerFeedSources(list: SourceDef[]): void {
  for (const s of list) {
    if (!s.api) continue
    try {
      feeds.set(hostKey(s.baseUrl), { def: s.api, origin: new URL(s.baseUrl).origin })
    } catch {
      /* not an address */
    }
  }
}

/** Drop the old host after a source moves, and register the feed at its new address. */
export function reregisterFeed(src: SourceDef, previousBaseUrl?: string): void {
  if (previousBaseUrl) {
    try {
      feeds.delete(hostKey(previousBaseUrl))
    } catch {
      /* not an address */
    }
  }
  registerFeedSources([src])
}

export function feedFor(url: string): { def: FeedApiDef; origin: string } | undefined {
  try {
    return feeds.get(hostKey(url))
  } catch {
    return undefined
  }
}

// ---- reading the feed --------------------------------------------------------------------------------------------

async function getJson<T>(def: FeedApiDef, path: string): Promise<T> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchJson<T>(def.base + path)
      if (r.status === 200 && r.data) return r.data
      if (r.status === 404) throw new Error('This page is not on the site any more.')
      last = new Error(`The site's data feed answered with an error (${r.status}).`)
    } catch (e) {
      if (/not on the site/.test(String(e))) throw e
      last = e
    }
    await sleep(700 * (i + 1))
  }
  throw last instanceof Error ? last : new Error(String(last))
}

interface Named {
  name?: string
}
interface RawSeries {
  id: number
  title?: string
  type?: Named | null
  status?: Named | null
  genres?: Named[] | null
  poster?: { thumbnail?: string; medium?: string } | null
}

function mapType(name: string): SeriesType | undefined {
  if (/كوري|كورية|ويبتون|manhwa|webtoon|korean/i.test(name)) return 'manhwa'
  if (/صيني|صينية|مانها|manhua|chinese/i.test(name)) return 'manhua'
  if (/ياباني|يابانية|مانجا|manga|japanese/i.test(name)) return 'manga'
  return undefined
}

function mapStatus(name: string): SeriesDetail['status'] {
  if (/متوقف|hiatus/i.test(name)) return 'hiatus'
  if (/ملغ|cancel|drop/i.test(name)) return 'cancelled'
  if (/مكتمل|complete|finished/i.test(name)) return 'completed'
  if (/مستمر|ongoing|publishing/i.test(name)) return 'ongoing'
  return undefined
}

const seriesUrl = (origin: string, id: number | string): string => `${origin}/series/${id}`
const chapterUrl = (origin: string, id: number | string): string => `${origin}/chapter/${id}`
const poster = (p: RawSeries['poster']): string => p?.medium || p?.thumbnail || ''

/** One page (200) of the site's title list, with each title's type and genres. */
export async function feedList(
  def: FeedApiDef,
  origin: string,
  page: number
): Promise<{ items: FeedItem[]; total: number; hasNext: boolean }> {
  const j = await getJson<{ count?: number; next?: string | null; results?: RawSeries[] }>(
    def,
    `series/?page=${page}&page_size=${PAGE}`
  )
  const items: FeedItem[] = (j.results ?? [])
    .filter((r) => r && typeof r.id === 'number' && r.title)
    .map((r) => ({
      url: seriesUrl(origin, r.id),
      title: String(r.title).replace(/\s+/g, ' ').trim(),
      cover: poster(r.poster),
      type: r.type?.name ? mapType(r.type.name) : undefined,
      genres: canonGenres((r.genres ?? []).map((g) => g.name ?? '').filter(Boolean)),
      novel: !!r.type?.name && /رواية|novel/i.test(r.type.name)
    }))
  return { items, total: j.count ?? items.length, hasNext: !!j.next }
}

interface RawChapter {
  id: number
  title?: string
  chapter?: string | number | null
}

/** The chapter list, newest first. `newestOnly` reads just the last ~50-100 chapters (for update checks). */
async function feedChapters(
  def: FeedApiDef,
  origin: string,
  id: string,
  newestOnly: boolean
): Promise<{ title: string; url: string }[]> {
  const raw: RawChapter[] = []
  const first = await getJson<{ count?: number; results?: RawChapter[] }>(
    def,
    `chapters/?serie=${id}&page=1&page_size=${newestOnly ? 1 : PAGE}`
  )
  const count = first.count ?? first.results?.length ?? 0
  if (!newestOnly) {
    raw.push(...(first.results ?? []))
    const pages = Math.ceil(count / PAGE)
    for (let p = 2; p <= pages; p++) {
      raw.push(
        ...((
          await getJson<{ results?: RawChapter[] }>(
            def,
            `chapters/?serie=${id}&page=${p}&page_size=${PAGE}`
          )
        ).results ?? [])
      )
    }
  } else if (count > 0) {
    // the feed lists oldest first: the newest chapters are on the last pages
    const last = Math.ceil(count / 50)
    for (const p of [last, last - 1].filter((n) => n >= 1)) {
      raw.push(
        ...((
          await getJson<{ results?: RawChapter[] }>(
            def,
            `chapters/?serie=${id}&page=${p}&page_size=50`
          )
        ).results ?? [])
      )
    }
  }
  // A chapter's number: the "chapter" field when it is a plain number; otherwise the number written in it
  // ("FREE115", "el.115", "166 FREE") or in the chapter's title.
  const numberIn = (t: string): number => {
    const m = /(\d+(?:\.\d+)?)/.exec(t)
    return m ? Number(m[1]) : NaN
  }
  const rows = raw.map((c) => {
    const text = c.chapter == null ? '' : String(c.chapter).trim()
    let n = text === '' ? NaN : Number(text)
    if (!Number.isFinite(n)) n = numberIn(text)
    if (!Number.isFinite(n)) n = numberIn(String(c.title ?? ''))
    return {
      id: c.id,
      n,
      title: Number.isFinite(n)
        ? `Chapter ${n}`
        : String(c.title || (text ? `Chapter ${text}` : 'Chapter')).trim(),
      url: chapterUrl(origin, c.id)
    }
  })
  rows.sort((a, b) => {
    const fa = Number.isFinite(a.n)
    const fb = Number.isFinite(b.n)
    if (fa && fb && a.n !== b.n) return b.n - a.n
    if (fa !== fb) return fa ? -1 : 1
    return b.id - a.id
  })
  // two chapters with the same number (a re-upload, a "FREE" copy): the later one is told apart, not hidden
  const used = new Map<string, number>()
  for (const r of rows) {
    const k = r.title.toLowerCase()
    const times = (used.get(k) ?? 0) + 1
    used.set(k, times)
    if (times > 1) r.title = `${r.title} (${times})`
  }
  const seen = new Set<string>()
  return rows
    .filter((r) => !seen.has(r.url) && seen.add(r.url))
    .map((r) => ({ title: r.title, url: r.url }))
}

/** A series page: its details and the whole chapter list. */
export async function feedSeries(
  def: FeedApiDef,
  origin: string,
  url: string,
  newestOnly = false
): Promise<SeriesDetail> {
  const id = /\/series\/(\d+)/.exec(url)?.[1]
  if (!id) throw new Error('This is not a series address of that site.')
  const [info, chapters] = await Promise.all([
    getJson<RawSeries & { story?: string; alternative?: string | null; chapters_count?: number }>(
      def,
      `series/${id}/`
    ),
    feedChapters(def, origin, id, newestOnly)
  ])
  return {
    url,
    title: String(info.title ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    cover: poster(info.poster),
    description: String(info.story ?? '')
      .replace(/\r/g, '')
      .trim(),
    type: info.type?.name ? mapType(info.type.name) : undefined,
    genres: canonGenres((info.genres ?? []).map((g) => g.name ?? '').filter(Boolean)),
    status: info.status?.name ? mapStatus(info.status.name) : undefined,
    chapters
  }
}

/** A chapter's pictures, in order. */
export async function feedChapter(
  def: FeedApiDef,
  origin: string,
  url: string
): Promise<GrabResult> {
  const id = /\/chapter\/(\d+)/.exec(url)?.[1]
  if (!id) throw new Error('This is not a chapter address of that site.')
  void origin
  const c = await getJson<{
    title?: string
    serie?: { title?: string } | null
    images?: { image?: string; order?: number }[]
  }>(def, `chapters/${id}/`)
  const pages = (c.images ?? [])
    .filter((i) => i.image)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((i) => String(i.image))
  return { url, title: [c.serie?.title, c.title].filter(Boolean).join(' · '), pages }
}

// ---- finding the feed of a site ----------------------------------------------------------------------------------

/** Does this address answer like a 'series-feed'? (a paged list of series, and a chapter list for one of them) */
async function probe(base: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await probeOnce(base)) return true
    await sleep(900)
  }
  return false
}

async function probeOnce(base: string): Promise<boolean> {
  try {
    const r = await fetchJson<{ count?: number; results?: { id?: unknown; title?: unknown }[] }>(
      base + 'series/?page=1&page_size=1',
      12000
    )
    const d = r.data
    if (r.status !== 200 || !d || typeof d.count !== 'number' || !Array.isArray(d.results))
      return false
    const first = d.results[0]
    if (!first || typeof first.id !== 'number' || typeof first.title !== 'string') return false
    const c = await fetchJson<{ count?: number; results?: unknown[] }>(
      base + `chapters/?serie=${first.id}&page_size=1`,
      12000
    )
    return (
      c.status === 200 &&
      !!c.data &&
      typeof c.data.count === 'number' &&
      Array.isArray(c.data.results)
    )
  } catch {
    return false
  }
}

/**
 * Looks for a feed behind a JavaScript-app site: the home page's scripts name the address their data comes from.
 * Null for an ordinary site (checked from its first page alone, so it costs one quick request).
 */
export async function detectFeedApi(origin: string): Promise<FeedApiDef | null> {
  const started = Date.now() // (reading scripts stops after ~10 s: a site with no feed must not slow adding it)
  let html = ''
  for (let attempt = 0; attempt < 3 && !html; attempt++) {
    try {
      const r = await fetchHtml(origin + '/', 15000)
      if (r.status === 200) html = r.html
      else if (r.status >= 400 && r.status < 500 && r.status !== 429) return null // a closed door, not a hiccup
    } catch {
      /* a hiccup: try again */
    }
    if (!html) await sleep(900 * (attempt + 1))
  }
  if (!html) return null
  // only sites built as JavaScript apps (an ordinary page lists its own titles and chapters)
  if (
    !/\/_next\/static\/|__NUXT__|\/_nuxt\/|__sveltekit|ng-version=|\/static\/js\/[^"']+\.js/i.test(
      html
    )
  )
    return null

  const tried = new Set<string>()
  const found: string[] = []
  const collect = (text: string): void => {
    const add = (raw: string): void => {
      const base = raw.endsWith('/') ? raw : raw + '/'
      if (!tried.has(base)) {
        tried.add(base)
        found.push(base)
      }
    }
    for (const m of text.matchAll(/baseURL\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/g)) add(m[1])
    for (const m of text.matchAll(
      /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\/(?:[a-z0-9_-]+\/){0,3}api\/(?:v\d+\/){0,2}/gi
    ))
      add(m[0])
  }
  const tryFound = async (): Promise<FeedApiDef | null> => {
    while (found.length > 0) {
      const base = found.shift()!
      if (await probe(base)) return { kind: 'series-feed', base }
    }
    return null
  }

  collect(html)
  let hit = await tryFound()
  if (hit) return hit

  const host = hostKey(origin)
  const scripts = [
    ...new Set(
      [...html.matchAll(/(?:src|href)=["']([^"']+\.js)(?:\?[^"']*)?["']/g)].map((m) => m[1])
    )
  ]
    .map((s) => {
      try {
        return new URL(s, origin + '/').href
      } catch {
        return ''
      }
    })
    .filter((u) => u && hostKey(u) === host)
    .slice(0, 40)
  for (let i = 0; i < scripts.length && !hit && Date.now() - started < 10000; i += 8) {
    const texts = await Promise.all(
      scripts.slice(i, i + 8).map((u) =>
        fetchHtml(u, 10000)
          .then((r) => r.html)
          .catch(() => '')
      )
    )
    for (const t of texts) collect(t.length > 4_000_000 ? '' : t)
    hit = await tryFound()
  }
  if (hit) return hit
  collect(`${origin}/api/`)
  return tryFound()
}
