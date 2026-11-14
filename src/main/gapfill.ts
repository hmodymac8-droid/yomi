import type { SeriesDetail } from '../preload/index.d'
import { getSeriesCached, openSeries } from './catalog'
import { listFallbackSites } from './fallback'
import { missingNumbers, pickFills, type FilledChap } from './gapfillLogic'

/*
 * "Fill missing chapters": when the site you read a series on is missing chapters (or is behind), the same series
 * on your other sites fills them in. Lists the other sites already have saved are used straight away; a site is only
 * asked again when there are real holes, and then at most two sites, with a time limit.
 */

const FETCH_LIMIT_MS = 25000
const recent = new Map<string, { at: number; fills: FilledChap[] }>()
const KEEP_MS = 10 * 60 * 1000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(
    () => null
  )
}

export async function fillGaps(
  title: string,
  sourceId: string,
  chapters: SeriesDetail['chapters']
): Promise<FilledChap[]> {
  if (!title || chapters.length === 0) return []
  const key = sourceId + '\n' + title + '\n' + chapters.length + '\n' + (chapters[0]?.url ?? '')
  const hit = recent.get(key)
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.fills

  const others = listFallbackSites(title, [sourceId])
  if (others.length === 0) return []
  const holes = missingNumbers(chapters).length > 0
  const lists: { sourceId: string; name: string; chapters: SeriesDetail['chapters'] }[] = []
  let fetched = 0
  for (const o of others) {
    let d = getSeriesCached(o.url)
    if ((!d || d.chapters.length === 0) && holes && fetched < 2) {
      fetched++
      d = await withTimeout(openSeries(o.sourceId, o.url, 'auto'), FETCH_LIMIT_MS)
    }
    if (d && d.chapters.length > 0)
      lists.push({ sourceId: o.sourceId, name: o.sourceName, chapters: d.chapters })
  }
  const fills = pickFills(chapters, lists)
  recent.set(key, { at: Date.now(), fills })
  return fills
}
