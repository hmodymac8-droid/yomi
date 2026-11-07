import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type {
  CrawlProgress,
  EnrichedEntry,
  SearchHit,
  SearchResult,
  SeriesDetail,
  SeriesEntry,
  SourceDef,
  SourceInfo
} from '../preload/index.d'
import { hiddenWindow, loadPage, refusedIn, waitXhrIdle } from './grabber'
import { fetchHtml } from './http'
import { parseMeta, parseSeries, parseSeriesList, parseSeriesMeta, upgradeCover, type SeriesMeta, type SeriesType } from './staticParse'
import { readSitemapFile } from './sitemap'
import { robotsAllows } from './robots'
import { getMode, setMode, type Mode } from './hostmode'
import { matchBuiltin } from './sources'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const hostOf = (url: string): string => new URL(url).hostname

interface Store {
  sources: SourceDef[]
  series: Record<string, SeriesEntry[]>
  /** Per site: did a scan reach the end of the list, and how far did it get if not. */
  scan: Record<string, { complete: boolean; lastPage: number }>
  /** Per site: when the last scan attempt ended (not cancelled). Drives the automatic background scans. */
  scanAt?: Record<string, number>
  /** Titles you added by their page address (shown on the main page under "Added by me"). */
  added?: AddedRec[]
}

export interface AddedRec {
  sourceId: string
  sourceName: string
  url: string
  title: string
  cover: string
  chapters: number
}

let store: Store | null = null
let saveTimer: NodeJS.Timeout | undefined
const crawling = new Map<string, { cancel: boolean }>()

const storePath = (): string => join(app.getPath('userData'), 'catalog.json')

function load(): Store {
  if (store) return store
  try {
    if (existsSync(storePath())) store = JSON.parse(readFileSync(storePath(), 'utf8')) as Store
  } catch {
    store = null
  }
  if (!store) store = { sources: [], series: {}, scan: {} }
  store.scan ??= {} // catalogs saved by older versions have no scan state
  pruneForeignEntries(store)
  // Sites made earlier only to hold an added title (no scan, no sitemap) are marked as such
  for (const a of store.added ?? []) {
    const t = store.sources.find((x) => x.id === a.sourceId)
    if (t && !t.titlesOnly && t.maxPages === 0 && !(t.sitemaps && t.sitemaps.length)) t.titlesOnly = true
  }
  if (mergeTitleOnly(store)) saveSoon(true)
  return store
}

const siteHost = (src: SourceDef): string => {
  try {
    return new URL(src.baseUrl).hostname.replace(/^www./i, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * A "titles only" site (made when you added one title by address) is folded into the real site once that one is added:
 * its titles move over and it disappears, so the same site never shows up twice.
 */
function mergeTitleOnly(s: Store): boolean {
  let changed = false
  for (const t of [...s.sources]) {
    if (!t.titlesOnly) continue
    const full = s.sources.find((x) => x !== t && !x.titlesOnly && siteHost(x) === siteHost(t))
    if (!full) continue
    const have = new Set((s.series[full.id] ?? []).map((e) => e.url))
    for (const e of s.series[t.id] ?? []) if (!have.has(e.url)) (s.series[full.id] ??= []).push({ ...e, sourceId: full.id })
    for (const a of s.added ?? []) {
      if (a.sourceId === t.id) {
        a.sourceId = full.id
        a.sourceName = full.name
      }
    }
    s.sources = s.sources.filter((x) => x !== t)
    delete s.series[t.id]
    for (const k of Object.keys(s.scan)) if (k === t.id || k.startsWith(t.id + '#')) delete s.scan[k]
    changed = true
  }
  return changed
}

/**
 * Drops saved entries that don't fit their site's own idea of a series page. This clears out leftovers from an
 * earlier, wrong way of listing a site (e.g. a home page's "latest chapters" cards that were mistaken for series).
 */
/**
 * Pages of a site's own menu (Browse, Top rated, Most popular...) look like series addresses on some sites but are lists.
 */
const NAV_SLUGS = new Set([
  'browse', 'top-rated', 'most-popular', 'most-favorited', 'most-viewed', 'trending', 'latest', 'latest-updates', 'popular',
  'new', 'new-releases', 'recent', 'hot', 'random', 'genres', 'genre', 'search', 'az-list', 'a-z', 'all', 'list', 'completed',
  'ongoing', 'bookmarks', 'history', 'login', 'register', 'contact', 'about', 'faq', 'terms', 'privacy', 'dmca', 'profile',
  'rss', 'sitemap', 'advanced-search', 'manga-list', 'series', 'comics', 'directory'
])
export function isNavUrl(url: string): boolean {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean)
    return segs.length > 0 && NAV_SLUGS.has(segs[segs.length - 1].toLowerCase())
  } catch {
    return false
  }
}

function pruneForeignEntries(s: Store): void {
  let changed = false
  for (const src of s.sources) {
    const list = s.series[src.id]
    if (!list || list.length === 0) continue
    let re: RegExp
    try {
      re = new RegExp(src.seriesRe)
    } catch {
      continue
    }
    const keep = list.filter((e) => re.test(e.url) && !isNavUrl(e.url))
    if (keep.length !== list.length) {
      s.series[src.id] = keep
      changed = true
    }
    for (const e of keep) {
      const t = fixTitle(e.title)
      if (t !== e.title) {
        e.title = t
        changed = true
      }
    }
  }
  if (changed) saveSoon()
}

/** A card that prints the name twice ("Kingdom Kingdom") is the same name once. */
export function fixTitle(t: string): string {
  const m = t.trim().match(/^(.{2,}?)\s+\1$/)
  return m ? m[1] : t
}

// Bumped whenever the catalog changes (every change is followed by a save), so cached search results know when
// they are out of date.
let catalogVersion = 0

function saveSoon(immediate = false): void {
  catalogVersion++
  if (saveTimer) clearTimeout(saveTimer)
  const write = (): void => {
    try {
      writeFileSync(storePath(), JSON.stringify(load()))
    } catch (e) {
      console.error('catalog save failed', e)
    }
  }
  if (immediate) write()
  else saveTimer = setTimeout(write, 2500)
}

const triedEnrich = new Set<string>()

/**
 * Fills in the real title and cover for series that a sitemap listed by URL only, by reading their pages with
 * plain HTTP (a few at a time). Called for the series currently on screen, so only what you look at is fetched.
 */
export async function enrichEntries(urls: string[]): Promise<EnrichedEntry[]> {
  const s = load()
  const want = new Set(urls.slice(0, 40).filter((u) => !triedEnrich.has(u)))
  if (want.size === 0) return []
  const entries: SeriesEntry[] = []
  for (const list of Object.values(s.series)) {
    for (const e of list) if (want.has(e.url) && (e.slugTitle || !e.cover)) entries.push(e)
  }
  for (const u of want) triedEnrich.add(u) // one attempt per series per session
  const out: EnrichedEntry[] = []
  let i = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const e = entries[i++]
      if (!e) return
      try {
        if (!(await robotsAllows(e.url))) continue
        const r = await fetchHtml(e.url, 12000)
        if (r.status !== 200) continue
        const m = parseSeriesMeta(r.html, e.url)
        if (m.title && e.slugTitle) {
          e.title = m.title
          delete e.slugTitle
        }
        if (m.cover && !e.cover) e.cover = m.cover
        out.push({ url: e.url, title: e.title, cover: e.cover })
      } catch {
        /* leave it as it is */
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (out.length > 0) saveSoon()
  return out
}

/** A series page we just opened knows the real title and cover: remember them in the catalog. */
function applyMeta(url: string, d: SeriesDetail): void {
  for (const list of Object.values(load().series)) {
    const e = list.find((x) => x.url === url)
    if (!e) continue
    let changed = false
    if (e.slugTitle && d.title) {
      e.title = d.title
      delete e.slugTitle
      changed = true
    }
    if (!e.cover && d.cover) {
      e.cover = d.cover
      changed = true
    }
    if (changed) saveSoon()
    return
  }
}

/** The first network request of a program run is slow (proxy lookup, TLS). Do it at startup, not on your first click. */
export function primeNetwork(): void {
  for (const s of load().sources) fetchHtml(s.baseUrl, 8000).catch(() => undefined)
}

/** Dev/test helper: how big the catalog file is and how long it takes to serialise (what every save costs). */
export function debugSaveCost(): { entries: number; bytes: number; stringifyMs: number } {
  const s = load()
  const t = Date.now()
  const text = JSON.stringify(s)
  return {
    entries: Object.values(s.series).reduce((n, l) => n + l.length, 0),
    bytes: text.length,
    stringifyMs: Date.now() - t
  }
}

/** Forget how far the scans of a site got (one entry per list: "id", "id#1", "id#2" ...). */
function clearScanState(id: string): void {
  const s = load()
  for (const k of Object.keys(s.scan)) if (k === id || k.startsWith(id + '#')) delete s.scan[k]
}

const bareHost = (h: string): string => h.replace(/^www\./i, '').toLowerCase()

/**
 * Adds ONE title from its page address (no scan of the whole site). If the site is already known its entry is used; if
 * not, the site is added as a "titles only" site (it is never scanned) so only what you paste appears.
 */
export async function addTitleByUrl(input: string): Promise<{
  sourceId: string
  sourceName: string
  url: string
  title: string
  cover: string
  chapters: number
  siteIsNew: boolean
  already: boolean
}> {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : 'https://' + input.trim())
  } catch {
    throw new Error('That does not look like a web address.')
  }
  u.hash = ''
  const s = load()
  const sameHost = (x: SourceDef): boolean => siteHost(x) === bareHost(u.hostname)
  let src = s.sources.find((x) => !x.titlesOnly && sameHost(x)) ?? s.sources.find(sameHost)
  const siteIsNew = !src
  if (!src) {
    const id = bareHost(u.hostname).replace(/[^a-z0-9]+/g, '-')
    const host = bareHost(u.hostname)
    const name = host.split('.').slice(0, -1).join('.') || host
    const segs = u.pathname.split('/').filter(Boolean)
    const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const seriesRe =
      segs.length <= 1 ? `^${esc(u.origin)}/[^/?#]+/?$` : `^${esc(u.origin)}/${esc(segs[0])}/${Array(segs.length - 1).fill('[^/?#]+').join('/')}/?$`
    const builtin = matchBuiltin(u.origin + '/')
    src = addSource({
      ...(builtin ?? {
        id,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        baseUrl: u.origin + '/',
        listTemplate: u.origin + '/',
        seriesRe,
        chapterRe: '(?:chapter|chap|ch|episode|ep|read)[-_/ ]?\\d'
      }),
      id,
      maxPages: 0, // titles only: this site is never scanned
      titlesOnly: true,
      sitemaps: [],
      sitemapChecked: true
    }) as SourceDef
  }
  const url = u.toString()
  const d = await getSeries(src.id, url)
  // page titles often end with the site's name ("Title | Project Suki"): drop that part
  {
    const base = bareHost(u.hostname).split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '')
    const m = d.title.match(/^(.+?)\s+[|–—-]\s+([^|–—]{2,40})$/)
    const tail = m?.[2].toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
    if (m && base && tail.length >= 3 && (tail.includes(base) || base.includes(tail))) d.title = m[1].trim()
  }
  if (d.chapters.length === 0) throw new Error('No chapters were found at that address. Is it the page of one title (not a chapter or a list)?')
  const list = (s.series[src.id] ??= [])
  const old = list.find((e) => e.url === url)
  const already = !!old
  if (old) {
    if (d.title) old.title = d.title
    if (d.cover) old.cover = d.cover
    old.slugTitle = false
  } else {
    list.push({ sourceId: src.id, url, title: d.title, cover: d.cover })
  }
  const rec: AddedRec = { sourceId: src.id, sourceName: src.name, url, title: d.title, cover: d.cover, chapters: d.chapters.length }
  s.added = [rec, ...(s.added ?? []).filter((x) => x.url !== url)]
  saveSoon(true)
  return { ...rec, siteIsNew, already }
}

