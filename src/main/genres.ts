import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import * as cheerio from 'cheerio'
import { fetchHtml } from './http'
import { robotsAllows } from './robots'
import { getMode } from './hostmode'
import { hiddenWindow, loadPage } from './grabber'
import { canonGenre, knownGenre, parseSeriesList, type SeriesType } from './staticParse'
import type { SourceDef } from '../preload/index.d'
import { catalogUrls, getSource, listSources } from './catalog'
import { isOffline } from './downloads'

/*
 * Genres for every title, without opening every title: most sites have a page per genre ("/genre/action/") that
 * lists every series in that genre, 20-40 at a time. Reading those pages tags thousands of titles per genre.
 * It runs slowly in the background (one site at a time, a pause between pages, robots.txt respected) and the
 * result is kept in genre-index.json. What a series' own page says always wins over this.
 */

// ---- where results live -----------------------------------------------------------------------------------------

interface SiteIndex {
  at: number
  /** genre names (standard spelling); `map` points into this list */
  genres: string[]
  /** normalised series address → genre numbers */
  map: Record<string, number[]>
  types: Record<string, SeriesType>
  stats: { genres: number; pages: number; titles: number; note?: string }
  /** when the last attempt failed or found nothing (to try again later, not every launch) */
  failedAt?: number
}
let index: Record<string, SiteIndex> | null = null
let version = 0
let lookup: Map<string, { g?: string[]; t?: SeriesType }> | null = null
const indexPath = (): string => join(app.getPath('userData'), 'genre-index.json')

function loadIndex(): Record<string, SiteIndex> {
  if (index) return index
  try {
    index = existsSync(indexPath()) ? JSON.parse(readFileSync(indexPath(), 'utf8')) : {}
  } catch {
    index = {}
  }
  return index!
}
function saveIndex(): void {
  try {
    writeFileSync(indexPath(), JSON.stringify(loadIndex()))
  } catch {
    /* not critical */
  }
}

/** Same series address written slightly differently (www., trailing slash, http) gives the same key. */
export function urlKey(u: string): string {
  try {
    const x = new URL(u)
    return (x.hostname.replace(/^www\./, '') + decodeURIComponent(x.pathname).replace(/\/+$/, '')).toLowerCase()
  } catch {
    return u.toLowerCase()
  }
}

/** Bumped when a site's genre scan is saved: searches use it to know their genre counts are out of date. */
export function genreIndexVersion(): number {
  return version
}

/** What the genre pages said about one series (by its address). */
export function crawledMeta(url: string): { g?: string[]; t?: SeriesType } | undefined {
  if (!lookup) {
    lookup = new Map()
    for (const site of Object.values(loadIndex())) {
      for (const [k, nums] of Object.entries(site.map)) {
        const cur = lookup.get(k) ?? {}
        cur.g = [...new Set([...(cur.g ?? []), ...nums.map((n) => site.genres[n])])]
        lookup.set(k, cur)
      }
      for (const [k, t] of Object.entries(site.types)) {
        const cur = lookup.get(k) ?? {}
        cur.t ??= t
        lookup.set(k, cur)
      }
    }
  }
  return lookup.get(url)
}

export function genreScanStatus(): Record<string, { at: number; genres: number; titles: number; note?: string; running?: boolean }> {
  const out: Record<string, { at: number; genres: number; titles: number; note?: string; running?: boolean }> = {}
  for (const [id, s] of Object.entries(loadIndex())) out[id] = { at: s.at, genres: s.stats.genres, titles: s.stats.titles, note: s.stats.note }
  if (runningId) out[runningId] = { ...(out[runningId] ?? { at: 0, genres: 0, titles: 0 }), running: true }
  return out
}

// ---- finding a site's genre pages ---------------------------------------------------------------------------------

