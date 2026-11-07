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
  const byText = (t: string): boolean => /^(chapter|chap\.?|ch\.?|episode|ep\.?)\s*\d/i.test(t)
  const junk = (t: string): boolean => /^(start|read|continue|first|last|latest|new)\b/i.test(t) && !/\d/.test(t)
  $('a[href]').each((_, a) => {
    const href = abs($(a).attr('href'), pageUrl).split('#')[0]
    if (!href || seen.has(href)) return
    const t = textOf(a).slice(0, 80)
    if ((!re.test(href) && !byText(t)) || junk(t)) return
    seen.add(href)
    chapters.push({ title: t, url: href })
  })
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
    /(show|view|load|see)\s+(all|more)\s+chapters?/i.test(body) ||
    pagerNext
  return {
    title: $('h1').first().text().trim().replace(/\s+/g, ' ') || meta('og:title') || $('title').text().trim(),
    cover: meta('og:image'),
    description: meta('og:description'),
    chapters,
    paged
  }
}

const NOT_PAGE = /\/(logo|favicon|icon|avatar|banner|sprite|emoji|loading|placeholder)[^/]*\.(png|jpe?g|webp|gif|avif)/i

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
