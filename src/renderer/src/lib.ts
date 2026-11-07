/** Wraps a remote image URL so the main process fetches it with the right Referer. */
export function proxied(img: string, referer: string): string {
  return `mr-img://img/?u=${encodeURIComponent(img)}&r=${encodeURIComponent(referer)}`
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
  if (!fallback || img.dataset.fb) return
  img.dataset.fb = '1'
  img.src = proxied(fallback, referer)
}

export interface OpenSeries {
  title: string
  cover: string
  coverFallback?: string
  coverReferer: string
  entries: { sourceId: string; sourceName: string; url: string }[]
}

export interface OpenChapter {
  url: string
  title: string
  chapters: { title: string; url: string; alts?: string[] }[]
  referer: string
  /** The series page this chapter belongs to (the key progress is saved under). */
  seriesUrl: string
  sourceId: string
}