export function listAdded(): AddedRec[] {
  return load().added ?? []
}

/** Takes a title off the "Added by me" list. On a titles-only site (never scanned) it also leaves the catalog. */
export function removeAdded(url: string): void {
  const s = load()
  s.added = (s.added ?? []).filter((x) => x.url !== url)
  for (const src of s.sources) {
    if (src.titlesOnly && s.series[src.id]) {
      s.series[src.id] = s.series[src.id].filter((e) => e.url !== url)
    }
  }
  saveSoon(true)
}

/** Brings in titles that an earlier version kept only inside the window's own storage. */
export function importAdded(list: AddedRec[]): void {
  const s = load()
  const have = new Set((s.added ?? []).map((x) => x.url))
  const more = list.filter((x) => x && x.url && !have.has(x.url))
  if (more.length === 0) return
  s.added = [...(s.added ?? []), ...more]
  saveSoon(true)
}

export function getSource(id: string): SourceDef | undefined {
  return load().sources.find((s) => s.id === id)
}

export function listSources(): SourceInfo[] {
  const s = load()
  return s.sources
    .filter((src) => !src.titlesOnly)
    .map((src) => ({
    ...src,
    count: s.series[src.id]?.length ?? 0,
    crawling: crawling.has(src.id)
  }))
}

export function addSource(def: SourceDef): SourceInfo {
  const s = load()
  const old = s.sources.find((x) => x.id === def.id)
  if (!old) {
    s.sources.push(def)
    s.series[def.id] = []
    saveSoon(true)
  } else {
    const structural =
      old.listTemplate !== def.listTemplate ||
      old.seriesRe !== def.seriesRe ||
      old.maxPages !== def.maxPages ||
      JSON.stringify(old.sitemaps ?? null) !== JSON.stringify(def.sitemaps ?? null) ||
      JSON.stringify(old.listTemplates ?? null) !== JSON.stringify(def.listTemplates ?? null)
    if (structural || !!old.sitemapChecked !== !!def.sitemapChecked) {
      // Same site added again with a better way of listing it: use the new definition and keep the titles we have.
      Object.assign(old, def)
      // A new way of listing means the next scan should walk the whole list again; a bare flag change doesn't.
      if (structural) clearScanState(def.id)
      saveSoon(true)
    }
  }
  mergeTitleOnly(s)
  return listSources().find((x) => x.id === def.id) ?? ({ ...def, count: 0, crawling: false } as SourceInfo)
}

/**
 * Sites added before chapter-link detection was fixed hold chapter links (…/reader/<series>/138) as if they were
 * series. Returns the sites where most saved "series" look like that, so they can be rebuilt.
 */
export function sourcesWithChapterTitles(): string[] {
  const s = load()
  const out: string[] = []
  for (const src of s.sources) {
    const list = s.series[src.id] ?? []
    // a site that was set up but has no titles and no way to list them (older detection picked a page the site forbids): redo it
    if (list.length === 0 && !src.titlesOnly && src.maxPages === 0 && !(src.sitemaps && src.sitemaps.length)) out.push(src.id)
    if (list.length === 0) continue
    const bad = list.filter((e) => {
      try {
        const segs = new URL(e.url).pathname.split('/').filter(Boolean)
        return segs.length >= 3 && /^\d+(?:[._-]\d+)?$/.test(segs[segs.length - 1]) && !/^\d+$/.test(segs[segs.length - 2])
      } catch {
        return false
      }
    }).length
    if (bad > list.length * 0.4) out.push(src.id)
  }
  return out
}

/**
 * Is it time for an automatic background scan of this site? A site whose last scan did not reach the end of its list is
 * tried again after 30 minutes (it resumes where it stopped); a finished one is refreshed every 12 hours for new titles.
 */
export function scanDue(id: string): boolean {
  const s = load()
  const src = s.sources.find((x) => x.id === id)
  if (!src || crawling.has(id)) return false
  if (src.maxPages <= 0 && !src.sitemaps?.length) return false // nothing to scan
  const at = s.scanAt?.[id] ?? 0
  const incomplete = Object.keys(s.scan).some((k) => (k === id || k.startsWith(id + '#')) && !s.scan[k].complete)
  const never = !s.scan[id] && !src.sitemaps?.length
  const fast = !!process.env['MR_AUTOSCAN_FAST'] // dev tests: every wait is 1 s
  return Date.now() - at > (fast ? 1000 : incomplete || never ? 30 * 60 * 1000 : 12 * 3600 * 1000)
}

export function removeSource(id: string): void {
  const s = load()
  crawling.get(id) && (crawling.get(id)!.cancel = true)
  s.sources = s.sources.filter((x) => x.id !== id)
  delete s.series[id]
  clearScanState(id)
  saveSoon(true)
}

export function cancelCrawl(id: string): void {
  const c = crawling.get(id)
  if (c) c.cancel = true
}

// ---------------------------------------------------------------------------------------------
// Series list pages (the catalog scan)
// ---------------------------------------------------------------------------------------------

type ListItem = { url: string; title: string; cover: string }

// Runs inside the page: finds series cards (links matching seriesRe) with title + cover.
const extractScript = (seriesRe: string): string => `(() => {
  const re = new RegExp(${JSON.stringify(seriesRe)});
  const map = new Map();
  const imgSrc = (img) => {
    for (const a of ['data-src', 'data-lazy-src', 'data-original', 'src']) {
      const v = img.getAttribute(a);
      if (v && !v.startsWith('data:')) { try { return new URL(v, location.href).href; } catch {} }
    }
    return '';
  };
  const matches = (a) => re.test(a.href.split('#')[0]);
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href.split('#')[0];
    if (!re.test(href)) continue;
    let img = a.querySelector('img');
    if (!img) {
      const card = a.closest('li, article, div');
      if (card) {
        const urls = new Set([...card.querySelectorAll('a[href]')].filter(matches).map(x => x.href.split('#')[0]));
        if (urls.size === 1) img = card.querySelector('img');
      }
    }
    const cur = map.get(href) || { url: href, title: '', cover: '', p: 9 };
    const cands = [
      [1, a.getAttribute('title')],
      [2, img && img.getAttribute('alt')],
      [3, (a.textContent || '')]
    ];
    for (const [p, t] of cands) {
      const text = (t || '').trim().replace(/\\s+/g, ' ');
      if (text && text.length < 150 && p < cur.p) { cur.title = text; cur.p = p; }
    }
    if (!cur.cover && img) cur.cover = imgSrc(img);
    map.set(href, cur);
  }
  return [...map.values()].map(({ url, title, cover }) => ({ url, title, cover }));
})()`

function titleFromUrl(url: string): string {
  const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? url)
  return last.replace(/-[0-9a-f]{24}$/, '').replace(/[-_]+/g, ' ').trim()
}

