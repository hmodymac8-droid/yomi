/** Wraps a remote image URL so the main process fetches it with the right Referer. */
export function proxied(img: string, referer: string): string {
  return `mr-img://img/?u=${encodeURIComponent(img)}&r=${encodeURIComponent(referer)}`
}

/**
 * A cover picture: the app keeps a small copy (big covers are shrunk once, when first saved), which is all a card needs
 * and takes far less memory than the original.
 */
export function coverSrc(img: string, referer: string): string {
  return proxied(img, referer) + '&c=1'
}

export function timeAgo(ms: number): string {
  if (!ms) return 'never'
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

/** Same identity the main process uses to tell chapters apart (title, since links can change provider). */
export const chapterKey = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').trim()

/** URL of a page saved by the download manager (served from disk by the main process). */
export function localPage(item: { dir: string }, file: string): string {
  return `mr-img://local/?f=${encodeURIComponent(item.dir + '/' + file)}`
}

/** Local pages are used as-is; remote ones go through the Referer-adding proxy. */
export function pageSrc(page: string, referer: string): string {
  return page.startsWith('mr-img://local/') ? page : proxied(page, referer)
}

/** If the full-size cover fails to load, swap in the small thumbnail we scanned (once). */
export function fallbackCover(
  e: { currentTarget: HTMLImageElement },
  fallback: string | undefined,
  referer: string
): void {
  const img = e.currentTarget
  if (!fallback || img.dataset.fb) {
    // nothing more to try: hide the broken picture, the cover box shows the title's first letter (see .nocover)
    img.style.visibility = 'hidden'
    img.parentElement?.classList.add('nocover')
    return
  }
  img.dataset.fb = '1'
  img.src = coverSrc(fallback, referer)
}

export interface OpenSeries {
  title: string
  cover: string
  coverFallback?: string
  coverReferer: string
  /** What the series page says it is, when it says it (manga / manhwa / manhua). */
  type?: 'manga' | 'manhwa' | 'manhua'
  entries: { sourceId: string; sourceName: string; url: string }[]
}

export interface OpenChapter {
  url: string
  title: string
  /** `fill`: a chapter read from another of your sites (it fills a hole in this site's list). */
  chapters: { title: string; url: string; alts?: string[]; fill?: string; fillName?: string }[]
  referer: string
  /** The series page this chapter belongs to (the key progress is saved under). */
  seriesUrl: string
  sourceId: string
}

/** The chapter number in a chapter's name ("Chapter 12.5", "Ch. 7", "Episode 3", "الفصل 40"), or null if it has none. */
export function chapterNumber(title: string): number | null {
  const t = title.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const m =
    t.match(/(?:chapter|chap|ch|episode|ep|الفصل|فصل|الحلقة)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)/i) ?? t.match(/(\d+(?:\.\d+)?)(?!.*\d)/)
  return m ? Number(m[1]) : null
}

type ChapterRef = { title: string; url: string; alts?: string[] }

/**
 * Where to carry on reading a series (chapters are listed newest first): the chapter you were in, or the next one if you
 * finished it, or the first chapter if you never read it.
 */
export function continueChapter(chapters: ChapterRef[], rec: { chapterUrl: string; read: string[] } | null): ChapterRef | undefined {
  if (chapters.length === 0) return undefined
  if (!rec) return chapters[chapters.length - 1]
  const i = chapters.findIndex((c) => c.url === rec.chapterUrl || c.alts?.includes(rec.chapterUrl))
  if (i < 0) return chapters[chapters.length - 1]
  const done = rec.read.includes(chapters[i].url) || rec.read.includes(rec.chapterUrl)
  return done && i > 0 ? chapters[i - 1] : chapters[i]
}

/**
 * Opens a series straight in the reader, at the chapter `pick` chooses from its chapter list (the saved list is used
 * when there is one, so this is quick). Null when the list can't be read or `pick` finds nothing.
 */
export async function readerFor(
  sourceId: string,
  seriesUrl: string,
  pick: (chapters: ChapterRef[]) => ChapterRef | undefined
): Promise<OpenChapter | null> {
  const res = await window.api.getSeries(sourceId, seriesUrl)
  if (!res.ok) return null
  const c = pick(res.data.chapters)
  if (!c) return null
  return { url: c.url, title: c.title, chapters: res.data.chapters, referer: new URL(seriesUrl).origin + '/', seriesUrl, sourceId }
}
