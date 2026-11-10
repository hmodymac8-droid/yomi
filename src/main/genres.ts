import { app } from 'electron'
import { join } from 'path'
import { appendFileSync } from 'fs'
import { totalmem } from 'os'
import * as cheerio from 'cheerio'
import { fetchHtml } from './http'
import { robotsAllows } from './robots'
import { getMode } from './hostmode'
import { hiddenWindow, loadPage } from './grabber'
import { canonGenre, knownGenre, parseMeta, parseSeriesList, type SeriesType } from './staticParse'
import type { SourceDef } from '../preload/index.d'
import { addCatalogEntries, catalogUrls, crawlSource, getSource, listSources } from './catalog'
import { isOffline } from './downloads'
import { isUnreadable, readJson, writeAtomicAsync } from './safefile'

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
  /** when the genre pages (or Weebcentral's list) were last read in full */
  genrePagesAt?: number
  /** every title of the site has been looked at (genre pages, then each remaining title's page) */
  complete?: boolean
  /** titles whose own page was already read (so a restart continues where it stopped) */
  checked?: string[]
  /** Weebcentral: how far through its list the reading got */
  feedOffset?: number
}
let index: Record<string, SiteIndex> | null = null
let version = 0
let lookup: Map<string, { g?: string[]; t?: SeriesType }> | null = null
const indexPath = (): string => join(app.getPath('userData'), 'genre-index.json')

function loadIndex(): Record<string, SiteIndex> {
  if (index && !isUnreadable(indexPath())) return index
  const was = index
  index = readJson<Record<string, SiteIndex>>(indexPath(), index ? 1 : 8) ?? index ?? {}
  if (index !== was) lookup = null
  return index!
}
function saveIndex(): void {
  try {
    void writeAtomicAsync(indexPath(), JSON.stringify(loadIndex())).catch(() => undefined)
  } catch {
    /* not critical */
  }
}

