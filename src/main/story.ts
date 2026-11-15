import { app } from 'electron'
import { join } from 'path'
import { getSeriesCached, getSource } from './catalog'
import { normalizeTitle } from './repair'
import { readJson, writeAtomic } from './safefile'
import { getSettings } from './settings'
import { aniListText, cleanStory, pickStory, type StoryCandidate } from './storyLogic'

/*
 * The story shown on a series page. The site you read on often has only an advertising line, so the same series'
 * summaries on your other sites are tried too (the lists already saved on this PC, nothing is downloaded for it),
 * and when none of them tells the story, AniList's description (public, no sign-in; kept a month in
 * story-cache.json, and not asked when "Recommendations" is off in Settings, as it sends the title).
 */

const ANILIST = 'https://graphql.anilist.co'
const KEEP_MS = 30 * 24 * 60 * 60 * 1000
const QUERY = `query ($search: String) {
  Media(search: $search, type: MANGA) {
    description(asHtml: false)
    title { romaji english native }
    synonyms
  }
}`

const file = (): string => join(app.getPath('userData'), 'story-cache.json')
let cache: Record<string, { at: number; text: string }> | null = null

function load(): Record<string, { at: number; text: string }> {
  cache ??= readJson<Record<string, { at: number; text: string }>>(file(), 2) ?? {}
  return cache
}

function save(): void {
  try {
    writeAtomic(file(), JSON.stringify(load()))
  } catch {
    /* asked again next time */
  }
}

async function fromAniList(title: string): Promise<string> {
  const key = normalizeTitle(title)
  if (!key) return ''
  const hit = load()[key]
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.text
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 10000)
  try {
    const res = await fetch(ANILIST, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { search: title } })
    })
    if (!res.ok && res.status !== 404) return '' // asked again next time
    const json = (await res.json().catch(() => null)) as {
      data?: {
        Media?: {
          description?: string | null
          title?: Record<string, string | null>
          synonyms?: string[] | null
        } | null
      }
    } | null
    const m = json?.data?.Media
    // only when AniList found this very title (its search also answers with near misses)
    const names = [...Object.values(m?.title ?? {}), ...(m?.synonyms ?? [])].filter(
      (x): x is string => !!x
    )
    const same = names.some((n) => normalizeTitle(n) === key)
    const text = same && m?.description ? aniListText(m.description) : ''
    load()[key] = { at: Date.now(), text }
    save()
    return text
  } catch {
    return ''
  } finally {
    clearTimeout(t)
  }
}

export async function storyFor(
  title: string,
  url: string,
  sourceId: string,
  description: string,
  entries: { sourceId: string; sourceName: string; url: string }[]
): Promise<{ text: string; from?: string }> {
  const lang = getSource(sourceId)?.lang
  // the site being read tells the whole story: nothing else to look at
  const ownText = cleanStory(description, title)
  const cut = /(?:…|\.\.\.)$/.test(ownText)
  if (ownText && !cut) return { text: ownText }
  // a story cut off with "…" stays in the running, but a whole one from another site wins
  const cands: StoryCandidate[] = ownText ? [{ text: ownText, lang }] : []
  for (const e of entries) {
    if (e.url === url) continue
    const d = getSeriesCached(e.url)
    if (d?.description)
      cands.push({ text: d.description, lang: getSource(e.sourceId)?.lang, from: e.sourceName })
  }
  // in your language first: another of your sites, then AniList (English); another language only after that
  const sameLang = cands.filter((c) => !lang || !c.lang || c.lang === lang)
  const local = pickStory(sameLang, title, lang)
  const localCut = !!local && /(?:…|\.\.\.)$/.test(local.text)
  if (local && !localCut) return local
  const ani =
    lang !== 'ar' && getSettings().recommendations !== false ? await fromAniList(title) : ''
  // a whole story from AniList beats one that stops halfway
  if (ani && (!local || ani.length > local.text.length)) return { text: ani, from: 'AniList' }
  if (local) return local
  const other = pickStory(cands, title, lang)
  if (other) return other
  // reading in Arabic and no site has a story: AniList's English one beats none
  const last = lang === 'ar' && getSettings().recommendations !== false ? await fromAniList(title) : ''
  return last ? { text: last, from: 'AniList' } : { text: '' }
}
