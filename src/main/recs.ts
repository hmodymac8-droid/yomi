import { app } from 'electron'
import { join } from 'path'
import type { SearchHit } from '../preload/index.d'
import { search } from './catalog'
import { getAniListLink } from './anilist'
import { recentProgress } from './progress'
import { normalizeTitle } from './repair'
import { readJson, writeAtomic } from './safefile'

/*
 * Recommendations: AniList's community "if you liked this, read…" list for a title (public data, no sign-in), kept
 * to the titles that are on your own sites so every card opens. Used for "Similar" on a series page and for
 * "Because you read X" on Discover. Answers are saved for a week (recs-cache.json).
 */

const ANILIST = 'https://graphql.anilist.co'
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
const QUERY = `query ($id: Int, $search: String) {
  Media(id: $id, search: $search, type: MANGA) {
    id
    title { romaji english }
    recommendations(sort: RATING_DESC, perPage: 25) {
      nodes {
        rating
        mediaRecommendation { id title { romaji english } synonyms }
      }
    }
  }
}`

interface RecTitle {
  id: number
  titles: string[]
}
interface CacheRow {
  at: number
  recs: RecTitle[]
}

const file = (): string => join(app.getPath('userData'), 'recs-cache.json')
let cache: Record<string, CacheRow> | null = null
let saveTimer: NodeJS.Timeout | undefined

function load(): Record<string, CacheRow> {
  cache ??= readJson<Record<string, CacheRow>>(file(), 2) ?? {}
  return cache
}
function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      writeAtomic(file(), JSON.stringify(load()))
    } catch {
      /* asked again next time */
    }
  }, 1500)
}

interface Node {
  rating: number
  mediaRecommendation: {
    id: number
    title: { romaji?: string | null; english?: string | null }
    synonyms?: string[] | null
  } | null
}

async function askAniList(vars: { id?: number; search?: string }): Promise<RecTitle[]> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch(ANILIST, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: vars })
    })
    if (res.status === 404) return []
    if (!res.ok) throw new Error('AniList answered ' + res.status)
    const json = (await res.json()) as {
      data?: { Media?: { recommendations?: { nodes?: Node[] } } | null }
    }
    const nodes = json.data?.Media?.recommendations?.nodes ?? []
    return nodes
      .filter((n) => n.mediaRecommendation && n.rating > 0)
      .map((n) => {
        const m = n.mediaRecommendation!
        const titles = [m.title.english, m.title.romaji, ...(m.synonyms ?? []).slice(0, 4)]
        return { id: m.id, titles: [...new Set(titles.filter((x): x is string => !!x && x.trim().length > 0))] }
      })
  } finally {
    clearTimeout(t)
  }
}

/** AniList's recommendations for one title (from the cache when it is less than a week old). */
async function recsFor(title: string, seriesUrl?: string): Promise<RecTitle[]> {
  const link = seriesUrl ? getAniListLink(seriesUrl) : null
  const key = link ? 'id:' + link.mediaId : 't:' + normalizeTitle(title)
  const c = load()[key]
  if (c && Date.now() - c.at < KEEP_MS) return c.recs
  const recs = await askAniList(link ? { id: link.mediaId } : { search: title })
  load()[key] = { at: Date.now(), recs }
  saveSoon()
  return recs
}

/** The recommended titles that are on your sites, best rated first (at most `limit`). */
function onYourSites(recs: RecTitle[], exclude: string, limit: number): SearchHit[] {
  const out: SearchHit[] = []
  const seen = new Set<string>([exclude])
  for (const r of recs) {
    if (out.length >= limit) break
    for (const t of r.titles) {
      const want = normalizeTitle(t)
      if (!want || seen.has(want)) continue
      const hit = search(t, [], 'az', 0, 6).hits.find((h) => normalizeTitle(h.title) === want)
      if (hit) {
        seen.add(want)
        seen.add(normalizeTitle(hit.title))
        out.push(hit)
        break
      }
    }
  }
  return out
}

/** "Similar" on a series page. */
export async function similarTo(title: string, seriesUrl?: string): Promise<SearchHit[]> {
  const recs = await recsFor(title, seriesUrl)
  return onYourSites(recs, normalizeTitle(title), 18)
}

/** "Because you read X" rows for Discover: from the series you read most recently. */
export async function becauseYouRead(rows = 2): Promise<{ title: string; hits: SearchHit[] }[]> {
  const out: { title: string; hits: SearchHit[] }[] = []
  const seen = new Set<string>()
  for (const p of recentProgress(8)) {
    if (out.length >= rows) break
    const k = normalizeTitle(p.title)
    if (!k || seen.has(k)) continue
    seen.add(k)
    try {
      const hits = await similarTo(p.title, p.seriesUrl)
      if (hits.length >= 3) out.push({ title: p.title, hits })
    } catch {
      /* no answer from AniList right now: skip this row */
    }
  }
  return out
}