async function extractWithPolling(win: BrowserWindow, seriesRe: string, maxMs = 9000): Promise<ListItem[]> {
  const start = Date.now()
  let items: ListItem[] = []
  // Some sites render the list with JavaScript after load: poll until something shows up.
  while (Date.now() - start < maxMs) {
    items = await win.webContents.executeJavaScript(extractScript(seriesRe))
    if (items.length > 0) {
      await sleep(150) // let lazy-set covers settle once
      return await win.webContents.executeJavaScript(extractScript(seriesRe))
    }
    await sleep(200)
  }
  return items
}

async function staticList(src: SourceDef, url: string): Promise<ListItem[]> {
  const r = await fetchHtml(url)
  if (r.status !== 200) return []
  return parseSeriesList(r.html, url, src.seriesRe)
}

/**
 * A few reusable light browser windows, used when plain HTTP isn't enough (sites that build their lists with
 * JavaScript). Each window handles one page at a time; pages are spread over the windows round-robin.
 */
function makeBrowserLister(
  src: SourceDef,
  size = 1
): { list: (url: string) => Promise<ListItem[]>; close: () => void } {
  const wins: (BrowserWindow | null)[] = Array.from({ length: size }, () => null)
  const chains: Promise<unknown>[] = Array.from({ length: size }, () => Promise.resolve())
  let turn = 0
  return {
    list: (url) => {
      const i = turn++ % size
      const run = async (): Promise<ListItem[]> => {
        let w = wins[i]
        if (!w || w.isDestroyed()) {
          w = hiddenWindow({ light: true })
          wins[i] = w
        }
        await loadPage(w, url, 30000)
        return extractWithPolling(w, src.seriesRe, 9000)
      }
      const p = chains[i].then(run, run)
      chains[i] = p.catch(() => undefined)
      return p
    },
    close: () => {
      for (const w of wins) if (w && !w.isDestroyed()) w.destroy()
    }
  }
}

/** Does plain HTTP find the same series as the real browser on this site? Decided once, then remembered. */
async function decideListMode(
  src: SourceDef,
  firstUrl: string,
  lister: ReturnType<typeof makeBrowserLister>
): Promise<Mode> {
  const key = hostOf(src.baseUrl) + '|list'
  const known = getMode(key)
  if (known) return known
  const [s, b] = await Promise.allSettled([staticList(src, firstUrl), lister.list(firstUrl)])
  const sItems = s.status === 'fulfilled' ? s.value : []
  const bItems = b.status === 'fulfilled' ? b.value : []
  const bUrls = new Set(bItems.map((i) => i.url))
  const overlap = sItems.filter((i) => bUrls.has(i.url)).length
  const ok = sItems.length > 0 && (bItems.length === 0 || (sItems.length >= bItems.length * 0.9 && overlap >= bItems.length * 0.9))
  const mode: Mode = ok ? 'static' : 'browser'
  if (sItems.length + bItems.length > 0) setMode(key, mode)
  return mode
}

/** Turns a series URL into a readable title when all we have is the URL (sitemaps list no titles). */
function makeSlugTitler(urls: string[]): (url: string) => string {
  const lastSeg = (u: string): string => {
    try {
      return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() ?? '')
    } catch {
      return ''
    }
  }
  // Some sites put a short random id in front of the name ("53nqm-mirkos-special-training"). Strip it only when
  // practically every URL has one and most of those contain a digit; ordinary names like "one-piece" don't.
  const slugs = urls.slice(0, 400).map(lastSeg)
  const prefixed = slugs.filter((s) => /^[a-z0-9]{3,6}-./.test(s))
  const stripPrefix =
    slugs.length >= 20 &&
    prefixed.length >= slugs.length * 0.98 &&
    prefixed.filter((s) => /\d/.test(s.split('-')[0])).length >= prefixed.length * 0.55
  return (u) => {
    let s = lastSeg(u).replace(/-[0-9a-f]{24}$/, '')
    if (stripPrefix) s = s.replace(/^[a-z0-9]{3,6}-/, '')
    return s.replace(/[-_]+/g, ' ').trim().replace(/\b([a-z])/g, (c) => c.toUpperCase())
  }
}

/** Reads the site's sitemap files (a few at a time) and adds every series URL they list. */
async function importSitemaps(
  src: SourceDef,
  known: Map<string, SeriesEntry>,
  s: Store,
  emit: (p: CrawlProgress) => void,
  ctl: { cancel: boolean }
): Promise<void> {
  const files = src.sitemaps ?? []
  if (files.length === 0) return
  const re = new RegExp(src.seriesRe)
  const queue = [...files]
  let done = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const f = queue.shift()
      if (!f || ctl.cancel) return
      try {
        if (await robotsAllows(f)) {
          const rows = (await readSitemapFile(f)).filter((r) => re.test(r.loc.split('#')[0]))
          const titleOf = makeSlugTitler(rows.map((r) => r.loc))
          for (const r of rows) {
            const url = r.loc.split('#')[0]
            const old = known.get(url)
            if (old) {
              if (!old.cover && r.image) old.cover = r.image
              continue
            }
            if (isNavUrl(url)) continue
            known.set(url, { sourceId: src.id, url, title: titleOf(url), cover: r.image ?? '', slugTitle: true })
          }
        }
      } catch {
        /* skip this file; the next scan tries again */
      }
      done++
      s.series[src.id] = [...known.values()]
      saveSoon()
      emit({ sourceId: src.id, pages: done, found: known.size, done: false })
      await sleep(150)
    }
  }
  await Promise.all([worker(), worker(), worker()])
}

export async function crawlSource(id: string, emit: (p: CrawlProgress) => void): Promise<void> {
  const src = getSource(id)
  if (!src || crawling.has(id)) return
  const ctl = { cancel: false }
  crawling.set(id, ctl)
  const s = load()
  const known = new Map<string, SeriesEntry>((s.series[id] ?? []).map((e) => [e.url, e]))
  let found = known.size
  let pages = 0
  let error: string | undefined
  const lister = makeBrowserLister(src, 2)
  try {
    // 1) The site's sitemap, if it has one: the complete list of series in seconds.
    await importSitemaps(src, known, s, emit, ctl)
    found = known.size

    // 2) The page scan, once per list. Most sites have one list. A site that can only be listed through its search
    //    has one search per letter, and they are scanned one after another and merged.
    const templates = src.listTemplates?.length ? src.listTemplates : [src.listTemplate]
    for (let ti = 0; ti < templates.length && !ctl.cancel; ti++) {
    // A finished scan means "refresh": start at page 1 and stop at the first batch with nothing new.
    // An unfinished scan (stopped, closed mid-way, or failed) resumes from the page it reached.
    const stateKey = ti === 0 ? id : `${id}#${ti}`
    const state = (s.scan[stateKey] ??= { complete: false, lastPage: 0 })
    const refresh = state.complete
    const startPage = refresh ? 1 : Math.max(1, state.lastPage)
    const urlFor = (p: number): string => templates[ti].replace('{n}', String(p))

    // With a sitemap the page scan only fills in real titles and covers, so a few dozen pages are enough;
    // without one it IS the list. It only runs if the site's robots.txt allows it.
    const scanCap = src.sitemaps?.length ? Math.min(src.maxPages, 40) : src.maxPages
    const scanAllowed = scanCap > 0 && (await robotsAllows(urlFor(startPage)))
    if (scanCap > 0 && !scanAllowed && !src.sitemaps?.length) {
      error = "This site's robots.txt asks automated tools not to read its list pages, so it can't be scanned."
    }
    const lastScanPage = scanAllowed ? scanCap : 0
    const mode: Mode = lastScanPage > 0 ? await decideListMode(src, urlFor(startPage), lister) : 'browser'

    const fetchListPage = async (p: number): Promise<{ items: ListItem[]; error?: string }> => {
      const url = urlFor(p)
      if (mode === 'static') {
        try {
          const items = await staticList(src, url)
          if (items.length > 0) return { items }
        } catch {
          /* fall through to the browser */
        }
      }
      let err = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return { items: await lister.list(url) }
        } catch (e) {
          err = e instanceof Error ? e.message : String(e)
        }
      }
      return { items: [], error: err }
    }

    // Plain HTTP can fetch several pages at once; the browser fallback uses a few windows side by side.
    // (browser-built lists are usually API-backed and rate-limited, so go gently there)
    const concurrency = mode === 'static' ? 4 : 2
    let zeroBatches = 0
    for (let n = startPage; n <= lastScanPage && !ctl.cancel; n += concurrency) {
      const nums = Array.from({ length: Math.min(concurrency, lastScanPage - n + 1) }, (_, i) => n + i)
      const results = await Promise.all(nums.map(fetchListPage))
      let added = 0
      let ended = false
      for (let i = 0; i < nums.length; i++) {
        let r = results[i]
        if (r.items.length === 0 && !r.error && nums[i] > startPage) {
          // An empty page could be the real end of the list, or the site briefly refusing us (rate limit).
          // Wait and look again before deciding it is the end.
          for (const wait of [3000, 9000]) {
            if (ctl.cancel) break
            await sleep(wait)
            const retry = await fetchListPage(nums[i])
            if (retry.items.length > 0 || retry.error) {
              r = retry
              break
            }
          }
        }
        if (r.items.length === 0) {
          // Past the last page (a real end) or a page error. Only a clean end counts as complete.
          if (r.error) error = r.error
          else if (nums[i] > 1) state.complete = true
          ended = true
          break
        }
        for (const it of r.items) {
          const old = known.get(it.url)
          if (old) {
            // a sitemap only knows the URL: the real title / cover from the page replaces the guess (counts as progress)
            if (old.slugTitle && it.title) {
              old.title = fixTitle(it.title)
              delete old.slugTitle
              added++
            }
            if (!old.cover && it.cover) {
              old.cover = it.cover
              added++
            }
            continue
          }
          if (isNavUrl(it.url)) continue
          known.set(it.url, { sourceId: id, url: it.url, title: fixTitle(it.title) || titleFromUrl(it.url), cover: it.cover })
          added++
        }
        pages = nums[i]
        if (!refresh) state.lastPage = nums[i]
      }
      found = known.size
      s.series[id] = [...known.values()]
      saveSoon()
      emit({ sourceId: id, pages, found, done: false })
      if (ended) break
      if (added === 0) {
        zeroBatches++
        // refresh: we've reached titles we already have. resume: two empty batches in a row means the
        // site is repeating itself (it ignored our page number).
        if (refresh || zeroBatches >= 2) {
          if (!refresh) state.complete = true
          break
        }
      } else zeroBatches = 0
      await sleep(mode === 'static' ? 80 : 600)
    }
    if (!ctl.cancel && !error && lastScanPage > 0 && pages >= lastScanPage) state.complete = true
    } // (end of this list)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    lister.close()
    crawling.delete(id)
    if (!ctl.cancel) (s.scanAt ??= {})[id] = Date.now()
    s.series[id] = [...known.values()]
    saveSoon(true)
    emit({ sourceId: id, pages, found: known.size, done: true, error })
  }
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