const TYPE_WORDS: Record<string, SeriesType> = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua', webtoon: 'manhwa', webtoons: 'manhwa' }
// /genre/action, /genres/action/, /manga-genre/action/, /category/action, /tag/action, /type/manhwa, ?genre=action
const PATH_RE = /^(.*?\/(?:genres?|manga-genres?|genre-manga|comic-genres?|categor(?:y|ies)|tags?|types?|manga-type|comic-type))\/([^/?#]+)\/?$/i
const QUERY_KEYS = ['genre', 'genres', 'genre[]', 'genres[]', 'type', 'types', 'category', 'tag']

export interface GenrePage {
  name: string
  url: string
  /** from a "Top …" menu (a curated list, not the whole genre): used only if the real one is missing */
  top?: boolean
  /** a type page (manga / manhwa / manhua) instead of a genre */
  type?: SeriesType
}

function findGenreLinks(html: string, pageUrl: string, host: string): GenrePage[] {
  const $ = cheerio.load(html)
  const groups = new Map<string, Map<string, GenrePage>>() // path prefix → slug → page
  $('a[href]').each((_, a) => {
    let u: URL
    try {
      u = new URL(($(a).attr('href') ?? '').trim(), pageUrl)
    } catch {
      return
    }
    if (u.hostname.replace(/^www\./, '') !== host) return
    const text = $(a).text().replace(/\s+/g, ' ').replace(/\s*\(?\d[\d,.]*\)?\s*$/, '').trim()
    let prefix = ''
    let slug = ''
    const m = PATH_RE.exec(u.pathname)
    if (m && !u.search) {
      prefix = m[1].toLowerCase()
      slug = decodeURIComponent(m[2])
    } else {
      const key = QUERY_KEYS.find((k) => u.searchParams.has(k))
      if (!key || [...u.searchParams.keys()].length > 2) return
      prefix = u.pathname + '?' + key
      slug = u.searchParams.get(key) ?? ''
    }
    if (!slug || /^(page|all|\d+)$/i.test(slug)) return
    let label = text && text.length <= 30 ? text : slug.replace(/[-_+]+/g, ' ')
    const top = /^(top|best|hot)\s+/i.test(label)
    label = label.replace(/^(top|best|hot)\s+/i, '')
    const typeWord = TYPE_WORDS[label.toLowerCase()] ?? TYPE_WORDS[slug.toLowerCase()]
    // the standard name from the label, else from the address ("/genre/award-winning" under an Arabic label)
    const name = typeWord ? label : knownGenre(label) ?? knownGenre(slug.replace(/[-_+]+/g, ' ')) ?? canonGenre(label)
    if (!name) return
    u.hash = ''
    const g = groups.get(prefix) ?? new Map<string, GenrePage>()
    if (!g.has(slug.toLowerCase())) g.set(slug.toLowerCase(), { name: typeWord ? typeWord : name, url: u.href, ...(typeWord ? { type: typeWord } : {}), ...(top ? { top: true } : {}) })
    groups.set(prefix, g)
  })
  $('input[name], select[name]').each((_, el) => {
    const nameAttr = ($(el).attr('name') ?? '').toLowerCase()
    if (!QUERY_KEYS.includes(nameAttr)) return
    const form = $(el).closest('form')
    let action: URL
    try {
      action = new URL((form.attr('action') ?? '').trim() || pageUrl, pageUrl)
    } catch {
      return
    }
    if (action.hostname.replace(/^www\./, '') !== host || (form.attr('method') ?? 'get').toLowerCase() !== 'get') return
    const choices: { value: string; label: string }[] =
      el.tagName === 'select'
        ? $(el).find('option').toArray().map((o) => ({ value: $(o).attr('value') ?? '', label: $(o).text() }))
        : [{ value: $(el).attr('value') ?? '', label: $(el).closest('label').text() || $(el).next('label').text() || ($(el).attr('id') ? $('label[for="' + $(el).attr('id') + '"]').text() : '') }]
    for (const c of choices) {
      const value = c.value.trim()
      if (!value || /^(all|any|0)$/i.test(value)) continue
      const label = (c.label || value).replace(/\s+/g, ' ').replace(/\s*\(?\d[\d,.]*\)?\s*$/, '').trim()
      const typeWord = TYPE_WORDS[label.toLowerCase()] ?? TYPE_WORDS[value.toLowerCase()]
      const name = typeWord ? typeWord : knownGenre(label) ?? knownGenre(value) ?? canonGenre(label)
      if (!name) continue
      const u = new URL(action.href)
      u.search = ''
      u.searchParams.set(nameAttr, value)
      const prefix = u.pathname + '?' + nameAttr
      const g = groups.get(prefix) ?? new Map<string, GenrePage>()
      if (!g.has(value.toLowerCase())) g.set(value.toLowerCase(), { name, url: u.href, ...(typeWord ? { type: typeWord } : {}) })
      groups.set(prefix, g)
    }
  })
  const out: GenrePage[] = []
  for (const g of groups.values()) {
    const pages = [...g.values()]
    const types = pages.filter((p) => p.type)
    // a real genre menu has many entries under one path (a single "/tag/x" link in an article is not one)
    if (pages.length - types.length >= 5) out.push(...pages)
    else if (types.length >= 2) out.push(...types)
  }
  // the same genre reachable two ways: keep one (the full genre page over a "Top …" list)
  out.sort((a, b) => Number(!!a.top) - Number(!!b.top))
  const seen = new Set<string>()
  return out.filter((p) => (seen.has(p.name + (p.type ?? '')) ? false : (seen.add(p.name + (p.type ?? '')), true)))
}

/** Links to a site's list of genres ("/Genre", "/genres/"), to look there too. */
function genreIndexLinks(html: string, pageUrl: string, host: string): string[] {
  const $ = cheerio.load(html)
  const out = new Set<string>()
  $('a[href]').each((_, a) => {
    try {
      const u = new URL(($(a).attr('href') ?? '').trim(), pageUrl)
      if (u.hostname.replace(/^www\./, '') === host && /^\/(genres?|manga-genres?|categories|tags|genre-list)\/?$/i.test(u.pathname)) {
        u.hash = ''
        out.add(u.href)
      }
    } catch {
      /* not a link */
    }
  })
  return [...out]
}

async function getHtml(url: string, browser: boolean): Promise<string> {
  if (!browser) {
    const r = await fetchHtml(url, 20000)
    if (r.status === 403 || r.status === 429) throw new Error('refused ' + r.status)
    return r.status === 200 ? r.html : ''
  }
  const w = hiddenWindow({ light: true })
  try {
    await loadPage(w, url, 30000)
    await new Promise((r) => setTimeout(r, 1500))
    return await w.webContents.executeJavaScript('document.documentElement.outerHTML')
  } finally {
    if (!w.isDestroyed()) w.destroy()
  }
}

export async function discoverGenres(src: SourceDef): Promise<GenrePage[]> {
  const host = new URL(src.baseUrl).hostname.replace(/^www\./, '')
  const browser = getMode(new URL(src.baseUrl).hostname + '|list') === 'browser'
  const tries = [src.baseUrl]
  if (src.listTemplate) tries.push(src.listTemplate.replace('{n}', '1'))
  for (const p of ['genres/', 'genre/', 'manga-genres/', 'browse/', 'manga/', 'search']) tries.push(new URL('/' + p, src.baseUrl).href)
  const found = new Map<string, GenrePage>()
  const queue = [...new Set(tries)]
  const done = new Set<string>()
  for (let i = 0; i < queue.length && i < 12; i++) {
    const u = queue[i]
    if (done.has(u)) continue
    done.add(u)
    try {
      if (!(await robotsAllows(u))) continue
      const html = await getHtml(u, browser)
      // a link to the site's genre list goes to the front of the queue
      for (const x of genreIndexLinks(html, u, host)) if (!done.has(x) && !queue.slice(i + 1).includes(x)) queue.splice(i + 1, 0, x)
      for (const g of findGenreLinks(html, u, host)) if (!found.has(g.url)) found.set(g.url, g)
    } catch {
      /* try the next page */
    }
    if ([...found.values()].filter((g) => !g.type).length >= 8) break
  }
  return [...found.values()]
}

// ---- reading one genre's pages -------------------------------------------------------------------------------------

function pageUrls(genreUrl: string, listTemplate: string): ((n: number) => string)[] {
  const base = genreUrl.replace(/\/?$/, genreUrl.includes('?') ? '' : '/')
  const q = (k: string) => (n: number): string => genreUrl + (genreUrl.includes('?') ? '&' : '?') + k + '=' + n
  const path = (n: number): string => base + 'page/' + n + '/'
  const plain = (n: number): string => base + n
  const list = /\/page\/\{n\}/.test(listTemplate) ? [path, q('page'), plain] : [q('page'), path, plain]
  return list
}

interface Crawled {
  /** series url → how many pages of this genre listed it */
  urls: Map<string, number>
  pages: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** "See all": a link on a genre page to the full (paged) list of the same genre, as a filter of the main list. */
function fullListLink(html: string, g: GenrePage): string | null {
  let slug = ''
  try {
    const u = new URL(g.url)
    slug = decodeURIComponent(u.search ? [...u.searchParams.values()][0] ?? '' : u.pathname.replace(/\/+$/, '').split('/').pop() ?? '').toLowerCase()
  } catch {
    return null
  }
  if (!slug || new URL(g.url).search) return null
  const $ = cheerio.load(html)
  for (const a of $('a[href]').toArray()) {
    try {
      const u = new URL($(a).attr('href') ?? '', g.url)
      if (u.hostname !== new URL(g.url).hostname) continue
      for (const k of ['genre', 'genres', 'genre[]', 'genres[]']) if ((u.searchParams.get(k) ?? '').toLowerCase() === slug) return u.href
    } catch {
      /* not a link */
    }
  }
  return null
}

async function crawlGenre(src: SourceDef, g0: GenrePage, browser: boolean, maxPages: number, pause: number, stop: () => boolean): Promise<Crawled> {
  let g = g0
  const html0 = await getHtml(g.url, browser)
  const full = fullListLink(html0, g)
  if (full && (await robotsAllows(full))) {
    g = { ...g, url: full }
    await sleep(pause)
  }
  const out: Crawled = { urls: new Map(), pages: 0 }
  const add = (items: { url: string }[]): number => {
    let fresh = 0
    for (const it of items) {
      if (!out.urls.has(it.url)) fresh++
      out.urls.set(it.url, (out.urls.get(it.url) ?? 0) + 1)
    }
    return fresh
  }
  const first = parseSeriesList(g === g0 ? html0 : await getHtml(g.url, browser), g.url, src.seriesRe)
  out.pages = 1
  add(first)
  if (first.length < 5 || maxPages <= 1) return out
  // which way does this site number its pages? the one whose page 2 brings new series
  let next: ((n: number) => string) | null = null
  const firstSet = new Set(first.map((i) => i.url))
  for (const make of pageUrls(g.url, src.listTemplate ?? '')) {
    if (stop()) return out
    await sleep(pause)
    const u = make(2)
    if (!(await robotsAllows(u))) continue
    const items = parseSeriesList(await getHtml(u, browser).catch(() => ''), u, src.seriesRe)
    if (items.filter((i) => !firstSet.has(i.url)).length >= 3) {
      next = make
      out.pages = 2
      add(items)
      break
    }
  }
  if (!next) return out
  for (let n = 3; n <= maxPages && !stop(); n++) {
    await sleep(pause)
    const items = parseSeriesList(await getHtml(next(n), browser), next(n), src.seriesRe)
    out.pages = n
    // past the last page sites show nothing, or page 1 again, or the last page again: stop when nothing is new
    if (add(items) < 2) break
  }
  return out
}

// ---- one site, all its genres -----------------------------------------------------------------------------------------

let runningId: string | null = null
let cancelId: string | null = null
export function cancelGenreScan(id: string): void {
  if (runningId === id) cancelId = id
}

export interface ScanReport {
  genres: { name: string; type?: string; pages: number; titles: number }[]
  titles: number
  pages: number
  /** titles listed under most genres: if this is huge, a sidebar slipped through */
  topTagged: { url: string; genres: number }[]
  /** every series key that got a genre or type (for tests: compare with the catalog) */
  matchKeys: string[]
}

/**
 * Reads the genre pages of one site and saves which titles are in which genre. `limit` is for tests (a few genres,
 * a few pages each); the background run uses no limit.
 */
export async function scanSiteGenres(
  src: SourceDef,
  opts: { maxGenres?: number; maxPages?: number; save?: boolean; onProgress?: (done: number, total: number) => void } = {}
): Promise<ScanReport> {
  if (runningId) throw new Error('another genre scan is running')
  runningId = src.id
  cancelId = null
  const stop = (): boolean => cancelId === src.id || app.isReady() === false
  try {
    const browser = getMode(new URL(src.baseUrl).hostname + '|list') === 'browser'
    const pause = browser ? 4000 : 1200
    let found = await discoverGenres(src)
    if (found.filter((p) => !p.type).length > 60) found = found.filter((p) => p.type || knownGenre(p.name))
    const pages = found.slice(0, opts.maxGenres ?? 200)
    const results: { g: GenrePage; c: Crawled }[] = []
    let i = 0
    for (const g of pages) {
      if (stop()) break
      opts.onProgress?.(i++, pages.length)
      try {
        if (!(await robotsAllows(g.url))) continue
        results.push({ g, c: await crawlGenre(src, g, browser, opts.maxPages ?? 400, pause, stop) })
      } catch (e) {
        if (/refused/.test(String(e))) break // the site said no: leave it alone for now
      }
      await sleep(pause)
    }

    // Sidebars ("Popular", "Trending") show up on every page: a title on most pages of one genre, or in most
    // genres, is sidebar furniture there, not a member.
    const genreCount = new Map<string, number>()
    for (const { g, c } of results) {
      if (g.type) continue
      for (const u of c.urls.keys()) genreCount.set(u, (genreCount.get(u) ?? 0) + 1)
    }
    const realGenres = results.filter((r) => !r.g.type).length
    const sidebar = new Set<string>()
    if (realGenres >= 6) for (const [u, n] of genreCount) if (n > Math.max(8, realGenres * 0.6)) sidebar.add(u)

    const inCatalog = new Set(catalogUrls(src.id).map(urlKey))
    const site: SiteIndex = { at: Date.now(), genres: [], map: {}, types: {}, stats: { genres: 0, pages: 0, titles: 0 } }
    const report: ScanReport = { genres: [], titles: 0, pages: 0, topTagged: [], matchKeys: [] }
    for (const { g, c } of results) {
      let kept = 0
      for (const [u, onPages] of c.urls) {
        if (sidebar.has(u)) continue
        if (c.pages >= 4 && onPages > c.pages * 0.5) continue // on most pages of this genre: a sidebar
        const k = urlKey(u)
        if (!inCatalog.has(k)) continue
        if (g.type) site.types[k] ??= g.type
        else {
          let n = site.genres.indexOf(g.name)
          if (n < 0) n = site.genres.push(g.name) - 1
          ;(site.map[k] ??= []).includes(n) || site.map[k].push(n)
        }
        kept++
      }
      report.genres.push({ name: g.name, type: g.type, pages: c.pages, titles: kept })
      report.pages += c.pages
    }
    site.stats = {
      genres: site.genres.length,
      pages: report.pages,
      titles: new Set([...Object.keys(site.map), ...Object.keys(site.types)]).size,
      note: pages.length === 0 ? 'no genre pages found' : undefined
    }
    report.titles = site.stats.titles
    report.matchKeys = [...new Set([...Object.keys(site.map), ...Object.keys(site.types)])]
    report.topTagged = Object.entries(site.map)
      .map(([url, g]) => ({ url, genres: g.length }))
      .sort((a, b) => b.genres - a.genres)
      .slice(0, 3)
    if (opts.save !== false && !stop()) {
      const all = loadIndex()
      if (site.stats.titles > 0) all[src.id] = site
      else all[src.id] = { ...(all[src.id] ?? site), failedAt: Date.now(), stats: { ...site.stats } }
      saveIndex()
      lookup = null
      version++
    }
    return report
  } finally {
    runningId = null
  }
}

/** Sites whose genres are due: never read, or read more than a week ago (a failed one is retried after a day). */
export function genreScanDue(id: string): boolean {
  const s = loadIndex()[id]
  if (!s) return true
  if (s.failedAt && Date.now() - s.failedAt < 24 * 3600 * 1000) return false
  return Date.now() - s.at > 7 * 24 * 3600 * 1000
}

export function forgetGenres(id: string): void {
  const all = loadIndex()
  if (all[id]) {
    delete all[id]
    saveIndex()
    lookup = null
    version++
  }
}

// ---- background schedule -----------------------------------------------------------------------------------------

let progressNote: Record<string, string> = {}
export function genreProgress(): Record<string, string> {
  return progressNote
}

/** Reads one site's genres now (from the Sites screen). Runs in the background; false if a scan is already running. */
export function scanGenresNow(id: string): boolean {
  const src = getSource(id)
  if (!src || runningId) return false
  void runOne(src)
  return true
}

async function runOne(src: SourceDef): Promise<void> {
  try {
    await scanSiteGenres(src, { onProgress: (done, total) => (progressNote = { [src.id]: `reading genres: ${done} of ${total}` }) })
  } catch (e) {
    console.error('[genres]', src.id, e)
  } finally {
    progressNote = {}
  }
}

/**
 * Every hour, if no genre scan is running: the next site whose genres are due (never read, or a week old) and
 * whose title list isn't being scanned right now. One site at a time; nothing in offline mode.
 */
export function startGenreScheduler(): void {
  if (Object.keys(process.env).some((k) => k.startsWith('MR_'))) return // dev test runs: never in the background
  // One site after another (a 2-minute break between sites), so every site's genres are read within a few hours of
  // installing; once all are done it looks again every hour (each site is re-read weekly).
  const tick = async (): Promise<void> => {
    let wait = 60 * 60 * 1000
    try {
      if (!runningId && !isOffline()) {
        const next = listSources().find((s) => !s.crawling && genreScanDue(s.id))
        const src = next && getSource(next.id)
        if (src) {
          await runOne(src)
          wait = 2 * 60 * 1000
        }
      }
    } finally {
      setTimeout(() => void tick(), wait)
    }
  }
  setTimeout(() => void tick(), 3 * 60 * 1000)
}
