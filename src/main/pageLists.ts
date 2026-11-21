import * as cheerio from 'cheerio'
import { fetchHtml, fetchJson } from './http'

/*
 * Chapters whose page list the site hands out on request: the chapter page itself holds no pictures, only the
 * chapter's number, and the site's own script asks for the list once the page is open. Yomi asks the same way, with
 * one plain request, so no browser window is needed and the sidebar's covers are never taken for pages.
 *
 * A list that comes from the site this way is the site's own word on the chapter (`fromSite` on the result).
 */

/**
 * The "Liliana" theme (ManhuaPlus): `const CHAPTER_ID = 106393` in the page, and
 * /ajax/image/list/chap/<id> answers { html } with one `a.readImg img` per page, each in a block numbered
 * by data-index.
 */
async function liliana(html: string, pageUrl: string): Promise<string[] | null> {
  const id = /\bCHAPTER_ID\s*=\s*(\d+)/.exec(html)?.[1]
  if (!id || !/themes\/liliana\//.test(html)) return null
  const r = await fetchJson<{ status?: boolean; html?: string }>(
    new URL('/ajax/image/list/chap/' + id, pageUrl).href
  )
  if (!r.data?.html) return null
  const $ = cheerio.load(r.data.html)
  const pages = $('a.readImg img')
    .toArray()
    .map((img, i) => {
      const $img = $(img)
      const index = Number($img.closest('[data-index]').attr('data-index') ?? i)
      // the real address is in src; data-src holds the "loading" picture
      const src = [$img.attr('src'), $img.attr('data-src'), $img.parent('a').attr('href')].find(
        (u) => u && !/\/loading\.gif/i.test(u)
      )
      return { index: Number.isFinite(index) ? index : i, src }
    })
    .filter((p): p is { index: number; src: string } => !!p.src)
    .sort((a, b) => a.index - b.index)
    .map((p) => new URL(p.src.trim(), pageUrl).href)
  return pages.length > 0 ? pages : null
}

/**
 * WeebCentral: the chapter page (/chapters/<id>) asks for its pictures with htmx once open, at
 * /chapters/<id>/images?…&reading_style=long_strip, which answers with one `img[alt="Page N"]` per page. A browser
 * that scrolls only ever sees some of them (14 of 34).
 */
async function weebCentral(pageUrl: string): Promise<string[] | null> {
  const m = /^(https?:\/\/(?:www\.)?weebcentral\.com)\/chapters\/([A-Za-z0-9]+)\/?(?:[?#]|$)/.exec(pageUrl)
  if (!m) return null
  const r = await fetchHtml(
    `${m[1]}/chapters/${m[2]}/images?is_prev=False&current_page=1&reading_style=long_strip`
  )
  if (r.status !== 200) return null
  const $ = cheerio.load(r.html)
  const pages = $('img[alt^="Page"]')
    .toArray()
    .filter((img) => $(img).attr('x-show') === undefined)
    .map((img) => $(img).attr('src')?.trim())
    .filter((u): u is string => !!u)
    .map((u) => new URL(u, pageUrl).href)
  return pages.length > 0 ? [...new Set(pages)] : null
}

/** The chapter's pages as the site hands them out, or null when the page is not one of these. */
export async function askedPages(html: string, pageUrl: string): Promise<string[] | null> {
  try {
    return (await liliana(html, pageUrl)) ?? (await weebCentral(pageUrl))
  } catch {
    return null
  }
}