const norm = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Normalising a title (accents, punctuation, case) is the slow part of a search across 300,000 entries, so it is done
// once per title and remembered (and redone only if the title changes).
const keyMemo = new WeakMap<SeriesEntry, { t: string; k: string }>()
function titleKey(e: SeriesEntry): string {
  const m = keyMemo.get(e)
  if (m && m.t === e.title) return m.k
  const k = norm(e.title)
  keyMemo.set(e, { t: e.title, k })
  return k
}

// A group is one title as it appears across the searched sites. It only points at the entries (cheap); the full
// result object the screen needs is built for the 60 titles on the page being shown, not for all 168,000.
interface Grp {
  key: string
  e: SeriesEntry // the first entry: its title is the one shown
  src: SourceDef
  coverE: SeriesEntry | null // the first entry that has a cover
  coverSrc: SourceDef | null
  more?: { e: SeriesEntry; src: SourceDef }[] // the same title on other sites
}

// The last full list of groups, so turning pages (or re-asking the same thing) costs nothing until the catalog changes.
let lastSearch: { sig: string; groups: Grp[] } | null = null

function toHit(g: Grp): SearchHit {
  // Covers are stored as scanned (often tiny thumbnails). Show the bigger original, keep the thumbnail as a fallback.
  const withCover = g.coverE
  return {
    key: g.key,
    title: g.e.title,
    cover: withCover ? upgradeCover(withCover.cover) : '',
    coverFallback: withCover ? withCover.cover : g.e.cover,
    needsInfo: withCover ? !!withCover.slugTitle : true,
    coverReferer: (g.coverSrc ?? g.src).baseUrl,
    entries: [
      { sourceId: g.src.id, sourceName: g.src.name, url: g.e.url },
      ...(g.more ?? []).map((m) => ({ sourceId: m.src.id, sourceName: m.src.name, url: m.e.url }))
    ]
  }
}

/** `sourceIds` are the sites to search; an empty list means all of them. */
export function search(
  q: string,
  sourceIds: string[],
  sort: 'site' | 'az',
  offset: number,
  limit: number,
  kind?: SeriesType
): SearchResult {
  const sig = `${catalogVersion}|${metaVersion}|${q}|${sourceIds.join(',')}|${sort}`
  if (lastSearch && lastSearch.sig === sig) return pick(lastSearch.groups, kind, offset, limit)
  const s = load()
  const tokens = norm(q).split(' ').filter(Boolean)
  const only = sourceIds.length > 0 ? new Set(sourceIds) : null
  const map = new Map<string, Grp>()
  for (const src of s.sources) {
    if (only && !only.has(src.id)) continue
    for (const e of s.series[src.id] ?? []) {
      const key = titleKey(e)
      if (!key) continue
      if (tokens.length && !tokens.every((t) => key.includes(t))) continue
      const g = map.get(key)
      if (!g) {
        map.set(key, { key, e, src, coverE: e.cover ? e : null, coverSrc: e.cover ? src : null })
      } else {
        if (!g.coverE && e.cover) {
          g.coverE = e
          g.coverSrc = src
        }
        // the same site listing the title twice is still one place to read it: show each site once
        if (g.src.id === src.id || (g.more ?? []).some((m) => m.src.id === src.id)) continue
        ;(g.more ??= []).push({ e, src })
      }
    }
  }
  const groups = [...map.values()]
  // In "site order" put titles that have a cover first (sitemap-only titles have none until they're filled in).
  if (sort === 'site' && !tokens.length) groups.sort((a, b) => Number(!!b.coverE) - Number(!!a.coverE))
  if (sort === 'az' || tokens.length) {
    const first = tokens[0] ?? ''
    groups.sort((a, b) => {
      if (first) {
        const as = a.key.startsWith(first) ? 0 : 1
        const bs = b.key.startsWith(first) ? 0 : 1
        if (as !== bs) return as - bs
      }
      // (keys are plain a-z / 0-9 / space, so a direct comparison orders them the same way and is much faster)
      return sort === 'az' || first ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : 0
    })
  }
  lastSearch = { sig, groups }
  return pick(groups, kind, offset, limit)
}

// ---- type / genres / status of series, as their pages stated them (kept apart from the chapter-list cache) ----
let metaStore: Record<string, SeriesMeta> | null = null
let metaVersion = 0
let metaTimer: NodeJS.Timeout | undefined
const metaPath = (): string => join(app.getPath('userData'), 'series-meta.json')
function loadMeta(): Record<string, SeriesMeta> {
  if (metaStore) return metaStore
  try {
    metaStore = existsSync(metaPath()) ? JSON.parse(readFileSync(metaPath(), 'utf8')) : {}
  } catch {
    metaStore = {}
  }
  return metaStore!
}
function rememberMeta(url: string, d: SeriesMeta): void {
  if (!d.type && !d.genres && !d.status) return
  const m = loadMeta()
  const prev = m[url]
  const next: SeriesMeta = { type: d.type ?? prev?.type, genres: d.genres ?? prev?.genres, status: d.status ?? prev?.status }
  if (JSON.stringify(prev) === JSON.stringify(next)) return
  m[url] = next
  metaVersion++
  if (metaTimer) clearTimeout(metaTimer)
  metaTimer = setTimeout(() => {
    try {
      writeFileSync(metaPath(), JSON.stringify(m))
    } catch {
      /* not critical */
    }
  }, 1500)
}
/** A saved series with what its page said about it last time (lists saved before this was read have none). */
function withMeta(d: SeriesDetail): SeriesDetail {
  const m = loadMeta()[d.url]
  return m ? { ...d, type: d.type ?? m.type, genres: d.genres ?? m.genres, status: d.status ?? m.status } : d
}
export function seriesMeta(url: string): SeriesMeta | undefined {
  return loadMeta()[url]
}
/** A site whose own name says what it hosts. Mixed sites get no default: an unknown type stays unknown. */
const hostKind = new Map<string, SeriesType | null>()
function siteKind(src: SourceDef): SeriesType | null {
  let k = hostKind.get(src.id)
  if (k === undefined) {
    const host = (() => {
      try {
        return new URL(src.baseUrl).hostname
      } catch {
        return ''
      }
    })()
    k = /manhwa/i.test(host) ? 'manhwa' : /manhua/i.test(host) ? 'manhua' : null
    hostKind.set(src.id, k)
  }
  return k
}
function kindOf(g: Grp): SeriesType | null {
  const m = loadMeta()
  for (const x of [{ e: g.e, src: g.src }, ...(g.more ?? [])]) {
    const t = m[x.e.url]?.type ?? siteKind(x.src)
    if (t) return t
  }
  return null
}
const kindMemo = new WeakMap<Grp[], { v: number; kinds: (SeriesType | null)[] }>()
function pick(groups: Grp[], kind: SeriesType | undefined, offset: number, limit: number): SearchResult {
  let memo = kindMemo.get(groups)
  if (!memo || memo.v !== metaVersion) {
    memo = { v: metaVersion, kinds: groups.map(kindOf) }
    kindMemo.set(groups, memo)
  }
  const counts = { manga: 0, manhwa: 0, manhua: 0 }
  for (const k of memo.kinds) if (k) counts[k]++
  const list = kind ? groups.filter((_, i) => memo!.kinds[i] === kind) : groups
  return { total: list.length, hits: list.slice(offset, offset + limit).map(toHit), counts }
}

// ---------------------------------------------------------------------------------------------
// Series pages (chapter lists)
// ---------------------------------------------------------------------------------------------

type Ch = SeriesDetail['chapters'][number]

