import { gunzipSync } from 'zlib'
import { fetchBuffer } from './http'
import { getRobots, robotsAllows } from './robots'

export interface SitemapRow {
  loc: string
  image?: string
}

export interface SitemapPlan {
  /** Sitemap files that list series (all of them, e.g. list-1.xml ... list-111.xml). */
  files: string[]
  /** Regex source matching the series URLs inside them. */
  seriesRe: string
  /** How many series URLs the first file held (a sample, not the total). */
  sample: number
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()

async function readXml(url: string): Promise<string | null> {
  const r = await fetchBuffer(url, 6000) // a slow sitemap shouldn't hold up adding a site
  if (r.status !== 200) return null
  const buf = r.buf[0] === 0x1f && r.buf[1] === 0x8b ? gunzipSync(r.buf) : r.buf // .xml.gz
  const text = buf.toString('utf8')
  return /<(urlset|sitemapindex)[\s>]/.test(text) ? text : null
}

/** Entries of one sitemap file: each URL, plus its image if the sitemap lists one. */
export async function readSitemapFile(url: string): Promise<SitemapRow[]> {
  const xml = await readXml(url)
  if (!xml) return []
  const rows: SitemapRow[] = []
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]
    if (!loc) continue
    const image = m[1].match(/<image:loc>([^<]+)<\/image:loc>/)?.[1]
    rows.push({ loc: decode(loc), image: image ? decode(image) : undefined })
  }
  return rows
}

async function readIndex(url: string): Promise<string[] | null> {
  const xml = await readXml(url)
  if (!xml || !/<sitemapindex[\s>]/.test(xml)) return null
  return [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]))
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Words in a sitemap file's name that mean "not the series list".
const NOT_SERIES_FILE = /(chapter|chap|episode|page|static|post|tag|categor|author|artist|user|genre|image|video|news|blog)/i
// First path segments that are never series pages.
const NOT_SERIES_SEGMENT = /^(genre|genres|tag|tags|author|authors|artist|artists|user|users|u|category|categories|page|pages|search|collections|collection|community|forum|blog|news|chapter|chapters|read|reader|account|login|register|group|groups|scanlator|scanlators)$/i
const CHAPTERISH = /(chapter|chap|episode|ep|read)[-_/ ]?\d|\/ch[-_]?\d/i

interface Shape {
  key: string
  urls: string[]
}

/** Groups URLs by "shape" (how many path parts + the first one) and returns the likeliest series group. */
function bestSeriesShape(origin: string, urls: string[]): { re: string; count: number } | null {
  const host = new URL(origin).hostname
  const shapes = new Map<string, Shape>()
  for (const u of urls) {
    let p: URL
    try {
      p = new URL(u)
    } catch {
      continue
    }
    if (p.hostname !== host) continue
    const segs = p.pathname.split('/').filter(Boolean)
    if (segs.length === 0) continue
    if (NOT_SERIES_SEGMENT.test(segs[0])) continue
    const key = segs.length === 1 ? '1|*' : `${segs.length}|${segs[0]}`
    const s = shapes.get(key) ?? { key, urls: [] }
    s.urls.push(u)
    shapes.set(key, s)
  }
  let best: Shape | null = null
  for (const s of shapes.values()) {
    const chapterish = s.urls.filter((u) => CHAPTERISH.test(new URL(u).pathname)).length
    if (chapterish > s.urls.length * 0.4) continue // these are chapter pages
    if (s.urls.length < 20) continue
    if (!best || s.urls.length > best.urls.length) best = s
  }
  if (!best) return null
  const [count, first] = best.key.split('|')
  const n = Number(count)
  const o = escapeRe(new URL(origin).origin)
  const re = n === 1 ? `^${o}/[^/?#]+/?$` : `^${o}/${escapeRe(first)}/${Array(n - 1).fill('[^/?#]+').join('/')}/?$`
  return { re, count: best.urls.length }
}

/**
 * Does the site publish a sitemap listing its series? Checks robots.txt (which usually names the sitemap) and
 * the usual paths. Returns the files to read and how to recognise a series URL, or null if there's nothing
 * usable (the caller then scans the site's pages instead).
 */
export async function discoverSitemap(origin: string): Promise<SitemapPlan | null> {
  const base = new URL(origin).origin
  const robots = await getRobots(base)
  const candidates = [...new Set([...robots.sitemaps, base + '/sitemap.xml', base + '/sitemap_index.xml', base + '/wp-sitemap.xml'])].slice(0, 5)

  // The candidate paths are checked at the same time; the first one (in the order above) that yields a plan wins.
  // A slow or hanging server can't hold things up for more than a few seconds.
  const results: (SitemapPlan | null)[] = candidates.map(() => null)
  await Promise.race([
    Promise.all(
      candidates.map((cand, i) =>
        probeCandidate(base, cand)
          .then((p) => {
            results[i] = p
          })
          .catch(() => undefined)
      )
    ),
    new Promise((r) => setTimeout(r, 12000))
  ])
  return results.find((p) => p !== null) ?? null
}

async function probeCandidate(base: string, cand: string): Promise<SitemapPlan | null> {
  {
    if (!(await robotsAllows(cand))) return null
    let files: string[]
    try {
      const children = await readIndex(cand)
      files = children ?? [cand] // a plain sitemap is a single file
    } catch {
      return null
    }
    if (files.length === 0) return null

    // Files named list-1, list-2 ... or titles/1, titles/2 ... belong together: group them by name pattern.
    const groups = new Map<string, string[]>()
    for (const f of files.slice(0, 400)) {
      const key = f.replace(/\d+/g, '#')
      groups.set(key, [...(groups.get(key) ?? []), f])
    }
    let bestPlan: SitemapPlan | null = null
    for (const [key, group] of [...groups.entries()].slice(0, 8)) {
      if (NOT_SERIES_FILE.test(key.slice(base.length))) continue
      let rows: SitemapRow[]
      try {
        rows = await readSitemapFile(group[0])
      } catch {
        continue
      }
      const shape = bestSeriesShape(base, rows.map((r) => r.loc))
      if (!shape) continue
      if (!bestPlan || shape.count * group.length > bestPlan.sample * bestPlan.files.length) {
        bestPlan = { files: group, seriesRe: shape.re, sample: shape.count }
      }
    }
    if (bestPlan) return bestPlan
  }
  return null
}
