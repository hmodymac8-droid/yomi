/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from 'cheerio'

// Parsers that work on raw HTML (no browser). They mirror what the in-page scripts do in catalog.ts / grabber.ts.

const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'src']

function abs(href: string | undefined, base: string): string {
  if (!href) return ''
  try {
    return new URL(href.trim(), base).href
  } catch {
    return ''
  }
}

function imgUrl($img: cheerio.Cheerio<any>, base: string): string {
  for (const a of IMG_ATTRS) {
    const v = $img.attr(a)
    if (v && !v.startsWith('data:') && v.trim()) {
      const u = abs(v, base)
      if (u) return u
    }
  }
  return ''
}

/** Visible text of a node with a space between elements (so "C. 1" and "1d ago" don't glue together). */
function textOf(node: any): string {
  const parts: string[] = []
  const walk = (n: any): void => {
    if (!n || n.type === 'script' || n.type === 'style') return
    if (n.type === 'text') parts.push(n.data)
    else if (n.children) n.children.forEach(walk)
    if (n.type === 'tag') parts.push(' ')
  }
  walk(node)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * Cover URLs on list pages are usually tiny thumbnails. Where the site's naming scheme is known, point at the
 * full-size original instead (the caller keeps the thumbnail as a fallback in case the guess is wrong).
 */
export function upgradeCover(url: string): string {
  if (!url) return url
  // MangaFreak: /mini_images/<name>/<w>x<h>  ->  /manga_images/<name>.jpg
  const mf = url.match(/^(https?:\/\/[^/]*mangafreak[^/]*)\/mini_images\/([^/]+)\/\d+x\d+\/?$/i)
  if (mf) return `${mf[1]}/manga_images/${mf[2]}.jpg`
  // WordPress thumbnails: name-175x238.jpg  ->  name.jpg
  const wp = url.match(/^(.*?)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(\?.*)?$/i)
  if (wp && /\/wp-content\/uploads\//i.test(url)) return wp[1] + wp[2]
  return url
}

export function parseSeriesList(
  html: string,
  pageUrl: string,
  seriesRe: string
): { url: string; title: string; cover: string }[] {
  const $ = cheerio.load(html)
  const re = new RegExp(seriesRe)
  const hrefOf = (a: any): string => abs($(a).attr('href'), pageUrl).split('#')[0]
  const map = new Map<string, { url: string; title: string; cover: string; p: number }>()
  $('a[href]').each((_, a) => {
    const href = hrefOf(a)
    if (!href || !re.test(href)) return
    let img = $(a).find('img').first()
    if (img.length === 0) {
      // the cover may sit next to the title link: use the surrounding card if it holds just this series
      const card = $(a).closest('li, article, div')
      if (card.length) {
        const urls = new Set<string>()
        card.find('a[href]').each((_, x) => {
          const h = hrefOf(x)
          if (re.test(h)) urls.add(h)
        })
        if (urls.size === 1) img = card.find('img').first()
      }
    }
    const cur = map.get(href) ?? { url: href, title: '', cover: '', p: 9 }
    const cands: [number, string | undefined][] = [
      [1, $(a).attr('title')],
      [2, img.attr('alt')],
      [3, textOf(a)]
    ]
    for (const [p, t] of cands) {
      const text = (t ?? '').trim().replace(/\s+/g, ' ')
      if (text && text.length < 150 && p < cur.p) {
        cur.title = text
        cur.p = p
      }
    }
    if (!cur.cover && img.length) cur.cover = imgUrl(img, pageUrl)
    map.set(href, cur)
  })
  return [...map.values()].map(({ url, title, cover }) => ({ url, title, cover }))
}

/** Just the title and cover of a series page (used to fill in series that a sitemap listed by URL only). */
export function parseSeriesMeta(html: string, pageUrl: string): { title: string; cover: string } {
  const $ = cheerio.load(html)
  const meta = (p: string): string => $(`meta[property="${p}"]`).attr('content') ?? ''
  // The page's own heading is the cleanest title; og:title / <title> usually carry a "- Read ... | Site" tail.
  const clean = (t: string): string =>
    t.replace(/\s+[-–|]\s+(read|watch|online|free|manga|manhwa|manhua|webtoon).*$/i, '').replace(/\s*\|\s*[^|]+$/, '').trim()
  const h1 = $('h1').first().text().trim().replace(/\s+/g, ' ')
  const title = h1 && h1.length < 150 ? h1 : clean(meta('og:title') || $('title').first().text())
  return { title, cover: abs(meta('og:image'), pageUrl) }
}

export function parseSeries(
  html: string,
  pageUrl: string,
  chapterRe: string
): {
  title: string
  cover: string
  description: string
  chapters: { title: string; url: string }[]
  /** True when the chapter list is split over pager pages / "show more" buttons (needs the browser). */
  paged: boolean
} {
  const $ = cheerio.load(html)
  const re = new RegExp(chapterRe, 'i')
  const seen = new Set<string>()
  const chapters: { title: string; url: string }[] = []
  // A chapter is a link whose address looks like one OR whose visible text does ("Chapter 12"): some sites use
  // opaque addresses (/chapters/01J76X…). "Start Reading" / "Latest" buttons are not chapters themselves.
  const byText = (t: string): boolean => /^(vol(ume)?\.?\s*\d+\s*[,:.-]?\s*)?(chapter|chap\.?|ch\.?|episode|ep\.?|ال?فصل|حلقة|الحلقة)\s*\d/i.test(t)
  // A link below this series' own address with "chapter 12" / "vol-2" in its path is one of its chapters.
  let basePath = ''
  let baseOrigin = ''
  try {
    const pu = new URL(pageUrl)
    basePath = pu.pathname.replace(/\/$/, '')
    baseOrigin = pu.origin
  } catch {
    /* no base */
  }
  const underBase = (h: string): boolean => {
    try {
      const u = new URL(h)
      return !!basePath && u.origin === baseOrigin && u.pathname.startsWith(basePath + '/') && /(chapter|chap|episode|ep|ch)[-_ ]?\d|vol[-_ ]?\d/i.test(u.pathname.slice(basePath.length))
    } catch {
      return false
    }
  }
  const junk = (t: string): boolean => /^(start|read|continue|first|last|latest|new)\b/i.test(t) && !/\d/.test(t)
  // Sites that number chapters by address only: …/reader/<series-slug>/138 (no "chapter" word anywhere).
  const lastSeg = decodeURIComponent(basePath.split('/').pop() || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const slugNumRe = lastSeg ? new RegExp('/' + lastSeg + '/(\\d+(?:[._-]\\d+)?)/?$', 'i') : null
  const slugNum = (h: string): string | null => {
    if (!slugNumRe) return null
    try {
      const m = slugNumRe.exec(decodeURIComponent(new URL(h).pathname))
      return m ? m[1] : null
    } catch {
      return null
    }
  }
  $('a[href]').each((_, a) => {
    const href = abs($(a).attr('href'), pageUrl).split('#')[0]
    if (!href || seen.has(href)) return
    let t = textOf(a).slice(0, 80)
    const sn = slugNum(href)
    // a link back to the series page itself (a "latest: Chapter 204" banner) is not a chapter
    try {
      if (new URL(href).pathname.replace(/\/$/, '') === basePath) return
    } catch {
      /* keep going */
    }
    if ((!re.test(href) && !byText(t) && !underBase(href) && sn === null) || junk(t)) return
    if (sn !== null) t = 'Chapter ' + sn.replace(/[_-]/g, '.')
    seen.add(href)
    chapters.push({ title: t, url: href })
  })
  // Some sites ship the chapter list as data inside the page (a JSON script tag, a hydration blob) and draw the links
  // later with JavaScript. Pick chapter addresses (…/<series-slug>/<number>) out of the raw text as well.
  if (slugNumRe) {
    const raw = html.replace(/\\\//g, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const found = raw.match(new RegExp('https?://[^"\'\\s<>\\\\,)]*/' + lastSeg + '/\\d+(?:[._-]\\d+)?/?(?=["\'\\s<>\\\\,)]|$)', 'gi')) ?? []
    for (const f of found) {
      const href = f.split('#')[0]
      const sn = slugNum(href)
      if (sn === null || seen.has(href)) continue
      seen.add(href)
      chapters.push({ title: 'Chapter ' + sn.replace(/[_-]/g, '.'), url: href })
    }
  }
  // Same for data that carries root-relative addresses ("url":"/series/chapter-68"): any address below this series'
  // own path that looks like a chapter counts, even when the page draws only some of them as links.
  if (basePath) {
    const raw = html.replace(/\\\//g, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const esc = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const found = raw.match(new RegExp('["\'(](?:https?://[^"\'\\s<>\\\\]*)?' + esc + '/[^"\'\\s<>\\\\?#,)]+(?=["\')])', 'gi')) ?? []
    for (const f of found) {
      const href = abs(f.slice(1), pageUrl).split('#')[0]
      if (!href || seen.has(href)) continue
      if (!re.test(href) && !underBase(href)) continue
      const sn = slugNum(href)
      const num = /(?:chapter|chap|ch|episode|ep)[-_ ]?(\d+(?:[._-]\d+)?)/i.exec(href)?.[1]
      seen.add(href)
      chapters.push({ title: sn ?? num ? 'Chapter ' + (sn ?? num)!.replace(/[_-]/g, '.') : decodeURIComponent(href.split('/').pop() ?? ''), url: href })
    }
  }
  const meta = (p: string): string => $(`meta[property="${p}"]`).attr('content') ?? ''
  const body = textOf($('body').get(0))
  const pagerNext = $('button, [role=button], a')
    .toArray()
    .some((el) => {
      const t = textOf(el)
      return t.length < 12 && /^(next\b|›$)/i.test(t)
    })
  const paged =
    /Showing\s+\d+\s*[–-]\s*\d+\s+of\s+\d+/i.test(body) ||
    /(show|view|load|see|expand)\s+(all|more)(\s+\d+)?\s+(chapters?|episodes?)/i.test(body) || // "Show all 35 chapters"
    pagerNext
  return {
    title: $('h1').first().text().trim().replace(/\s+/g, ' ') || meta('og:title') || $('title').text().trim(),
    cover: meta('og:image'),
    description: meta('og:description'),
    chapters,
    paged
  }
}

// Site furniture, not manga pages: logos, favicons, "apple-touch-icon", avatars, sprites... (the name may START with
// something else: apple-touch-icon-152x152.png, site-logo.png)
const NOT_PAGE = /\/[^/]*(?:^|[-_.])?(logo|favicon|icon|avatar|sprite|emoji|apple-touch)[^/]*\.(png|jpe?g|webp|gif|avif|ico|svg)(?:\?|$)|\/(banner|loading|placeholder)[^/]*\.(png|jpe?g|webp|gif|avif)/i

/** Manga pages sit in one folder of one CDN host: take the biggest such group (covers/ads are scattered). */
export function pickPageGroup(urls: string[]): string[] {
  const seen = new Set<string>()
  const groups = new Map<string, string[]>()
  for (const u of urls) {
    if (seen.has(u) || NOT_PAGE.test(u)) continue
    seen.add(u)
    let key: string
    try {
      const p = new URL(u)
      key = p.hostname + p.pathname.replace(/[^/]*$/, '')
    } catch {
      continue
    }
    groups.set(key, [...(groups.get(key) ?? []), u])
  }
  let best: string[] = []
  for (const g of groups.values()) if (g.length > best.length) best = g
  return best
}

export function parseChapterImages(html: string, pageUrl: string): { title: string; pages: string[] } {
  const $ = cheerio.load(html)
  const dom: string[] = []
  $('img').each((_, el) => {
    const u = imgUrl($(el), pageUrl)
    if (!u) return
    const w = Number($(el).attr('width'))
    const h = Number($(el).attr('height'))
    if ((w && w < 200) || (h && h < 200)) return
    dom.push(u)
  })
  let pages = pickPageGroup(dom)
  if (pages.length < 3) {
    // Some sites ship the page list as JSON inside a script tag and only render the first <img>s.
    // (Only consulted when the <img> tags gave almost nothing: scripts also mention covers and thumbnails.)
    const text = html.replace(/\\\//g, '/')
    const found = text.match(/https?:\/\/[^"'\s<>)\\]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'\s<>)\\]*)?/gi) ?? []
    const fromScripts = pickPageGroup(found)
    if (fromScripts.length > pages.length) pages = fromScripts
  }
  return { title: $('title').first().text().trim(), pages }
}