const seriesScript = (chapterRe: string, slug: string): string => `(() => {
  const re = new RegExp(${JSON.stringify(chapterRe)}, 'i');
  const slug = ${JSON.stringify(slug)};
  const n = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const meta = (p) => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? m.content : ''; };
  const seen = new Set();
  const chapters = [];
  // innerText keeps the visual separation between "C. 1" and "1d ago"; textContent glues them together.
  const text = (a) => (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ');
  // A chapter is a link whose ADDRESS looks like one (…/chapter-12) OR whose visible text does ("Chapter 12"):
  // some sites use opaque addresses (…/chapters/01J76X…), so the address alone misses their whole list.
  const byText = (t) => /^(vol(ume)?\\.?\\s*\\d+\\s*[,:.\\-]?\\s*)?(chapter|chap\\.?|ch\\.?|episode|ep\\.?|ال?فصل|حلقة|الحلقة)\\s*\\d/i.test(t);
  // A link below this series' own address that has "chapter 12" / "vol-2" in its path is one of its chapters, even
  // with a long title in the address (…/the-series/vol-2-chapter-16-power-of-the-darkness).
  const base = location.pathname.replace(/\\/$/, '');
  const underBase = (h) => { try { const u = new URL(h); return !!base && u.origin === location.origin && u.pathname.startsWith(base + '/') && /(chapter|chap|episode|ep|ch)[-_ ]?\\d|vol[-_ ]?\\d/i.test(u.pathname.slice(base.length)); } catch (e) { return false; } };
  // "Start Reading", "Read first", "Latest" buttons point at chapters but are not chapters themselves.
  const junk = (t) => /^(start|read|continue|first|last|latest|new)\\b/i.test(t) && !/\\d/.test(t);
  // Sites that number chapters by address only: …/reader/<series-slug>/138 (no "chapter" word anywhere).
  const lastSeg = decodeURIComponent(base.split('/').pop() || '').replace(/[.*+?^$()|[\\]{}\\\\]/g, '\\\\$&');
  const slugNumRe = lastSeg ? new RegExp('/' + lastSeg + '/(\\\\d+(?:[._-]\\\\d+)?)/?$', 'i') : null;
  const slugNum = (h) => { if (!slugNumRe) return null; try { const m = slugNumRe.exec(decodeURIComponent(new URL(h).pathname)); return m ? m[1] : null; } catch (e) { return null; } };
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href.split('#')[0];
    let t = text(a);
    const sn = slugNum(href);
    try { if (new URL(href).pathname.replace(/\\/$/, '') === base) continue; } catch (e) { /* keep going */ }
    if ((!re.test(href) && !byText(t) && !underBase(href) && sn === null) || junk(t) || seen.has(href)) continue;
    // a whole card of text is no title: name it by its number
    if (sn !== null) t = 'Chapter ' + sn.replace(/[_-]/g, '.');
    seen.add(href);
    chapters.push({ title: t.slice(0, 80), url: href });
  }
  // Chapter lists shipped as data inside the page (a JSON script tag) rather than as links.
  if (slugNumRe) {
    const raw = document.documentElement.innerHTML.replace(/\\\\\\//g, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const found = raw.match(new RegExp('https?://[^"\\'\\\\s<>\\\\\\\\,)]*/' + lastSeg + '/\\\\d+(?:[._-]\\\\d+)?/?(?=["\\'\\\\s<>\\\\\\\\,)]|$)', 'gi')) || [];
    for (const f of found) { const h = f.split('#')[0]; const sn = slugNum(h); if (sn === null || seen.has(h)) continue; seen.add(h); chapters.push({ title: 'Chapter ' + sn.replace(/[_-]/g, '.'), url: h }); }
  }
  // Pages often show "related"/"popular" series too: keep only chapters whose URL mentions this series.
  // (Sites with opaque chapter URLs have no slug in them, so then everything is kept.)
  const own = slug ? chapters.filter((c) => n(c.url).includes(slug)) : [];
  const ownCount = own.length;
  if (own.length > 0) chapters.splice(0, chapters.length, ...own);
  const h1 = document.querySelector('h1');
  return {
    ownCount,
    title: (h1 && h1.textContent.trim()) || meta('og:title') || document.title,
    cover: meta('og:image'),
    description: meta('og:description') || '',
    chapters
  };
})()`

// Clicks one "next page" pager button, or "show/view/load more" buttons. Returns true if it clicked.
// Only real buttons (or href-less/"#" links) are clicked, so we never navigate away from the series page.
const CLICK_MORE = `(() => {
  // (the page script only marks what to press; the app then presses it with a real mouse click, see clickMarked)
  const mark = (e) => e.setAttribute('data-mr-click', '1');
  const clickable = (el) => {
    // Only a real disabled state counts; utility classes like Tailwind's "disabled:opacity-50" must not.
    const cls = typeof el.className === 'string' ? el.className : '';
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || /(^|\\s)(is-)?disabled(\\s|$)/i.test(cls)) return false;
    if (el.tagName === 'A') { const h = el.getAttribute('href'); return !h || h === '#' || h.startsWith('javascript'); }
    return true;
  };
  const els = [...document.querySelectorAll('button, [role=button], a')];
  // (whitespace inside a label, like "Show all 35 chapters   · 19", must not make it look too long)
  const label = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const next = els.find((el) => { const t = label(el); return t.length < 12 && /^(next\\b|›$)/.test(t) && clickable(el); });
  if (next) { mark(next); return true; }
  // Numbered pager (1 2 3 4 ...): click the next number. Pages also contain other bare numbers (comment vote
  // counts, ratings), which must never be clicked. So the pager is identified once, strictly: a small group of
  // clickable numbers that starts at 1 and counts up (1 2 3 ...). After that, only that group is ever used.
  const numText = (el) => (el.textContent || '').trim();
  const isNum = (el) => /^\\d{1,4}$/.test(numText(el)) && clickable(el);
  if (window.__mrNoPager !== true) {
    if (!window.__mrPager || !window.__mrPager.isConnected) {
      window.__mrPager = null;
      const numEls = els.filter(isNum);
      for (const el of numEls) {
        let anc = el.parentElement;
        for (let d = 0; d < 4 && anc && !window.__mrPager; d++, anc = anc.parentElement) {
          const inside = [...new Set(numEls.filter((x) => anc.contains(x)).map((x) => Number(numText(x))))].sort((a, b) => a - b);
          // must be a run 1,2,3,... of at least three numbers
          if (inside.length >= 3 && inside[0] === 1 && inside.every((n, i) => n === i + 1)) window.__mrPager = anc;
        }
        if (window.__mrPager) break;
      }
      if (!window.__mrPager && window.__mrPagerTried) window.__mrNoPager = true;
      window.__mrPagerTried = true;
    }
    if (window.__mrPager) {
      window.__mrPage = window.__mrPage || 1; // a fresh window per series: we start on page 1
      const want = String(window.__mrPage + 1);
      const target = els.find((el) => window.__mrPager.contains(el) && isNum(el) && numText(el) === want);
      if (target) { window.__mrPage += 1; mark(target); return true; }
    }
  }
  let any = false;
  for (const el of els) {
    const t = label(el);
    if (t.length < 45 && /^(show|view|load|see|expand)\\s+(all|more|the rest)/.test(t) && clickable(el)) { mark(el); any = true; }
  }
  return any;
})()`

// The number of chapters the page says the series has ("Chapters (198)", "198 chapters", "Showing 50 of 198 chapters"), or 0.
const DECLARED_TOTAL = `(() => {
  const t = (document.body.innerText || '').replace(/\\s+/g, ' ');
  // Several numbers can sit next to the word "chapters" (a tab label "Chapters 70", "+3 chapters" in a review): the
  // page's own total is the biggest of them.
  const pats = [/showing\\s+\\d+\\s+of\\s+(\\d+)\\s+chapters?/gi, /\\bchapters(\\d{1,5})(?!\\d)/gi, /chapters?\\s*\\(\\s*(\\d{1,5})\\s*\\)/gi, /\\b(\\d{1,5})\\s+chapters\\b/gi, /\\bchapters\\s+(\\d{1,5})\\b/gi];
  // the patterns are in order of trust: the first one that matches anything decides (its biggest number)
  for (const re of pats) {
    let best = 0;
    // (a year right before the word, as in "Released 2025 Chapters 96", is not a chapter count)
    for (const m of t.matchAll(re)) { const n = Number(m[1]); if (n >= 1990 && n <= 2099) continue; best = Math.max(best, n); }
    if (best > 0) return best < 20000 ? best : 0;
  }
  return 0;
})()`

// Repeats the data requests the page made that look like chapter lists (JSON) and collects every object in the answer
// that has a chapter-looking address. Returns [{title, url}] (absolute addresses).
const HARVEST_DATA = `(async () => {
  const skip = (u) => /[.](js|css|png|jpe?g|webp|svg|woff2?|ico|gif|avif|map)$/i.test(u.split('?')[0]);
  const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name))]
    .filter((u) => /chapter|episode|chap/i.test(u) && !/comment|review|bookmark|view/i.test(u) && !skip(u))
    .slice(0, 4);
  const found = [];
  const walk = (o, depth) => {
    if (!o || depth > 8) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o !== 'object') return;
    const link = ['url', 'href', 'link', 'path', 'permalink'].map((k) => o[k]).find((v) => typeof v === 'string' && v.length > 2);
    if (link && /(chapter|chap|episode|ep|ch)[-_/ ]?[0-9]/i.test(link)) {
      try {
        const nm = o.name || o.title || o.chapter_title || '';
        found.push({ title: typeof nm === 'string' ? nm.slice(0, 80) : '', url: new URL(link, location.href).href.split('#')[0] });
      } catch (e) { /* not an address */ }
    }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  for (const u of urls) {
    try {
      const r = await fetch(u, { credentials: 'include' });
      if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) continue;
      walk(await r.json(), 0);
    } catch (e) { /* skip this request */ }
  }
  return found;
})()`

