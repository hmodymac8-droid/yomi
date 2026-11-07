import type { BrowserWindow } from 'electron'
import type { SourceDef } from '../preload/index.d'
import { hiddenWindow, loadPageReady, pageIsChallenge, waitForHuman } from './grabber'
import { discoverSitemap } from './sitemap'
import { robotsAllows } from './robots'

export const BUILTIN_SOURCES: SourceDef[] = [
  {
    id: 'manhwatop',
    name: 'ManhwaTop',
    baseUrl: 'https://manhwatop.com/',
    listTemplate: 'https://manhwatop.com/manga/page/{n}/',
    seriesRe: '^https://manhwatop\\.com/manga/[^/?#]+/?$',
    chapterRe: '/manga/[^/]+/chapter-[^/]+/?$',
    maxPages: 1200
  },
  {
    id: 'mangafreak',
    name: 'MangaFreak',
    baseUrl: 'https://ww3.mangafreak.me/',
    listTemplate: 'https://ww3.mangafreak.me/Mangalist/All/{n}',
    seriesRe: '^https://ww3\\.mangafreak\\.me/Manga/[^/?#]+$',
    chapterRe: '/Read1_',
    maxPages: 400
  },
  {
    id: 'baetoon',
    name: 'BaeToon',
    baseUrl: 'https://baetoon.com/',
    listTemplate: 'https://baetoon.com/advanced-search?page={n}',
    seriesRe: '^https://baetoon\\.com/title-detail/[^/?#]+$',
    chapterRe: '/chapter-detail/',
    maxPages: 600
  }
]

const sameHost = (a: string, b: string): boolean => {
  const h = (u: string): string => new URL(u).hostname.replace(/^www\./, '')
  return h(a) === h(b)
}

export function matchBuiltin(url: string): SourceDef | undefined {
  return BUILTIN_SOURCES.find((s) => sameHost(s.baseUrl, url))
}

function slugId(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

function prettyName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '')
  const base = host.split('.').slice(0, -1).join('.') || host
  return base.charAt(0).toUpperCase() + base.slice(1)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Runs in the page: returns links that wrap an image (series "cards") plus every link on the page.
const SNAPSHOT = `(() => {
  const cards = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (a.querySelector('img')) cards.push(a.href.split('#')[0]);
  }
  const all = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href.split('#')[0]))];
  // The page's search box: its field name and where it submits (some sites can only be listed through search).
  const box = document.querySelector('input[type=search], input[name=q], input[name=s], input[name=query], input[name=keyword], input[name=search]');
  const search = box && box.name ? { name: box.name, action: box.form && box.form.action ? box.form.action : location.href } : null;
  return { cards, all, title: document.title, search };
})()`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Reads the page's cards and links as soon as they have appeared and stopped changing (JavaScript sites fill
 * the list in after load). Stops early for "verify you are human" screens, since nothing will appear there.
 */
/** Size of the biggest group of same-looking links (same number of path parts and first part) on this host. */
function bestGroupSize(cards: string[], host: string): number {
  const groups = new Map<string, Set<string>>()
  for (const href of cards) {
    try {
      const p = new URL(href)
      if (p.hostname !== host) continue
      const segs = p.pathname.split('/').filter(Boolean)
      if (segs.length === 0) continue
      const key = segs.length === 1 ? '1|*' : `${segs.length}|${segs[0]}`
      groups.set(key, (groups.get(key) ?? new Set()).add(p.origin + p.pathname))
    } catch {
      /* skip */
    }
  }
  return Math.max(0, ...[...groups.values()].map((g) => g.size))
}

