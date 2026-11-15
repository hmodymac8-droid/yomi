/*
 * A series' story without the sites' own advertising around it. Many sites fill the summary with a line made for
 * search engines ("Eleceed … was written by … Read Eleceed at mangafreak.", "جميع فصول مانجا … مترجمة بجودة عالية"),
 * and some have nothing else. cleanStory keeps the story part (or nothing), pickStory chooses between the summaries
 * of the same series on your different sites.
 */

/** Sentences that are about the site, the authors or "read it here", not about the story. */
const JUNK = [
  /\bwas written by\b|\bdrawn by\b|\bwritten and illustrated by\b/i,
  /\b(?:this series was )?published (?:on|in) \d{4}\b/i,
  /\brecommended for readers\b/i,
  /\balso known as\b/i,
  /^\s*read\b[^.!?]*\b(?:online|for free|free|on|at)\b/i,
  /\b(?:online for free|read (?:it )?(?:online|for free))\b/i,
  /\bat (?:mangafreak|weeb ?central|mangastash|baetoon|manganato)\b/i,
  /\b(?:latest chapters|high[- ]quality scans|raw versions|immersive reading|stay up[- ]to[- ]date)\b/i,
  /\bis searched by many\b|\brecently published\b|\brencently published\b|\bis published online\b/i,
  /\bis alternative\b/i,
  /جميع فصول|قراءة (?:جميع )?فصول|اقرأ مانجا|مترجم(?:ة)? (?:للعربية|عربي|بجودة|اون لاين|أون لاين)|اون لاين|أون لاين|على موقع|تابع الفصول|استمتع بأحداث|الفصول المتوفرة/
]

/** A summary shorter than this, once cleaned, says too little to show. */
const MIN_STORY = 60

function sentences(text: string): string[] {
  // a sentence ends at . ! ? ؟ (or …) followed by a space or the end; quotes and brackets stay with their sentence
  return text.match(/[^.!?؟…]+(?:[.!?؟…]+["'”’)\]]*|$)\s*/g) ?? [text]
}

export function cleanStory(raw: string, title = ''): string {
  let t = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  // ManhuaTop wraps the story: '… The description of the comics "X": <story> "X" is alternative: …'
  const wrapped = t.match(/the description of the (?:comics|manhwa|manhua|manga)[^:]*:\s*(.*)$/i)
  if (wrapped) t = wrapped[1].replace(/\s*["“][^"”]*["”]\s+is alternative:.*$/i, '').trim()
  // OlympusStaff: "مانجا X مترجمةX <story>"
  if (title) {
    const lead = new RegExp('^\\s*مانجا\\s+' + escapeRe(title) + '\\s+مترجمة\\s*(?:' + escapeRe(title) + ')?\\s*', 'i')
    t = t.replace(lead, '')
  }
  const kept = sentences(t).filter((s) => !JUNK.some((re) => re.test(s)))
  const out = kept.join('').replace(/\s+/g, ' ').trim()
  return out.length >= MIN_STORY ? out : ''
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface StoryCandidate {
  text: string
  /** The language of the site it came from. */
  lang?: 'ar' | 'en' | 'other'
  /** From the site being read. */
  own?: boolean
  /** Where it came from, for "from X". */
  from?: string
}

/**
 * The best story among the same series' summaries: the site being read when it has a real one, else the fullest one
 * in the reader's language, else the fullest one in any language. A cut-off summary ("…") counts as shorter.
 */
export function pickStory(
  list: StoryCandidate[],
  title: string,
  lang?: 'ar' | 'en' | 'other'
): { text: string; from?: string } | null {
  const clean = list
    .map((c) => ({ ...c, text: cleanStory(c.text, title) }))
    .filter((c) => c.text.length > 0)
  if (clean.length === 0) return null
  const own = clean.find((c) => c.own)
  if (own) return { text: own.text }
  const score = (c: StoryCandidate): number => c.text.length - (/(?:…|\.\.\.)$/.test(c.text) ? 200 : 0)
  const best = (xs: StoryCandidate[]): StoryCandidate | undefined =>
    [...xs].sort((a, b) => score(b) - score(a))[0]
  const pick = best(clean.filter((c) => !lang || !c.lang || c.lang === lang)) ?? best(clean)!
  return { text: pick.text, from: pick.from }
}

/** AniList descriptions are light HTML ("<br>", "<i>") with a "(Source: …)" note at the end. */
export function aniListText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s*\((?:source|from)[^)]*\)\s*$/i, '')
    .replace(/\s*(?:source|note)\s*:.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}