// Many sites keep the chapter list in a box that scrolls by itself and load the next slice when you reach its
// bottom. Scroll every such box (and the page) to its end. Returns true if anything actually moved, i.e. there may
// be more to load.
const INNER_SCROLL = `(() => {
  let moved = false;
  for (const e of document.querySelectorAll('div,ul,section,main,aside')) {
    if (!['auto', 'scroll'].includes(getComputedStyle(e).overflowY)) continue;
    if (e.scrollHeight <= e.clientHeight + 40) continue;
    if (e.querySelectorAll('a[href]').length < 10) continue;
    const atBottom = e.scrollTop + e.clientHeight >= e.scrollHeight - 4;
    e.scrollTop = e.scrollHeight;
    if (!atBottom) moved = true;
  }
  const doc = document.documentElement;
  const pageAtBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 4;
  window.scrollTo(0, doc.scrollHeight);
  return moved || !pageAtBottom;
})()`

const NUM = '(\\d+(?:\\.\\d+)?)'

/** Chapter number from the visible title (used to merge the same chapter listed by several providers). */
function numFromTitle(t: string): string | null {
  const m = t.match(new RegExp(`\\bC\\.\\s*${NUM}`, 'i')) || t.match(new RegExp(`\\b(?:chapter|chap|ch|ep|episode)\\.?\\s*${NUM}`, 'i'))
  return m ? m[1] : null
}

/** Chapter number from the title, falling back to the URL. */
function chapterNum(c: Ch): number | null {
  const t = numFromTitle(c.title)
  if (t !== null) return Number(t)
  const m =
    c.url.match(new RegExp(`(?:chapter|chap|ch|ep|episode)[-_/ ]?${NUM}`, 'i')) || c.url.match(new RegExp(`_${NUM}/?$`))
  return m ? Number(m[1]) : null
}

/**
 * Some sites list the same chapter once per provider (e.g. three "Chapter 12" links from different
 * scan hosts). Merge them into one chapter and keep the other links as fallbacks.
 */
function mergeProviders(list: { title: string; url: string }[]): Ch[] {
  const out: Ch[] = []
  const byNum = new Map<string, Ch>()
  for (const c of list) {
    const num = numFromTitle(c.title)
    // One consistent name: "Chapter 34", whatever the site prints ("Ch. 34 108p Today", "34", "Ch.170 Thunderscans 4h ago").
    const shown = num ?? (chapterNum(c) !== null ? String(chapterNum(c)) : null)
    const title = shown !== null ? `Chapter ${shown}` : c.title || 'Chapter'
    if (num) {
      const have = byNum.get(num)
      if (have) {
        have.alts = [...(have.alts ?? []), c.url]
        continue
      }
      const entry: Ch = { title, url: c.url, alts: [] }
      byNum.set(num, entry)
      out.push(entry)
    } else {
      out.push({ title, url: c.url })
    }
  }
  return out.map((c) => (c.alts && c.alts.length === 0 ? { title: c.title, url: c.url } : c))
}

/** Newest chapter first, whatever order the site printed them in. Chapters without a number go last. */
function sortChapters(list: Ch[]): Ch[] {
  const withNum = list.map((c, i) => ({ c, i, n: chapterNum(c) }))
  if (withNum.filter((x) => x.n !== null).length < list.length * 0.6) return list
  withNum.sort((a, b) => {
    if (a.n === null && b.n === null) return a.i - b.i
    if (a.n === null) return 1
    if (b.n === null) return -1
    return b.n - a.n || a.i - b.i
  })
  return withNum.map((x) => x.c)
}

/** Drop other series' chapters, merge providers, sort. */
function finalizeChapters(list: { title: string; url: string }[], slug: string): Ch[] {
  const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const own = slug ? list.filter((c) => flat(c.url).includes(slug)) : []
  return sortChapters(mergeProviders(own.length > 0 ? own : list))
}

/**
 * Chapter lists split into slices that have their own plain address ("…/?tab=chapters&chapter_page=2"). Finds which
 * address style works (page 2 must bring chapters we don't have yet), then walks the slices until the page's own
 * chapter count is reached. Adds what it finds to `acc`.
 */
/**
 * Presses what CLICK_MORE marked with a real (trusted) mouse click. Many sites ignore clicks made by page scripts
 * (they check that a person did it), but react to the same click sent as input to the window.
 */
async function clickMarked(win: BrowserWindow): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const scrolled: string | null = await win.webContents
      .executeJavaScript(
        `(() => { const e = document.querySelector('[data-mr-click]'); if (!e) return null; e.removeAttribute('data-mr-click'); window.__mrTarget = e; e.scrollIntoView({ block: 'center', behavior: 'instant' }); return 'scrolled'; })()`
      )
      .catch(() => null)
    if (!scrolled) return
    await sleep(150)
    const r: { x: number; y: number } | null = await win.webContents
      .executeJavaScript(
        `(() => { const e = window.__mrTarget; const q = e.getBoundingClientRect();
          // an ad overlay or sticky banner sitting on top of the button would swallow the click: let clicks pass through it
          for (let k = 0; k < 4; k++) { const top = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); if (!top || top === e || e.contains(top) || top.contains(e)) break; top.style.setProperty('pointer-events', 'none', 'important'); } if (q.width < 1 || q.height < 1) { e.click(); return { x: -1, y: -1 }; } return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`
      )
      .catch(() => null)
    if (process.env['MR_PAGERDEBUG']) console.log('CLICKMARKED ' + JSON.stringify(r))
    if (!r) return
    if (r.x < 0) continue // had no size on screen: the script click above was all we could do
    win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(80)
  }
}

async function queryPaging(
  src: SourceDef,
  url: string,
  slug: string,
  acc: Map<string, { title: string; url: string }>,
  declared: number
): Promise<void> {
  const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const base = url.split('#')[0].split('?')[0]
  // What the plain page itself holds: a slicing style that just hands back this same page (it ignores the parameter)
  // must not count as "found a new slice".
  let page1 = new Set<string>()
  try {
    const r1 = await fetchHtml(base)
    if (r1.status === 200) page1 = new Set(parseSeries(r1.html, base, src.chapterRe).chapters.map((c) => c.url))
  } catch {
    /* no baseline: the acc check below still applies */
  }
  const ownNew = (list: { title: string; url: string }[]): { title: string; url: string }[] =>
    list.filter((c) => !acc.has(c.url) && !page1.has(c.url) && (!slug || flat(c.url).includes(slug)))
  const styles = ['?tab=chapters&chapter_page=', '?chapter_page=', '?chapters_page=', '?cpage=', '?tab=chapters&page=', '?page=']
  const fetchPage = async (style: string, n: number): Promise<{ title: string; url: string }[]> => {
    const r = await fetchHtml(base + style + n)
    return r.status === 200 ? parseSeries(r.html, base, src.chapterRe).chapters : []
  }
  try {
    let style: string | null = null
    let first: { title: string; url: string }[] = []
    for (const st of styles) {
      const got = ownNew(await fetchPage(st, 2))
      if (process.env['MR_PAGERDEBUG']) console.log('QPAGE style=' + st + ' page2 new=' + got.length + ' slug=' + slug)
      if (got.length > 0) {
        style = st
        first = got
        break
      }
    }
    if (!style) return
    for (const c of first) acc.set(c.url, c)
    for (let n = 3; n <= 60 && acc.size < declared; n++) {
      const got = ownNew(await fetchPage(style, n))
      if (got.length === 0) break
      for (const c of got) acc.set(c.url, c)
    }
  } catch {
    /* keep what we have */
  }
}