async function snapshot(
  win: BrowserWindow,
  host: string,
  maxMs = 7000
): Promise<{ cards: string[]; all: string[]; title: string; search: { name: string; action: string } | null }> {
  const start = Date.now()
  let last = { cards: [] as string[], all: [] as string[], title: '', search: null as { name: string; action: string } | null }
  let prev = -1
  while (Date.now() - start < maxMs) {
    last = await win.webContents.executeJavaScript(SNAPSHOT)
    // Navigation icons and banners also count as "cards", so wait for a real group of look-alike series links
    // (6 or more) and for it to stop growing.
    const group = bestGroupSize(last.cards, host)
    if (process.env['MR_TRACE2']) console.log(`TRACE2   poll +${Date.now() - start}ms cards=${last.cards.length} group=${group} prev=${prev}`)
    if (group >= 6) {
      if (group === prev && Date.now() - start > 700) break
      prev = group
    } else if (Date.now() - start > 2500 && /just a moment|attention required|security verification/i.test(last.title)) {
      break
    } else if (Date.now() - start > 3500) {
      break // no real group of series links after 3.5 s: a page that doesn't exist or isn't a list
    }
    await sleep(250)
  }
  await sleep(150) // a pager often renders a moment after the cards
  const again = await win.webContents.executeJavaScript(SNAPSHOT)
  return again.cards.length >= last.cards.length ? again : last
}

interface Analysis {
  cards: number
  /** The series URLs found on the page (used to tell whether another page shows different series). */
  cardUrls: string[]
  seriesRe: string
  /** URL template with {n} when a "page 2" link was found, else the page itself. */
  listTemplate: string
  paged: boolean
  links: string[]
  /** The page's search box (field name + where it submits), if it has one. */
  searchForm: { name: string; action: string } | null
}

const isPage2 = (p: URL): boolean =>
  /[?&](page|p|paged)=2(?:&|$)/.test(p.search) || /\/(?:page\/)?2\/?$/.test(p.pathname)

/** Looks at one page: how many series cards it has, what their URLs look like, and how it paginates. */
async function analyze(win: BrowserWindow, pageUrl: string): Promise<Analysis> {
  const tA = Date.now()
  await loadPageReady(win, pageUrl, 20000)
  const tLoaded = Date.now()
  const u = new URL(pageUrl)
  const host = u.hostname
  const snap = await snapshot(win, host)
  if (process.env['MR_TRACE'])
    console.log(`TRACE   analyze ${pageUrl.slice(-34)}: load ${tLoaded - tA}ms + cards ${Date.now() - tLoaded}ms`)

  const groups = new Map<string, Set<string>>()
  for (const href of snap.cards) {
    let p: URL
    try {
      p = new URL(href)
    } catch {
      continue
    }
    if (p.hostname !== host) continue
    const segs = p.pathname.split('/').filter(Boolean)
    if (segs.length === 0) continue
    const key = segs.length === 1 ? `1|*` : `${segs.length}|${segs[0]}`
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key)!.add(p.origin + p.pathname)
  }
  // Home pages are full of "latest chapters" cards. Those are chapter pages, not series: skip any group whose
  // links look like chapters (…/chapter-893, …/chapters/<id>/…), or the app would list chapters as titles.
  const chapterish = /(chapter|chap|episode|ep|read)[-_/ ]?\d|\/chapters?\//i
  // Also chapters: …/reader/<series-slug>/138 (the chapter is only a number after the series name, no "chapter" word).
  const numberTail = (path: string): boolean => {
    const s = path.split('/').filter(Boolean)
    return s.length >= 3 && /^\d+(?:[._-]\d+)?$/.test(s[s.length - 1]) && !/^\d+$/.test(s[s.length - 2])
  }
  const isChapterGroup = (set: Set<string>): boolean =>
    [...set].filter((u) => {
      const p = new URL(u).pathname
      return chapterish.test(p) || numberTail(p)
    }).length > set.size * 0.4
  const best = [...groups.entries()].filter(([, set]) => !isChapterGroup(set)).sort((a, b) => b[1].size - a[1].size)[0]
  const empty: Analysis = { cards: 0, cardUrls: [], seriesRe: '', listTemplate: pageUrl, paged: false, links: snap.all, searchForm: snap.search }
  if (!best) return empty

  const [countStr, first] = best[0].split('|')
  const count = Number(countStr)
  const origin = escapeRe(u.origin)
  const seriesRe =
    count === 1
      ? `^${origin}/[^/?#]+/?$`
      : `^${origin}/${escapeRe(first)}/${Array(count - 1).fill('[^/?#]+').join('/')}/?$`

  // Pagination: look for a link to "page 2" and turn the 2 into {n}.
  const next = snap.all.find((h) => {
    try {
      const p = new URL(h)
      return p.hostname === host && isPage2(p)
    } catch {
      return false
    }
  })
  let listTemplate = pageUrl
  if (next) {
    const p = new URL(next)
    listTemplate = /[?&](page|p|paged)=2(?:&|$)/.test(p.search)
      ? next.replace(/([?&](?:page|p|paged)=)2(?=&|$)/, '$1{n}')
      : next.replace(/2(\/?)$/, '{n}$1')
  }
  return { cards: best[1].size, cardUrls: [...best[1]], seriesRe, listTemplate, paged: !!next, links: snap.all, searchForm: snap.search }
}

