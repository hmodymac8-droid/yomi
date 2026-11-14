import { readFileSync } from 'fs'
import type { SearchHit, SeriesDetail } from '../preload/index.d'
import { getSeriesCached, openSeries, search } from './catalog'
import { numberOf } from './gapfillLogic'
import { parseBackup, readNumbers, shelfFor, type MihonManga } from './mihonLogic'
import { applyForwardProgress, getProgress } from './progress'
import { normalizeTitle } from './repair'
import { getFollow, setCategory, setFollow } from './updates'

/*
 * Import a Mihon / Tachiyomi backup: every series in its library is looked up on your sites by title, followed
 * (on the shelf its category suggests), and the chapters read in Mihon are marked read here. Nothing is removed or
 * moved back: a series you already follow keeps its shelf, and read marks are only added.
 */

export interface MihonImportProgress {
  done: number
  total: number
  title: string
}

export interface MihonImportResult {
  total: number
  followed: number
  alreadyFollowed: number
  withProgress: number
  chaptersMarked: number
  notFound: string[]
}

const cleanName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\b(scans?|comics?|toons?|manga|manhwa|\.\w+)\b|[^a-z0-9؀-ۿ]+/g, '')

/** The same title on your sites; the site with the same name as the Mihon source first. */
function findOnYourSites(
  m: MihonManga
): { hit: SearchHit; entry: SearchHit['entries'][number] } | null {
  const want = normalizeTitle(m.title)
  if (!want) return null
  const hit = search(m.title, [], 'az', 0, 8).hits.find((h) => normalizeTitle(h.title) === want)
  if (!hit || hit.entries.length === 0) return null
  const src = cleanName(m.sourceName)
  const same =
    src.length >= 3
      ? hit.entries.find((e) => {
          const n = cleanName(e.sourceName)
          return n.length >= 3 && (n.includes(src) || src.includes(n))
        })
      : undefined
  return { hit, entry: same ?? hit.entries[0] }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(
    () => null
  )
}

export async function importMihonBackup(
  path: string,
  onProgress: (p: MihonImportProgress) => void
): Promise<MihonImportResult> {
  const backup = parseBackup(readFileSync(path))
  const library = backup.manga.filter((m) => m.favorite)
  const result: MihonImportResult = {
    total: library.length,
    followed: 0,
    alreadyFollowed: 0,
    withProgress: 0,
    chaptersMarked: 0,
    notFound: []
  }
  // first the quick part (matching and following), then the chapter lists for read marks, three at a time
  const toMark: { m: MihonManga; url: string; sourceId: string; hit: SearchHit }[] = []
  let done = 0
  for (const m of library) {
    onProgress({ done: done++, total: library.length * 2, title: m.title })
    const found = findOnYourSites(m)
    if (!found) {
      result.notFound.push(m.title)
      continue
    }
    const { hit, entry } = found
    const existing = getFollow(entry.url)
    if (existing?.following) result.alreadyFollowed++
    else {
      setFollow(
        {
          seriesUrl: entry.url,
          sourceId: entry.sourceId,
          title: hit.title,
          cover: hit.cover,
          coverReferer: hit.coverReferer
        },
        true
      )
      setCategory(entry.url, shelfFor(m.categories))
      result.followed++
    }
    if (readNumbers(m).size > 0) toMark.push({ m, url: entry.url, sourceId: entry.sourceId, hit })
    // (let the screen breathe during a long import)
    if (done % 25 === 0) await new Promise((r) => setImmediate(r))
  }
  done = library.length + (library.length - toMark.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < toMark.length) {
      const job = toMark[next++]
      onProgress({ done: done++, total: library.length * 2, title: job.m.title })
      let d: SeriesDetail | null = getSeriesCached(job.url)
      if (!d || d.chapters.length === 0)
        d = await withTimeout(openSeries(job.sourceId, job.url, 'auto'), 45000)
      if (!d || d.chapters.length === 0) continue
      const nums = readNumbers(job.m)
      const readUrls = d.chapters.filter((c) => {
        const n = numberOf(c.title)
        return n !== null && nums.has(n)
      })
      if (readUrls.length === 0) continue
      // newest read chapter = where you are
      const newest = readUrls.reduce((a, b) =>
        (numberOf(b.title) ?? 0) > (numberOf(a.title) ?? 0) ? b : a
      )
      // the reading position only ever moves forward (Yomi may already be further than Mihon)
      const local = getProgress(job.url)
      const localN = local?.chapterTitle ? numberOf(local.chapterTitle) : null
      const forward =
        !local?.chapterUrl || localN === null || (numberOf(newest.title) ?? 0) > localN
      const changed = applyForwardProgress(
        job.url,
        readUrls.map((c) => c.url),
        forward ? { chapterUrl: newest.url, chapterTitle: newest.title, pos: 1 } : undefined,
        {
          sourceId: job.sourceId,
          title: job.hit.title,
          cover: job.hit.cover,
          coverReferer: job.hit.coverReferer
        }
      )
      if (changed) {
        result.withProgress++
        result.chaptersMarked += readUrls.length
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  onProgress({ done: library.length * 2, total: library.length * 2, title: '' })
  return result
}