async function browserSeries(src: SourceDef, url: string, slug: string, firstPageOnly = false, depth = 0): Promise<SeriesDetail> {
  const win = hiddenWindow({ light: true })
  try {
    await loadPage(win, url)
    type Run = SeriesDetail & { ownCount: number }
    const run = async (): Promise<Run> => ({
      ...(await win.webContents.executeJavaScript(seriesScript(src.chapterRe, slug))),
      url
    })
    // Some sites build the chapter list with JavaScript after the page loads. The page can already hold
    // chapter links of OTHER series (sidebars), so wait until this series' own chapters show up; for sites
    // whose chapter URLs don't contain the series name, wait until the list stops changing.
    // First let the page finish its own data requests (many sites fetch the chapter list a moment after load),
    // then scroll to the bottom (lazy lists), then wait for those requests too.
    // (the quick newest-chapters check settles faster: it only needs what the page shows first)
    await (firstPageOnly ? waitXhrIdle(win, 300, 5000, 350) : waitXhrIdle(win, 450, 8000, 700))
    if (!firstPageOnly) {
      // (the newest-chapters check only needs what is on screen; a full read also wakes up lazy lists)
      await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)').catch(() => undefined)
      await waitXhrIdle(win, 350, 3000, 200)
    }
    let out = await run()
    let prevSig = ''
    let stableRounds = 0
    const deadline = Date.now() + 40000 // a series page never takes longer than this, whatever the site does
    for (let i = 0; i < 50; i++) {
      // the site already refused the request that carries the chapter list: no point waiting for it
      if (out.chapters.length === 0 && i >= 8 && refusedIn(win).some((r) => r.status === 403 || r.status === 429)) break
      if (out.chapters.length > 0) {
        if (!slug || out.ownCount > 0) break
        const sig = out.chapters.map((c) => c.url).join('|')
        stableRounds = sig === prevSig ? stableRounds + 1 : 0
        prevSig = sig
        if (stableRounds >= 3) break
      }
      await sleep(200)
      out = await run()
    }
    // Chapters can be spread over pager pages or behind "show more" buttons, and the DOM only shows
    // the current page, so collect links across rounds.
    const acc = new Map<string, { title: string; url: string }>()
    // The page itself usually asks the site's server for the chapter list (a JSON data request). Ask the same question
    // and read the answer: it holds the WHOLE list even when the page draws only the newest chapters.
    if (!firstPageOnly && slug) {
      const flatSlug = (u: string): string => u.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const got: { title: string; url: string }[] = await win.webContents.executeJavaScript(HARVEST_DATA).catch(() => [])
      for (const c of got)
        if (!acc.has(c.url) && flatSlug(c.url).includes(slug)) acc.set(c.url, { url: c.url, title: c.title || decodeURIComponent(c.url.split('/').pop() ?? '') })
      if (process.env['MR_PAGERDEBUG']) console.log('HARVEST ' + got.length + ' kept=' + acc.size)
    }
    let idleRounds = 0
    for (let round = 0; round < 80 && Date.now() < deadline; round++) {
      const before = acc.size
      for (const c of out.chapters) if (!acc.has(c.url)) acc.set(c.url, c)
      // The page's own data can list chapters that are not drawn as links yet (only the newest are): read them too.
      if (!firstPageOnly && slug) {
        const html: string = await win.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => '')
        const flatSlug = (u: string): string => u.toLowerCase().replace(/[^a-z0-9]+/g, '')
        if (html) for (const c of parseSeries(html, url, src.chapterRe).chapters) if (!acc.has(c.url) && flatSlug(c.url).includes(slug)) acc.set(c.url, c)
      }
      // Clicking on but nothing new arrives (e.g. a pager that keeps "working" past its last page): stop.
      if (round > 0 && acc.size === before) {
        if (++idleRounds >= 2) break
      } else idleRounds = 0
      const sig = out.chapters.map((c) => c.url).join('|')
      if (process.env['MR_PAGERDEBUG']) {
        const labels = await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('button,[role=button],a')].map(e=>(e.textContent||'').trim()).filter(t=>/^\\d{1,4}$|^[‹›«»…]|^\\.\\.\\.|next|prev/i.test(t)).join(' ')`
        )
        console.log('PAGER round=' + round + ' chapters=' + out.chapters.length + ' acc=' + acc.size + ' labels=[' + labels + ']')
      }
      if (firstPageOnly) break // update checks only need the newest chapters: don't walk the whole list
      // Show what we have so far: the screen can list the first chapters while the rest are still coming.
      if (acc.size > 0) partialEmitter({ ...out, url, chapters: finalizeChapters([...acc.values()], slug) })
      // More to load? Either a button/pager to press, or a box that loads the next slice when scrolled to its end.
      // Many pages say how many chapters there are ("Chapters (198)", "Showing 50 of 198 chapters"): while we have
      // fewer than that, a button that does nothing yet (the page is still starting up) is retried, not given up on.
      const declared: number = await win.webContents.executeJavaScript(DECLARED_TOTAL).catch(() => 0)
      const wantMore = declared > 0 && acc.size < declared * 0.98
      let changed = false
      for (let attempt = 0; attempt < (wantMore ? 4 : 1) && !changed; attempt++) {
        let clicked: boolean = await win.webContents.executeJavaScript(CLICK_MORE)
        if (clicked) await clickMarked(win)
        if (!clicked) clicked = await win.webContents.executeJavaScript(INNER_SCROLL)
        if (process.env['MR_PAGERDEBUG']) console.log('MORE attempt=' + attempt + ' declared=' + declared + ' have=' + acc.size + ' clicked=' + clicked + ' refused=' + JSON.stringify(refusedIn(win).slice(-3)) + ' now=' + (await win.webContents.executeJavaScript(`document.querySelectorAll('a[href*=chapter]').length`).catch(() => '?')))
        if (!clicked) {
          if (!wantMore) break
          await sleep(600) // the button may not exist yet
          continue
        }
        // wait for the list to actually change after that instead of a fixed pause
        await waitXhrIdle(win, 250, 2500, 120) // the next slice is usually a data request: let it finish
        for (let i = 0; i < 20; i++) {
          await sleep(100)
          out = await run()
          if (out.chapters.map((c) => c.url).join('|') !== sig) {
            changed = true
            break
          }
        }
      }
      if (process.env['MR_PAGERDEBUG']) console.log('MORECHG ' + url + ' sample=' + JSON.stringify(out.chapters.slice(0, 2)) + ' changed=' + changed + ' now=' + out.chapters.length + ' dom=' + (await win.webContents.executeJavaScript(`[document.querySelectorAll('a[href*=chapter]').length, [...document.querySelectorAll('a[href]')].filter((a) => a.pathname.startsWith(location.pathname + '/')).length, [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /more|load/i.test(t)).join('|')].join(' ')`).catch(() => -1)))
      if (!changed) break
    }
    if (acc.size === 0) {
      const refused = refusedIn(win).find((r) => r.status === 403 || r.status === 429)
      if (refused)
        throw new Error(
          `The site refused to send this chapter list (HTTP ${refused.status}). It is probably limiting requests ` +
            'right now; try again in a few minutes.'
        )
    }
    const declaredEnd: number = firstPageOnly ? 0 : await win.webContents.executeJavaScript(DECLARED_TOTAL).catch(() => 0)
    // The page says it has more chapters than we collected and its button did nothing: many sites also serve the
    // other slices at plain addresses (?chapter_page=2 ...). Try those.
    let pagingTried = false
    if (declaredEnd >= 10 && acc.size < declaredEnd * 0.9) {
      pagingTried = true
      await queryPaging(src, url, slug, acc, declaredEnd)
    } else if (!firstPageOnly && depth === 0) {
      // Plain pager LINKS on the page (…/series/ABC?page=2): the series page shows one slice at a time and no button
      // loads the rest. Walk those addresses until a page brings nothing new.
      const hasPagerLinks: boolean = await win.webContents
        .executeJavaScript(`[...document.querySelectorAll('a[href]')].some((a) => a.origin === location.origin && a.pathname === location.pathname && /[?&](page|chapter_page|chapters_page|cpage)=2(&|$)/.test(a.search))`)
        .catch(() => false)
  if (process.env['MR_PAGERDEBUG']) console.log('PAGERLINKS ' + hasPagerLinks)
      if (hasPagerLinks) {
        pagingTried = true
        await queryPaging(src, url, slug, acc, 100000)
      }
    }
    // Self-check: the list has holes or is far shorter than its newest chapter says. Try the other ways of reaching
    // the rest before giving up (plain addresses for the slices), then let the check below flag whatever is left.
    if (!firstPageOnly && depth === 0 && !pagingTried && looksIncomplete(finalizeChapters([...acc.values()], slug))) {
      await queryPaging(src, url, slug, acc, 100000)
    }
    // Aggregator sites list several "sources" per series, each with its own page holding the full chapter list while the
    // series page shows only the newest chapter of each: follow the first (biggest) source.
    if (depth === 0 && declaredEnd >= 10 && acc.size < declaredEnd * 0.9) {
      const sourceUrl: string = await win.webContents.executeJavaScript(`(() => { const a = [...document.querySelectorAll('a[href]')].find((x) => /\\/sources?\\/[^/?#]+\\/?$/i.test(x.pathname) && x.origin === location.origin); return a ? a.href : '' })()`).catch(() => '')
      if (sourceUrl && sourceUrl !== url) {
        try {
          const sub = await browserSeries(src, sourceUrl, '', false, 1)
          for (const c of sub.chapters) if (!acc.has(c.url)) acc.set(c.url, { title: c.title, url: c.url })
        } catch {
          /* keep what we have */
        }
      }
    }
    const chapters = finalizeChapters([...acc.values()], slug)
    const short = declaredEnd >= 10 && chapters.length < declaredEnd * 0.9
    // type / genres / status, from the page as it is now (read once, while the page is open anyway)
    const html: string = await win.webContents.executeJavaScript('document.documentElement.outerHTML.slice(0, 1500000)').catch(() => '')
    return { ...out, ...parseMeta(html, url), chapters, incomplete: looksIncomplete(chapters) || short || undefined }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * A list with 2 chapters whose newest is "Chapter 66" is missing most of them (series are normally numbered
 * 1, 2, 3 ...). This catches lists that were read before the page had finished loading, or only the first slice.
 */
export function looksIncomplete(chapters: { title: string; url: string }[]): boolean {
  const nums = chapters.map((c) => chapterNum(c)).filter((n): n is number => n !== null && n < 5000)
  if (nums.length === 0) return false
  const max = Math.max(...nums)
  if (max >= 10 && chapters.length < max * 0.6) return true
  // Holes in the numbering (21..60 and then 0): the middle slice was never read. A few missing numbers are normal
  // (skipped or merged chapters); a big share of the range missing is not.
  const min = Math.min(...nums)
  if (max - min >= 10) {
    const have = new Set(nums.filter((n) => Number.isInteger(n)))
    let missing = 0
    for (let n = Math.ceil(min); n <= max; n++) if (!have.has(n)) missing++
    if (missing > Math.max(3, (max - min + 1) * 0.2)) return true
  }
  return false
}

async function staticSeries(src: SourceDef, url: string, slug: string): Promise<SeriesDetail | null> {
  try {
    const r = await fetchHtml(url)
    if (r.status !== 200) return null
    const p = parseSeries(r.html, url, src.chapterRe)
    if (process.env['MR_PIPEDEBUG']) console.log('STATIC', url, 'status', r.status, 'chapters', p.chapters.length, 'paged', p.paged)
    if (p.paged || p.chapters.length === 0) return null
    // Pager links to the same page (…?page=2): this is only the first slice of the list.
    if (/href="[^"]*[?&](?:page|chapter_page|chapters_page|cpage)=2(?:&|")/i.test(r.html.replace(/&amp;/g, '&'))) return null
    // The static HTML may only hold other series' chapter links (the real list is added by JavaScript).
    const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (slug && !p.chapters.some((c) => flat(c.url).includes(slug))) return null
    const chapters = finalizeChapters(p.chapters, slug)
    // The page handed over only a slice (the rest is added by JavaScript after load): not a usable answer.
    if (looksIncomplete(chapters)) return null
    return { url, title: p.title, cover: p.cover, description: p.description, ...parseMeta(r.html, url), chapters }
  } catch {
    return null
  }
}

// Chapter lists are cached on disk: the series page opens instantly and refreshes in the background.
interface SeriesCacheEntry {
  /** When the full list was last read. */
  at: number
  /** When the list was last checked for new chapters (a quick look at the newest page counts). */
  checkedAt?: number
  detail: SeriesDetail
}
let seriesCache: Record<string, SeriesCacheEntry> | null = null
let seriesTimer: NodeJS.Timeout | undefined
const seriesCachePath = (): string => join(app.getPath('userData'), 'series-cache.json')

const SERIES_CACHE_VERSION = 7

function loadSeriesCache(): Record<string, SeriesCacheEntry> {
  if (seriesCache) return seriesCache
  try {
    if (existsSync(seriesCachePath())) seriesCache = JSON.parse(readFileSync(seriesCachePath(), 'utf8'))
  } catch {
    seriesCache = null
  }
  seriesCache ??= {}
  const rec = seriesCache as unknown as Record<string, unknown>
  if (rec['__v'] !== SERIES_CACHE_VERSION) {
    // Chapter lists saved before the fixes may be half-loaded (2 chapters instead of 90): start clean.
    for (const k of Object.keys(rec)) delete rec[k]
    rec['__v'] = SERIES_CACHE_VERSION
    seriesTimer = setTimeout(flushSeriesCache, 1500)
  }
  return seriesCache
}

export function flushSeriesCache(): void {
  if (seriesTimer) clearTimeout(seriesTimer)
  seriesTimer = undefined
  if (!seriesCache) return
  try {
    writeFileSync(seriesCachePath(), JSON.stringify(seriesCache))
  } catch {
    /* not critical */
  }
}

const chapterKeyOf = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Adds chapters that are new (not in the saved list) from a quick look at the newest page, and notes that the
 * list was checked just now. The rest of the saved list is left alone: nothing is re-read.
 */
export function mergeNewest(url: string, newest: SeriesDetail): SeriesDetail | null {
  const c = loadSeriesCache()[url]
  if (!c) return null
  const have = new Set(c.detail.chapters.map((ch) => chapterKeyOf(ch.title)))
  const fresh = newest.chapters.filter((ch) => !have.has(chapterKeyOf(ch.title)))
  c.detail = {
    ...c.detail,
    chapters: fresh.length > 0 ? sortChapters([...fresh, ...c.detail.chapters]) : c.detail.chapters,
    description: c.detail.description || newest.description,
    type: newest.type ?? c.detail.type,
    genres: newest.genres ?? c.detail.genres,
    status: newest.status ?? c.detail.status,
    cover: c.detail.cover || newest.cover
  }
  c.checkedAt = Date.now()
  rememberMeta(url, c.detail)
  if (seriesTimer) clearTimeout(seriesTimer)
  seriesTimer = setTimeout(flushSeriesCache, 1500)
  return c.detail
}

/** Dev/test helper: forget the newest `n` chapters of a saved list and mark it as checked a long time ago. */
export function debugTrimSeries(url: string, n: number): void {
  const c = loadSeriesCache()[url]
  if (!c) return
  c.detail = { ...c.detail, chapters: c.detail.chapters.slice(n) }
  c.checkedAt = 0
}

const CHECK_EVERY = 30 * 60 * 1000

/**
 * What opening a series does. A chapter list is read in full once and then kept:
 *  auto  - saved list, no network if it was checked in the last 30 minutes; otherwise only the newest page is
 *          looked at and new chapters are added to the saved list
 *  check - the same quick look, right now ("Check for new chapters")
 *  full  - read everything again ("Reload full list")
 * A series never read before is read in full, once.
 */
export async function openSeries(
  sourceId: string,
  url: string,
  mode: 'auto' | 'check' | 'full' = 'auto'
): Promise<SeriesDetail> {
  const c = loadSeriesCache()[url]
  const saved = c && c.detail.chapters.length > 0 ? c : null
  if (mode === 'full' || !saved) return getSeries(sourceId, url)
  if (mode === 'auto' && Date.now() - (saved.checkedAt ?? saved.at) < CHECK_EVERY) return withMeta(saved.detail)
  const newest = await getSeries(sourceId, url, true)
  return withMeta(mergeNewest(url, newest) ?? saved.detail)
}

function cacheSeries(d: SeriesDetail): void {
  rememberMeta(d.url, d)
  const c = loadSeriesCache()
  c[d.url] = { at: Date.now(), checkedAt: Date.now(), detail: d }
  const keys = Object.keys(c)
  if (keys.length > 300) {
    keys.sort((a, b) => c[a].at - c[b].at)
    for (const k of keys.slice(0, keys.length - 300)) delete c[k]
  }
  if (seriesTimer) clearTimeout(seriesTimer)
  seriesTimer = setTimeout(flushSeriesCache, 1500)
}

export function getSeriesCached(url: string): SeriesDetail | null {
  const d = loadSeriesCache()[url]?.detail
  return d && d.chapters.length > 0 ? withMeta(d) : null // (older versions could have saved an empty list)
}

/**
 * `newestOnly` is for background update checks: read just the newest chapters (one page), never the whole list,
 * so checking many series stays light on the sites. Such partial results are not saved as the chapter list.
 */
// Partial chapter lists (while a long list is still being read) go to the screens through this.
let partialEmitter: (d: SeriesDetail) => void = () => undefined
export function setSeriesPartialEmitter(fn: (d: SeriesDetail) => void): void {
  partialEmitter = fn
}

// One read per series at a time: opening a series that is already being read (say, from hovering its cover)
// joins that read instead of starting a second one.
const seriesInflight = new Map<string, Promise<SeriesDetail>>()

export function getSeries(sourceId: string, url: string, newestOnly = false): Promise<SeriesDetail> {
  if (newestOnly) return getSeriesInner(sourceId, url, true)
  const running = seriesInflight.get(url)
  if (running) return running
  const p = getSeriesInner(sourceId, url, false).finally(() => seriesInflight.delete(url))
  seriesInflight.set(url, p)
  return p
}

let prefetchingSeries = false
/**
 * Hovering a cover: read that series' chapter list in the background so opening it is instant. One at a time,
 * and skipped if it was read in the last 10 minutes.
 */
export async function prefetchSeries(sourceId: string, url: string): Promise<void> {
  if (prefetchingSeries || seriesInflight.has(url)) return
  prefetchingSeries = true
  try {
    await openSeries(sourceId, url) // (a series that was checked recently costs nothing)
  } catch {
    /* it's only a head start */
  } finally {
    prefetchingSeries = false
  }
}

async function getSeriesInner(sourceId: string, url: string, newestOnly = false): Promise<SeriesDetail> {
  const src = getSource(sourceId)
  if (!src) throw new Error('Unknown source')
  // Series slug (without a trailing 24-hex id), used to drop chapters of unrelated series.
  const slug = titleFromUrl(url).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const key = hostOf(url) + '|series'
  const mode = getMode(key)
  let result: SeriesDetail

  if (newestOnly) {
    return (mode === 'static' ? await staticSeries(src, url, slug) : null) ?? (await browserSeries(src, url, slug, true))
  }
  if (mode === 'browser') {
    result = await browserSeries(src, url, slug)
  } else if (mode === 'static') {
    result = (await staticSeries(src, url, slug)) ?? (await browserSeries(src, url, slug))
  } else {
    // First series opened on this site: do it both ways and see if plain HTTP finds the same chapters.
    const [s, b] = await Promise.allSettled([staticSeries(src, url, slug), browserSeries(src, url, slug)])
    const sv = s.status === 'fulfilled' ? s.value : null
    if (b.status === 'rejected') {
      if (!sv) throw b.reason
      result = sv
    } else {
      const bv = b.value
      const same = !!sv && sv.chapters.length === bv.chapters.length && sv.chapters[0]?.url === bv.chapters[0]?.url
      // The plain page can hold MORE than the browser view (a list shown 13 at a time, the rest in the page's data):
      // then plain HTTP is the better way for this site, not the worse one.
      const staticWins = !!sv && !!bv.incomplete && sv.chapters.length > bv.chapters.length
      const staticMore = !!sv && sv.chapters.length > bv.chapters.length * 1.2 && sv.chapters.length >= bv.chapters.length + 3
      if (bv.chapters.length > 0 || sv) setMode(key, same || staticWins || staticMore ? 'static' : 'browser')
      result = sv && (staticWins || staticMore) ? sv : bv
    }
  }
  // An empty list is never saved: it would hide the last good list and show "no chapters" instantly next time.
  if (result.chapters.length > 0) cacheSeries(result)
  applyMeta(url, result)
  return result
}