/**
 * Many sites show their page numbers as buttons, not links, so no "page 2" link exists to read. Try the usual
 * URL forms for page 2 and accept one only if it shows different series than page 1.
 */
async function probePagination(pool: WindowPool, pageUrl: string, first: Analysis): Promise<string | null> {
  const u = new URL(pageUrl)
  const withParam = new URL(pageUrl)
  withParam.searchParams.set('page', '2')
  const guesses: { url: string; template: string }[] = [
    { url: withParam.toString(), template: withParam.toString().replace(/([?&]page=)2/, '$1{n}') },
    { url: u.origin + u.pathname.replace(/\/$/, '') + '/page/2/', template: u.origin + u.pathname.replace(/\/$/, '') + '/page/{n}/' }
  ]
  const known = new Set(first.cardUrls)
  // The guesses run side by side, and the first one that works ends the check (a guess that doesn't exist would
  // otherwise make us wait for its timeout).
  return new Promise<string | null>((resolve) => {
    let pending = guesses.length
    for (const g of guesses) {
      pool
        .use(async (w) => {
          const a = await analyze(w, g.url)
          if (a.cards < 5) return null
          const overlap = a.cardUrls.filter((x) => known.has(x)).length
          return overlap < a.cardUrls.length * 0.5 ? g.template : null // a genuinely different page of series
        })
        .catch(() => null)
        .then((t) => {
          if (t) resolve(t)
          else if (--pending === 0) resolve(null)
        })
    }
  })
}

/**
 * A couple of hidden windows that are all created up front (while the network lookups run) and then reused.
 * Starting a new window costs seconds; loading another page in an existing one costs a moment.
 */
interface WindowPool {
  use: <T>(fn: (w: BrowserWindow) => Promise<T>) => Promise<T>
  close: () => void
}

function makePool(size: number): WindowPool {
  const wins = Array.from({ length: size }, () => hiddenWindow({ light: true }))
  const free = [...wins]
  const waiting: ((w: BrowserWindow) => void)[] = []
  return {
    use: async (fn) => {
      const w = free.pop() ?? (await new Promise<BrowserWindow>((r) => waiting.push(r)))
      try {
        return await fn(w)
      } finally {
        const next = waiting.shift()
        if (next) next(w)
        else free.push(w)
      }
    },
    close: () => {
      for (const w of wins) if (!w.isDestroyed()) w.destroy()
    }
  }
}

// Pages that usually hold the complete list of series (the home page often shows only a "latest" slice).
const LIST_PAGE = /^\/(browse|browser|all|list|manga-?list|mangas?|manhwas?|manhuas?|webtoons?|series|index|directory|library|catalog|comics?|titles|latest|search|explore|advanced-search|genres?|az|a-z)(\/|$)/i

/** If series pages look like /<section>/<name>, the section's own page (/<section>/) is a likely list. */
function derivedListUrl(seriesUrls: string[], origin: string): string | null {
  for (const s of seriesUrls) {
    try {
      const segs = new URL(s).pathname.split('/').filter(Boolean)
      if (segs.length >= 2) return `${origin}/${segs[0]}/`
    } catch {
      /* skip */
    }
  }
  return null
}