/** Same series address written slightly differently (www., trailing slash, http) gives the same key. */
export function urlKey(u: string): string {
  try {
    const x = new URL(u)
    return (
      x.hostname.replace(/^www\./, '') + decodeURIComponent(x.pathname).replace(/\/+$/, '')
    ).toLowerCase()
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
  // read the index first: reading it for the first time resets the lookup, which must not happen half-way through
  const all = loadIndex()
  if (!lookup) {
    lookup = new Map()
    for (const site of Object.values(all)) {
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

export function genreScanStatus(): Record<
  string,
  { at: number; genres: number; titles: number; note?: string; running?: boolean }
> {
  const out: Record<
    string,
    { at: number; genres: number; titles: number; note?: string; running?: boolean }
  > = {}
  for (const [id, s] of Object.entries(loadIndex()))
    out[id] = { at: s.at, genres: s.stats.genres, titles: s.stats.titles, note: s.stats.note }
  for (const id of running)
    out[id] = { ...(out[id] ?? { at: 0, genres: 0, titles: 0 }), running: true }
  return out
}

// ---- finding a site's genre pages ---------------------------------------------------------------------------------

const TYPE_WORDS: Record<string, SeriesType> = {
  manga: 'manga',
  manhwa: 'manhwa',
  manhua: 'manhua',
  webtoon: 'manhwa',
  webtoons: 'manhwa'
}
// /genre/action, /genres/action/, /manga-genre/action/, /category/action, /tag/action, /type/manhwa, ?genre=action
const PATH_RE =
  /^(.*?\/(?:genres?|manga-genres?|genre-manga|comic-genres?|categor(?:y|ies)|tags?|types?|manga-type|comic-type))\/([^/?#]+)\/?$/i
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
    const text = $(a)
      .text()
      .replace(/\s+/g, ' ')
      .replace(/\s*\(?\d[\d,.]*\)?\s*$/, '')
      .trim()
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
    const name = typeWord
      ? label
      : (knownGenre(label) ?? knownGenre(slug.replace(/[-_+]+/g, ' ')) ?? canonGenre(label))
    if (!name) return
    u.hash = ''
    const g = groups.get(prefix) ?? new Map<string, GenrePage>()
    if (!g.has(slug.toLowerCase()))
      g.set(slug.toLowerCase(), {
        name: typeWord ? typeWord : name,
        url: u.href,
        ...(typeWord ? { type: typeWord } : {}),
        ...(top ? { top: true } : {})
      })
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
    if (
      action.hostname.replace(/^www\./, '') !== host ||
      (form.attr('method') ?? 'get').toLowerCase() !== 'get'
    )
      return
    const choices: { value: string; label: string }[] =
      el.tagName === 'select'
        ? $(el)
            .find('option')
            .toArray()
            .map((o) => ({ value: $(o).attr('value') ?? '', label: $(o).text() }))
        : [
            {
              value: $(el).attr('value') ?? '',
              label:
                $(el).closest('label').text() ||
                $(el).next('label').text() ||
                ($(el).attr('id') ? $('label[for="' + $(el).attr('id') + '"]').text() : '')
            }
          ]
    for (const c of choices) {
      const value = c.value.trim()
      if (!value || /^(all|any|0)$/i.test(value)) continue
      const label = (c.label || value)
        .replace(/\s+/g, ' ')
        .replace(/\s*\(?\d[\d,.]*\)?\s*$/, '')
        .trim()
      const typeWord = TYPE_WORDS[label.toLowerCase()] ?? TYPE_WORDS[value.toLowerCase()]
      const name = typeWord
        ? typeWord
        : (knownGenre(label) ?? knownGenre(value) ?? canonGenre(label))
      if (!name) continue
      const u = new URL(action.href)
      u.search = ''
      u.searchParams.set(nameAttr, value)
      const prefix = u.pathname + '?' + nameAttr
      const g = groups.get(prefix) ?? new Map<string, GenrePage>()
      if (!g.has(value.toLowerCase()))
        g.set(value.toLowerCase(), { name, url: u.href, ...(typeWord ? { type: typeWord } : {}) })
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
  return out.filter((p) =>
    seen.has(p.name + (p.type ?? '')) ? false : (seen.add(p.name + (p.type ?? '')), true)
  )
}

/** Links to a site's list of genres ("/Genre", "/genres/"), to look there too. */
function genreIndexLinks(html: string, pageUrl: string, host: string): string[] {
  const $ = cheerio.load(html)
  const out = new Set<string>()
  $('a[href]').each((_, a) => {
    try {
      const u = new URL(($(a).attr('href') ?? '').trim(), pageUrl)
      if (
        u.hostname.replace(/^www\./, '') === host &&
        /^\/(genres?|manga-genres?|categories|tags|genre-list)\/?$/i.test(u.pathname)
      ) {
        u.hash = ''
        out.add(u.href)
      }
    } catch {
      /* not a link */
    }
  })
  return [...out]
}

/*
 * How much background genre reading runs at once, by how much memory the PC has. Each hidden browser page is a small
 * Chromium of its own (100-300 MB and a share of the CPU), so only one or two are open at a time; sites read with
 * plain web requests are cheap and run side by side (fewer of them on PCs with less memory).
 */
const GB = 1024 ** 3
const MEM = totalmem()
const BROWSER_SLOTS = MEM >= 12 * GB ? 2 : 1
const SITE_SLOTS = MEM >= 12 * GB ? 16 : MEM >= 6 * GB ? 4 : 2
let browserBusy = 0
const browserQueue: (() => void)[] = []
async function browserSlot(): Promise<() => void> {
  if (browserBusy >= BROWSER_SLOTS) await new Promise<void>((r) => browserQueue.push(r))
  browserBusy++
  let done = false
  return () => {
    if (done) return
    done = true
    browserBusy--
    browserQueue.shift()?.()
  }
}

async function getHtml(url: string, browser: boolean): Promise<string> {
  if (!browser) {
    const r = await fetchHtml(url, 20000)
    if (r.status === 403 || r.status === 429) throw new Error('refused ' + r.status)
    return r.status === 200 ? r.html : ''
  }
  const release = await browserSlot()
  const w = hiddenWindow({ light: true })
  try {
    await loadPage(w, url, 30000)
    await new Promise((r) => setTimeout(r, 1500))
    return await w.webContents.executeJavaScript('document.documentElement.outerHTML')
  } finally {
    if (!w.isDestroyed()) w.destroy()
    release()
  }
}

export async function discoverGenres(src: SourceDef): Promise<GenrePage[]> {
  const host = new URL(src.baseUrl).hostname.replace(/^www\./, '')
  const browser = getMode(new URL(src.baseUrl).hostname + '|list') === 'browser'
  const tries = [src.baseUrl]
  if (src.listTemplate) tries.push(src.listTemplate.replace('{n}', '1'))
  for (const p of ['genres/', 'genre/', 'manga-genres/', 'browse/', 'manga/', 'search'])
    tries.push(new URL('/' + p, src.baseUrl).href)
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
      for (const x of genreIndexLinks(html, u, host))
        if (!done.has(x) && !queue.slice(i + 1).includes(x)) queue.splice(i + 1, 0, x)
      for (const g of findGenreLinks(html, u, host)) if (!found.has(g.url)) found.set(g.url, g)
    } catch {
      /* try the next page */
    }
    if ([...found.values()].filter((g) => !g.type).length >= 8) break
  }
  if ([...found.values()].filter((g) => !g.type).length < 5) {
    // some sites link their genres only from each title's page: put the genre links of a dozen title pages together
    let combined = ''
    for (const u of catalogUrls(src.id).slice(0, 12)) {
      try {
        if (!(await robotsAllows(u))) continue
        combined += await getHtml(u, false)
      } catch {
        /* next title */
      }
      await sleep(800)
    }
    if (combined)
      for (const g of findGenreLinks(combined, src.baseUrl, host))
        if (!found.has(g.url)) found.set(g.url, g)
  }
  return [...found.values()]
}

// ---- reading one genre's pages -------------------------------------------------------------------------------------

function pageUrls(genreUrl: string, listTemplate: string): ((n: number) => string)[] {
  const base = genreUrl.replace(/\/?$/, genreUrl.includes('?') ? '' : '/')
  const q =
    (k: string) =>
    (n: number): string =>
      genreUrl + (genreUrl.includes('?') ? '&' : '?') + k + '=' + n
  const path = (n: number): string => base + 'page/' + n + '/'
  const plain = (n: number): string => base + n
  const list = /\/page\/\{n\}/.test(listTemplate)
    ? [path, q('page'), plain]
    : [q('page'), path, plain]
  return list
}

interface Crawled {
  /** series url → how many pages of this genre listed it */
  urls: Map<string, number>
  /** series url → its title and cover as the list showed them */
  items: Map<string, { title: string; cover: string }>
  pages: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** "See all": a link on a genre page to the full (paged) list of the same genre, as a filter of the main list. */
function fullListLink(html: string, g: GenrePage): string | null {
  let slug = ''
  try {
    const u = new URL(g.url)
    slug = decodeURIComponent(
      u.search
        ? ([...u.searchParams.values()][0] ?? '')
        : (u.pathname.replace(/\/+$/, '').split('/').pop() ?? '')
    ).toLowerCase()
  } catch {
    return null
  }
  if (!slug || new URL(g.url).search) return null
  const $ = cheerio.load(html)
  for (const a of $('a[href]').toArray()) {
    try {
      const u = new URL($(a).attr('href') ?? '', g.url)
      if (u.hostname !== new URL(g.url).hostname) continue
      for (const k of ['genre', 'genres', 'genre[]', 'genres[]'])
        if ((u.searchParams.get(k) ?? '').toLowerCase() === slug) return u.href
    } catch {
      /* not a link */
    }
  }
  return null
}

async function crawlGenre(
  src: SourceDef,
  g0: GenrePage,
  browser: boolean,
  maxPages: number,
  pause: number,
  stop: () => boolean,
  onPage: (page: number) => void = () => undefined
): Promise<Crawled> {
  let g = g0
  const html0 = await getHtml(g.url, browser)
  const full = fullListLink(html0, g)
  if (full && (await robotsAllows(full))) {
    g = { ...g, url: full }
    await sleep(pause)
  }
  const out: Crawled = { urls: new Map(), items: new Map(), pages: 0 }
  const add = (items: { url: string; title: string; cover: string }[]): number => {
    let fresh = 0
    for (const it of items) {
      if (!out.urls.has(it.url)) fresh++
      out.urls.set(it.url, (out.urls.get(it.url) ?? 0) + 1)
      if (!out.items.has(it.url) && it.title)
        out.items.set(it.url, { title: it.title, cover: it.cover })
    }
    return fresh
  }
  const first = parseSeriesList(
    g === g0 ? html0 : await getHtml(g.url, browser),
    g.url,
    src.seriesRe
  )
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
  // sites that count from 0 ("/genre/action" is page 0, then /1, /2): page 1 is a page of its own
  if (next(1) !== g.url && next(1) !== g.url.replace(/\/$/, '')) {
    await sleep(pause)
    add(parseSeriesList(await getHtml(next(1), browser).catch(() => ''), next(1), src.seriesRe))
  }
  for (let n = 3; n <= maxPages && !stop(); n++) {
    onPage(n)
    await sleep(pause)
    const items = parseSeriesList(await getHtml(next(n), browser), next(n), src.seriesRe)
    out.pages = n
    // past the last page sites show nothing, or page 1 again, or the last page again: stop when nothing is new
    if (add(items) < 2) break
  }
  return out
}

// ---- one site, all its genres -----------------------------------------------------------------------------------------

const running = new Set<string>()
const cancelled = new Set<string>()
export function cancelGenreScan(id: string): void {
  if (running.has(id)) cancelled.add(id)
}

export interface ScanReport {
  genres: { name: string; type?: string; pages: number; titles: number }[]
  titles: number
  pages: number
  /** titles listed under most genres: if this is huge, a sidebar slipped through */
  topTagged: { url: string; genres: number }[]
  /** every series key that got a genre or type (for tests: compare with the catalog) */
  matchKeys: string[]
  /** titles the genre pages showed that the catalog didn't have yet (added to it) */
  added: number
}

function emptySite(): SiteIndex {
  return { at: 0, genres: [], map: {}, types: {}, stats: { genres: 0, pages: 0, titles: 0 } }
}

/**
 * A site with a data feed gives every title's genres and type with the title list itself: no genre pages to read, no
 * title pages to open. The whole index of that site is replaced by what the feed said.
 */
export function setFeedTags(
  siteId: string,
  items: { url: string; type?: SeriesType; genres: string[] }[]
): void {
  const site = emptySite()
  for (const it of items) tag(site, urlKey(it.url), it.genres, it.type)
  restat(site)
  site.at = Date.now()
  site.genrePagesAt = Date.now()
  site.complete = true
  loadIndex()[siteId] = site
  saveIndexNow()
}

/** Puts genres / a type on one title in a site's index (adds to what is there). */
function tag(site: SiteIndex, key: string, names: string[], type?: SeriesType): void {
  for (const name of names) {
    let n = site.genres.indexOf(name)
    if (n < 0) n = site.genres.push(name) - 1
    const list = (site.map[key] ??= [])
    if (!list.includes(n)) list.push(n)
  }
  if (type) site.types[key] ??= type
}

function restat(site: SiteIndex): void {
  site.stats.genres = site.genres.length
  site.stats.titles = new Set([...Object.keys(site.map), ...Object.keys(site.types)]).size
}

// Results are saved every so often while a scan runs, and searches pick them up at most once a minute (re-counting
// 300,000 titles on every new genre would slow the app down).
let saveTimer: NodeJS.Timeout | undefined
let lastBump = 0
function saveSoonIndex(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    saveIndex()
    if (Date.now() - lastBump > 60000) {
      lastBump = Date.now()
      lookup = null
      version++
    }
  }, 45000)
}
function saveIndexNow(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  saveIndex()
  lookup = null
  version++
  lastBump = Date.now()
}

/**
 * Reads the genre pages of one site and records which titles are in which genre. Titles a genre page shows that the
 * catalog doesn't have yet are added to it. `maxGenres` / `maxPages` / `save: false` are for tests.
 */
export async function scanSiteGenres(
  src: SourceDef,
  opts: {
    maxGenres?: number
    maxPages?: number
    save?: boolean
    onProgress?: (done: number, total: number, page: number, genre: string) => void
  } = {}
): Promise<ScanReport> {
  const stop = (): boolean => cancelled.has(src.id)
  const browser = getMode(new URL(src.baseUrl).hostname + '|list') === 'browser'
  const pause = browser ? 4000 : 1000
  let found = await discoverGenres(src)
  if (found.filter((p) => !p.type).length > 60)
    found = found.filter((p) => p.type || knownGenre(p.name))
  const pages = found.slice(0, opts.maxGenres ?? 200)
  const results: { g: GenrePage; c: Crawled }[] = []
  let i = 0
  for (const g of pages) {
    if (stop()) break
    opts.onProgress?.(i, pages.length, 0, g.name)
    try {
      if (!(await robotsAllows(g.url))) continue
      results.push({
        g,
        c: await crawlGenre(src, g, browser, opts.maxPages ?? 1500, pause, stop, (p) =>
          opts.onProgress?.(i, pages.length, p, g.name)
        )
      })
    } catch (e) {
      if (/refused/.test(String(e))) throw e // the site said no: the caller pauses this site
    }
    i++
    await sleep(pause)
  }
  opts.onProgress?.(pages.length, pages.length, 0, '')

  // Sidebars ("Popular", "Trending") show up on every page: a title on most pages of one genre, or in most
  // genres, is sidebar furniture there, not a member.
  const genreCount = new Map<string, number>()
  for (const { g, c } of results) {
    if (g.type) continue
    for (const u of c.urls.keys()) genreCount.set(u, (genreCount.get(u) ?? 0) + 1)
  }
  const realGenres = results.filter((r) => !r.g.type).length
  const sidebar = new Set<string>()
  if (realGenres >= 6)
    for (const [u, n] of genreCount) if (n > Math.max(8, realGenres * 0.6)) sidebar.add(u)

  // titles the genre pages know but the catalog doesn't (sites whose own list is cut short)
  const extra: { url: string; title: string; cover: string }[] = []
  for (const { c } of results)
    for (const [u, it] of c.items) if (!sidebar.has(u)) extra.push({ url: u, ...it })
  const added = opts.save === false ? 0 : addCatalogEntries(src.id, extra)

  const inCatalog = new Set(catalogUrls(src.id).map(urlKey))
  const site = emptySite()
  const report: ScanReport = {
    genres: [],
    titles: 0,
    pages: 0,
    topTagged: [],
    matchKeys: [],
    added
  }
  for (const { g, c } of results) {
    let kept = 0
    for (const [u, onPages] of c.urls) {
      if (sidebar.has(u)) continue
      if (c.pages >= 4 && onPages > c.pages * 0.5) continue // on most pages of this genre: a sidebar
      const k = urlKey(u)
      if (!inCatalog.has(k)) continue
      if (g.type) tag(site, k, [], g.type)
      else tag(site, k, [g.name])
      kept++
    }
    report.genres.push({ name: g.name, type: g.type, pages: c.pages, titles: kept })
    report.pages += c.pages
  }
  restat(site)
  site.stats.pages = report.pages
  report.titles = site.stats.titles
  report.matchKeys = [...new Set([...Object.keys(site.map), ...Object.keys(site.types)])]
  report.topTagged = Object.entries(site.map)
    .map(([url, g]) => ({ url, genres: g.length }))
    .sort((a, b) => b.genres - a.genres)
    .slice(0, 3)
  if (opts.save !== false && !stop() && pages.length > 0) {
    const all = loadIndex()
    // keep what title pages found earlier, add what the genre pages found now
    const prev = all[src.id]
    if (prev) {
      for (const [k, nums] of Object.entries(prev.map))
        tag(
          site,
          k,
          nums.map((n) => prev.genres[n])
        )
      for (const [k, t] of Object.entries(prev.types)) site.types[k] ??= t
      site.checked = prev.checked
    }
    site.genrePagesAt = Date.now()
    restat(site)
    all[src.id] = site
    saveIndexNow()
  }
  return report
}

// ---- Weebcentral: its search lists 32 titles at a time WITH type, status and tags ---------------------------------

async function weebcentralFeed(
  src: SourceDef,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const total = Math.max(1, Math.ceil(catalogUrls(src.id).length / 32))
  const all = loadIndex()
  const site = all[src.id] ?? emptySite()
  all[src.id] = site
  let offset = site.feedOffset ?? 0
  for (;;) {
    if (cancelled.has(src.id)) return
    onProgress(Math.floor(offset / 32), total)
    const url = `https://weebcentral.com/search/data?limit=32&offset=${offset}&sort=Alphabet&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full%20Display`
    const r = await fetchHtml(url, 30000)
    if (r.status === 403 || r.status === 429) throw new Error('refused ' + r.status)
    if (r.status !== 200) break
    const $ = cheerio.load(r.html)
    let n = 0
    $('section').each((_, sec) => {
      const a = $(sec).find('a[href*="/series/"]').first()
      const href = a.attr('href')
      if (!href) return
      const fields: Record<string, string[]> = {}
      $(sec)
        .find('strong')
        .each((_, st) => {
          const label = $(st)
            .text()
            .replace(/[:\s]+$/, '')
            .toLowerCase()
          fields[label] = $(st)
            .parent()
            .find('span')
            .toArray()
            .map((x) => $(x).text().replace(/,\s*$/, '').trim())
            .filter(Boolean)
        })
      if (!fields['tag(s)'] && !fields['type']) return
      n++
      const type = TYPE_WORDS[(fields['type']?.[0] ?? '').toLowerCase()]
      const names = (fields['tag(s)'] ?? [])
        .map((t) => canonGenre(t))
        .filter((x): x is string => !!x)
      tag(site, urlKey(new URL(href, url).href), names, type)
    })
    if (n === 0) break // past the end of the list
    offset += 32
    site.feedOffset = offset
    restat(site)
    saveSoonIndex()
    await sleep(10000) // the site's robots.txt asks for 10 seconds between requests
  }
  site.feedOffset = 0
  site.genrePagesAt = Date.now()
  site.complete = true
  site.at = Date.now()
  restat(site)
  saveIndexNow()
}

// ---- reading each remaining title's own page (sites without usable genre pages) ------------------------------------

async function titlePages(
  src: SourceDef,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const all = loadIndex()
  const site = all[src.id] ?? emptySite()
  all[src.id] = site
  const checked = new Set(site.checked ?? [])
  const todo = catalogUrls(src.id).filter((u) => {
    const k = urlKey(u)
    return !site.map[k] && !checked.has(k)
  })
  const total = todo.length
  let refusals = 0
  for (let i = 0; i < todo.length; i++) {
    if (cancelled.has(src.id)) return
    onProgress(i, total)
    const u = todo[i]
    const k = urlKey(u)
    if (!(await robotsAllows(u))) {
      checked.add(k)
      continue
    }
    const r = await fetchHtml(u, 20000).catch(() => null)
    if (r && (r.status === 403 || r.status === 429)) {
      // the site wants us to slow down: wait, then try once more; if it keeps saying no, leave it for later
      if (++refusals >= 3) throw new Error('refused ' + r.status)
      await sleep(5 * 60 * 1000)
      i--
      continue
    }
    refusals = 0
    if (r && r.status === 200) {
      const m = parseMeta(r.html, u)
      tag(site, k, m.genres ?? [], m.type)
    }
    checked.add(k)
    if (i % 25 === 0) {
      site.checked = [...checked]
      restat(site)
      saveSoonIndex()
    }
    await sleep(1000) // one page a second: an ordinary reader's pace
  }
  site.checked = [...checked]
  site.complete = true
  site.at = Date.now()
  restat(site)
  saveIndexNow()
}

// ---- what the app shows while it works ------------------------------------------------------------------------------

export interface GenreJob {
  id: string
  name: string
  state: 'waiting' | 'running' | 'done' | 'paused' | 'skipped'
  phase: string
  done: number
  total: number
  /** milliseconds left, by the pace so far (null: not known yet) */
  etaMs: number | null
  /** titles of this site that have genres now */
  tagged: number
  titles: number
  note?: string
  detail?: string
}
interface Live {
  state: GenreJob['state']
  phase: string
  done: number
  total: number
  /** how long one step takes at the polite pace (used until there is a real measurement) */
  stepMs: number
  /** what is being read right now ("Action, page 120") */
  detail?: string
  t0: number
  done0: number
  note?: string
}
const live = new Map<string, Live>()

function setLive(id: string, patch: Partial<Live>): void {
  const cur = live.get(id) ?? {
    state: 'waiting',
    phase: '',
    done: 0,
    total: 0,
    stepMs: 1000,
    t0: Date.now(),
    done0: 0
  }
  if (patch.phase && patch.phase !== cur.phase) {
    cur.t0 = Date.now()
    cur.done0 = patch.done ?? 0
  }
  live.set(id, { ...cur, ...patch })
}

/** The genre jobs, one per site, for the screen: what is being read, how far it got, and about how long is left. */
export function genreJobs(): GenreJob[] {
  const all = loadIndex()
  return listSources().map((s) => {
    const l = live.get(s.id)
    const site = all[s.id]
    const tagged = site?.stats.titles ?? 0
    let etaMs: number | null = null
    if (l && l.state === 'running' && l.total > 0) {
      const left = Math.max(0, l.total - l.done)
      const did = l.done - l.done0
      const spent = Date.now() - l.t0
      // genre pages: a genre can be 3 pages or 380, so wait for a whole genre before estimating
      const need = l.stepMs >= 20000 ? 1 : 5
      etaMs =
        did >= need && spent > 0 ? (left * spent) / did : l.stepMs >= 20000 ? null : left * l.stepMs
    }
    const done = !l && site?.complete
    const resting = !l && !!site?.failedAt && Date.now() - site.failedAt < 24 * 3600 * 1000
    return {
      id: s.id,
      name: s.name,
      state:
        l?.state ??
        (done ? 'done' : s.id === 'comix-to' ? 'skipped' : resting ? 'paused' : 'waiting'),
      phase: l?.phase ?? '',
      done: l?.done ?? 0,
      total: l?.total ?? 0,
      etaMs,
      tagged,
      titles: s.count,
      note:
        l?.note ??
        (resting
          ? 'Resting: the site asked us to slow down, trying again tomorrow'
          : site?.stats.note),
      detail: l?.detail
    }
  })
}

// ---- background schedule -----------------------------------------------------------------------------------------

/** Sites not to read genres from (Comix: its genres are only in a locked data feed, and it is very large). */
const SKIP = new Set(['comix-to'])

/** Is a site's genre job due: never finished, or finished more than a week ago (refused ones wait a day). */
export function genreScanDue(id: string): boolean {
  if (SKIP.has(id)) return false
  if (getSource(id)?.api) return false // its genres arrive with its title list
  const s = loadIndex()[id]
  if (!s) return true
  if (s.failedAt && Date.now() - s.failedAt < 24 * 3600 * 1000) return false
  if (!s.complete) return true
  return Date.now() - s.at > 7 * 24 * 3600 * 1000
}

export function forgetGenres(id: string): void {
  const all = loadIndex()
  if (all[id]) {
    delete all[id]
    saveIndexNow()
  }
}

/** One site's whole genre job: its best source of genres, then each remaining title's own page. */
async function runSite(src: SourceDef): Promise<void> {
  if (src.api) return // (a site with a data feed gets its genres when its titles are read)
  if (running.has(src.id)) return
  running.add(src.id)
  glog(src.id + ' job begins')
  cancelled.delete(src.id)
  try {
    const host = new URL(src.baseUrl).hostname.replace(/^www\./, '')
    const site = loadIndex()[src.id]
    const fresh = site?.genrePagesAt && Date.now() - site.genrePagesAt < 7 * 24 * 3600 * 1000
    if (host === 'weebcentral.com') {
      setLive(src.id, {
        state: 'running',
        phase: 'Reading the site’s title list with genres',
        done: 0,
        total: 0,
        stepMs: 10000
      })
      await weebcentralFeed(src, (done, total) =>
        setLive(src.id, { state: 'running', done, total })
      )
    } else {
      if (!fresh) {
        setLive(src.id, {
          state: 'running',
          phase: 'Reading genre pages',
          done: 0,
          total: 0,
          stepMs: 20000
        })
        await scanSiteGenres(src, {
          onProgress: (done, total, page, genre) =>
            setLive(src.id, {
              state: 'running',
              done,
              total,
              detail: genre ? genre + (page ? ', page ' + page : '') : undefined
            })
        })
      }
      const browserSeries = getMode(new URL(src.baseUrl).hostname + '|series') === 'browser'
      setLive(src.id, {
        state: 'running',
        phase: 'Reading titles one by one',
        done: 0,
        total: 0,
        stepMs: browserSeries ? 1500 : 1300
      })
      await titlePages(src, (done, total) => setLive(src.id, { state: 'running', done, total }))
    }
    live.delete(src.id)
  } catch (e) {
    const refused = /refused/.test(String(e))
    const all = loadIndex()
    const s = (all[src.id] ??= emptySite())
    if (refused) {
      s.failedAt = Date.now()
      s.stats.note = 'the site asked us to slow down; trying again tomorrow'
      saveIndexNow()
      setLive(src.id, { state: 'paused', note: s.stats.note })
    } else {
      glog(src.id + ' error ' + String((e as Error)?.stack ?? e))
      setLive(src.id, { state: 'paused', note: 'stopped by an error; trying again later' })
    }
  } finally {
    running.delete(src.id)
  }
}

/** For tests: runs one site's genre job (cancel it with cancelGenreScan). */
export const runGenreJob = (src: SourceDef): Promise<void> => runSite(src)

/** Reads one site's genres now (from the Sites screen). Runs in the background. */
export function scanGenresNow(id: string): boolean {
  const src = getSource(id)
  if (!src || running.has(id)) return false
  if (src.api) {
    void crawlSource(id, () => undefined) // reading its titles again refreshes its genres too
    return true
  }
  const s = loadIndex()[id]
  if (s) {
    s.failedAt = undefined
    s.genrePagesAt = undefined
  }
  void runSite(src)
  return true
}

/**
 * Every site's genre job runs side by side, each at its own polite pace (a page a second, or what the site asks for),
 * so no single site gets more than an ordinary reader's traffic while all of them finish in a few hours. Jobs resume
 * where they stopped after a restart; each site is looked at again weekly for new titles. Nothing in offline mode.
 */
/** A short log of the background genre work (genre-log.txt in the data folder), to see what happened. */
function glog(m: string): void {
  if (process.env['MR_SCHED']) console.log('[genres] ' + m)
  try {
    appendFileSync(
      join(app.getPath('userData'), 'genre-log.txt'),
      new Date().toISOString() + ' ' + m + '\n'
    )
  } catch {
    /* no log */
  }
}

export function startGenreScheduler(): void {
  glog(
    'scheduler start, MR vars: ' +
      Object.keys(process.env)
        .filter((k) => k.startsWith('MR_'))
        .join(',')
  )
  // dev test runs: never in the background (MR_SCHED=1 turns it on for a test)
  if (!process.env['MR_SCHED'] && Object.keys(process.env).some((k) => k.startsWith('MR_'))) return
  const tick = (): void => {
    let soon = false
    try {
      const offline = isOffline()
      const sources = offline ? [] : listSources()
      glog('tick offline=' + offline + ' sites=' + sources.length)
      // the catalog can still be loading (or busy) right after start: look again shortly instead of in 10 minutes
      if (!offline && sources.length === 0) soon = true
      if (!offline) {
        for (const s of sources) {
          const why = running.has(s.id)
            ? 'running'
            : s.crawling
              ? 'crawling'
              : !genreScanDue(s.id)
                ? 'not due'
                : ''
          glog(s.id + ' ' + (why || 'start'))
          if (why === 'crawling') soon = true // its title list is being refreshed: start right after
          if (why) continue
          if (running.size >= SITE_SLOTS) {
            soon = true // the rest start as soon as one finishes
            break
          }
          const src = getSource(s.id)
          if (src) {
            if (!live.has(s.id)) setLive(s.id, { state: 'waiting', phase: 'Waiting to start' })
            void runSite(src)
          }
        }
      }
    } catch (e) {
      glog('tick error ' + String((e as Error)?.stack ?? e))
      soon = true
    } finally {
      setTimeout(tick, soon ? 15 * 1000 : 10 * 60 * 1000)
    }
  }
  setTimeout(tick, process.env['MR_SCHED'] ? 5000 : 20 * 1000)
}

// kept for the Sites screen's older status line
export function genreProgress(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const j of genreJobs())
    if (j.state === 'running') out[j.id] = `${j.phase}: ${j.done} of ${j.total || '…'}`
  return out
}
