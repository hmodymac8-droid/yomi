/*
 * Chapter rows often print the chapter and its age side by side ("Chapter 59" and "16 months ago"). When a page gives
 * the two without a space between them ("Chapter 5916 months ago") the first number read is wrong (5916), and it
 * changes as the chapter ages, so an old chapter keeps looking like a new one. These helpers undo that.
 */

/** Words that follow an age: "16 months ago", "3h", "2 d", "yesterday". */
const AGE_AFTER = /^\s*(?:s|sec|secs|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|mos|months?|y|yrs?|years?)\b/i

/**
 * The real number when the title's number is the link's chapter number with an age glued on. `titleNum` is the
 * number read from the title, `rest` the title text right after it, `urlNum` the number in the chapter's address.
 */
export function unglueNumber(titleNum: string, rest: string, urlNum: string | null): string {
  if (!urlNum || titleNum === urlNum) return titleNum
  if (!titleNum.startsWith(urlNum) || titleNum.length <= urlNum.length) return titleNum
  return AGE_AFTER.test(rest) ? urlNum : titleNum
}

/**
 * Drops chapter links that belong to OTHER series shown on a series page (a "latest updates" sidebar): next to
 * …/manga/this-series they point at …/manga/some-other-series/chapter-5. A series the site has no chapters for any
 * more otherwise gets the sidebar as its chapter list, and since that sidebar changes all the time, keeps reporting
 * "new chapters". Links under two or more different neighbouring series are a sidebar; links under just one are kept
 * (that can be this same series under a new address).
 */
export function dropOtherSeries<T extends { url: string }>(list: T[], seriesUrl: string): T[] {
  let origin: string
  let parent: string[]
  let self: string
  try {
    const u = new URL(seriesUrl)
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length < 2) return list // a series at the site's root: its neighbours can't be told apart
    origin = u.origin
    self = segs[segs.length - 1].toLowerCase()
    parent = segs.slice(0, -1).map((s) => s.toLowerCase())
  } catch {
    return list
  }
  const neighbourOf = (url: string): string | null => {
    try {
      const u = new URL(url)
      if (u.origin !== origin) return null
      const segs = u.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase())
      if (segs.length <= parent.length + 1) return null
      if (parent.some((p, i) => segs[i] !== p)) return null
      const s = segs[parent.length]
      return s === self ? null : s
    } catch {
      return null
    }
  }
  const neighbours = new Set(list.map((c) => neighbourOf(c.url)).filter((s) => s !== null))
  if (neighbours.size < 2) return list
  return list.filter((c) => neighbourOf(c.url) === null)
}