function listCandidates(links: string[], host: string, current: string): string[] {
  const out = new Map<string, string>()
  for (const h of links) {
    let p: URL
    try {
      p = new URL(h)
    } catch {
      continue
    }
    if (p.hostname !== host) continue
    if (!LIST_PAGE.test(p.pathname)) continue
    // list pages live at the top level (/browse, /manga, /Mangalist); deeper paths like /manga/<name> are series
    if (p.pathname.split('/').filter(Boolean).length > 1) continue
    const clean = p.origin + p.pathname.replace(/\/$/, '')
    if (clean === current.replace(/\/$/, '')) continue
    // one entry per page, using its plainest form (no query string)
    if (!out.has(clean)) out.set(clean, p.search ? clean : h)
  }
  return [...out.values()]
}

/**
 * Works out how to list every series on a site from a pasted URL. If that page isn't itself a paginated
 * list (a home page usually isn't), it also tries the site's browse / all-series pages.
 */
export async function detectSource(
  input: string,
  onStage: (msg: string) => void = () => undefined,
  opts: { quick?: boolean } = {}
): Promise<SourceDef> {
  const u = new URL(input)
  const t0 = Date.now()
  const T = (m: string): void => {
    if (process.env['MR_TRACE']) console.log(`TRACE +${Date.now() - t0}ms ${m}`)
  }
  // 1) Does the site publish a sitemap of its series? That is complete and takes seconds. It runs at the same
  //    time as reading the page below, since neither needs the other. (Data feeds are only used if the site
  //    allows it in robots.txt; none is needed for this.)
  onStage('Checking the site for a sitemap and reading its pages…')
  const planP = discoverSitemap(u.origin)
    .catch(() => null)
    .then((p) => {
      T('sitemap lookup done: ' + (p ? p.files.length + ' files' : 'none'))
      return p
    })

  const builtin = process.env['MR_NOBUILTIN'] ? undefined : matchBuiltin(input) // (dev: measure the generic path)
  if (builtin) {
    const plan = await planP
    return plan ? { ...builtin, sitemaps: plan.files, sitemapChecked: true } : { ...builtin, sitemapChecked: true }
  }

  // Quick start: if the site has a sitemap, that alone is enough to begin (the complete list arrives in seconds).
  // The slower work of finding its list pages (for covers and titles) is left to refineSource, in the background.
  if (opts.quick) {
    const plan = await planP
    if (plan) {
      return {
        id: slugId(input),
        name: prettyName(input),
        baseUrl: u.origin + '/',
        listTemplate: input,
        seriesRe: plan.seriesRe,
        chapterRe: '(?:chapter|chap|ch|episode|ep|read)[-_/ ]?\\d',
        maxPages: 0,
        sitemaps: plan.files,
        sitemapChecked: true,
        needsRefine: true
      }
    }
  }

  // 2) Page scan: how the list pages look and paginate (also used to fill in titles and covers).
  //    Only links are needed, so the window skips images.
  const pool = makePool(2) // both windows start now, overlapping the sitemap lookup
  try {
    const score = (a: Analysis): number => (a.cards >= 5 ? (a.paged ? 1000 : 0) + a.cards : -1)
    // Reads the pasted page; also notes whether it turned out to be a "verify you are human" screen.
    const readHome = (): Promise<{ a: Analysis; challenged: boolean }> =>
      pool.use(async (w) => {
        const a = await analyze(w, input)
        return { a, challenged: a.cards < 5 && (await pageIsChallenge(w)) }
      })
    let pick: Analysis
    let challenged = false
    try {
      ;({ a: pick, challenged } = await readHome())
    } catch (e) {
      if (!(await planP)) throw e
      pick = { cards: 0, cardUrls: [], seriesRe: '', listTemplate: input, paged: false, links: [], searchForm: null }
    }
    let listTemplates: string[] | undefined // set when the site can only be listed through its search
    T(`home page read: ${pick.cards} cards, paged=${pick.paged}`)
    // Nothing found: is the site hiding behind a "verify you are human" screen? If so, let the person pass it.
    if (pick.cards < 5 && challenged && !(await planP)) {
      const ok = await waitForHuman(input)
      if (!ok)
        throw new Error(
          'This site shows a "verify you are human" check that was not completed, so the app cannot read it. ' +
            'Add it again and finish the check in the window that opens.'
        )
      ;({ a: pick, challenged } = await readHome())
      if (pick.cards < 5 && challenged)
        throw new Error(
          'The site still shows its "verify you are human" check after you completed it, which means it does not ' +
            'accept this app\'s browser. The app cannot read this site.'
        )
    }
    if (!(pick.cards >= 5 && pick.paged)) {
      onStage('Looking for the site’s full list of series…')
      // The likely list pages are read side by side (each in its own window), not one after another.
      // The section the series live in is a natural list page too: series at /manga/<name> -> try /manga/.
      const derived = derivedListUrl(pick.cardUrls, u.origin)
      const cands = [...(derived ? [derived] : []), ...listCandidates(pick.links, u.hostname, input).filter((c) => c !== derived)].slice(0, 3)
      const analyses = await Promise.all(cands.map((c) => pool.use((w) => analyze(w, c)).catch(() => null)))
      T('candidates read: ' + JSON.stringify(cands.map((c, i) => ({ c: c.slice(-28), cards: analyses[i]?.cards ?? null, paged: analyses[i]?.paged ?? null }))))
      // The best candidate (ignoring the home page) is the one that gets the slower "does page 2 exist?" check.
      let winner: { a: Analysis; url: string } | null = null
      analyses.forEach((a, i) => {
        if (a && a.cards >= 5 && (!winner || score(a) > score(winner.a))) winner = { a, url: cands[i] }
      })
      const best = winner as { a: Analysis; url: string } | null
      if (best) {
        if (!best.a.paged) {
          onStage('Checking how the list is paged…')
          const t = await probePagination(pool, best.url, best.a)
          T('page-2 check done: ' + (t ?? 'no pagination found'))
          if (t) Object.assign(best.a, { listTemplate: t, paged: true })
        }
        if (score(best.a) > score(pick)) pick = best.a
      }

      // Some sites can only be listed through their search: an empty search shows nothing, but a search for "a"
      // lists 50 series per page over many pages. If no real paged list turned up, try that. One search per letter
      // is scanned and the results are merged (a single search stops after a few dozen pages).
      if (!pick.paged) {
        const form = pick.searchForm ?? analyses.map((a) => a?.searchForm).find((f) => f) ?? null
        if (form) {
          onStage('Trying the site’s search as a list…')
          const base = new URL(form.action, input)
          base.searchParams.set(form.name, 'a')
          const a = await pool.use((w) => analyze(w, base.toString())).catch(() => null)
          if (a && a.cards >= 10 && a.seriesRe) {
            const t = await probePagination(pool, base.toString(), a)
            T('search listing: ' + (t ?? 'no pagination'))
            if (t) {
              const re = new RegExp('([?&]' + escapeRe(form.name) + '=)a(?=&|$)')
              listTemplates = 'abcdefghijklmnopqrstuvwxyz'.split('').map((l) => t.replace(re, `$1${l}`))
              pick = { ...a, listTemplate: listTemplates[0], paged: true }
            }
          }
        }
      }
    }
    const plan = await planP // (usually finished long ago: it ran while the pages were being read)
    if (pick.cards < 5 && !plan)
      throw new Error(
        "Couldn't find a list of series on that page. Paste the site's 'all series / browse' page URL instead."
      )
    // The page scan is only used if robots.txt allows it; otherwise the sitemap (if any) is all we have.
    const scanAllowed = pick.cards >= 5 && (await robotsAllows(pick.listTemplate.replace('{n}', '1')))
    return {
      id: slugId(input),
      name: prettyName(input),
      baseUrl: u.origin + '/',
      listTemplate: pick.listTemplate,
      listTemplates,
      seriesRe: pick.cards >= 5 ? pick.seriesRe : plan!.seriesRe,
      chapterRe: '(?:chapter|chap|ch|episode|ep|read)[-_/ ]?\\d',
      // sites with a pager: scan until the list runs out (the scan stops by itself at the last page).
      // A search list is capped per letter (a search stops after a few dozen pages anyway).
      maxPages: !scanAllowed ? 0 : listTemplates ? 120 : pick.paged ? 3000 : 1,
      sitemaps: plan?.files,
      sitemapChecked: true
    }
  } finally {
    pool.close()
  }
}
