/*
 * Filling holes in a chapter list from your other sites. Pure logic (no Electron, no network) so it can be tested:
 * which chapter numbers are missing, and which chapters of another site's list fill them.
 */

export interface Chap {
  title: string
  url: string
  alts?: string[]
}

export interface FilledChap extends Chap {
  /** The site the chapter is read from. */
  fill: string
  fillName: string
}

/** A chapter's number ("Chapter 12.5", "Ch. 7", "الفصل 40"), or null if it has none. */
export function numberOf(title: string): number | null {
  const t = title.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const m =
    t.match(/(?:chapter|chap|ch|episode|ep|الفصل|فصل|الحلقة)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)/i) ??
    t.match(/(\d+(?:\.\d+)?)(?!.*\d)/)
  return m ? Number(m[1]) : null
}

/** Whole chapter numbers missing between the first and last chapter of a list (at most `cap` of them). */
export function missingNumbers(chapters: Chap[], cap = 2000): number[] {
  const have = new Set<number>()
  for (const c of chapters) {
    const n = numberOf(c.title)
    if (n !== null && Number.isFinite(n)) have.add(n)
  }
  if (have.size < 2) return []
  const whole = [...have].filter((n) => Number.isInteger(n))
  if (whole.length < 2) return []
  const lo = Math.max(1, Math.min(...whole))
  const hi = Math.max(...whole)
  if (hi - lo > 5000) return [] // numbering that isn't a chapter count (years, ids): don't guess
  const out: number[] = []
  for (let n = lo; n <= hi && out.length < cap; n++) if (!have.has(n)) out.push(n)
  return out
}

/**
 * The chapters other sites have that this list lacks: every missing number inside the list, plus chapters newer
 * than its newest one. Each number is taken from the first site (in the order given) that has it.
 */
export function pickFills(
  own: Chap[],
  others: { sourceId: string; name: string; chapters: Chap[] }[],
  maxNewer = 200
): FilledChap[] {
  const have = new Set<number>()
  let newest = -Infinity
  for (const c of own) {
    const n = numberOf(c.title)
    if (n === null || !Number.isFinite(n)) continue
    have.add(n)
    if (n > newest) newest = n
  }
  if (have.size === 0) return []
  const holes = new Set(missingNumbers(own))
  const taken = new Map<number, FilledChap>()
  for (const o of others) {
    for (const c of o.chapters) {
      const n = numberOf(c.title)
      if (n === null || !Number.isFinite(n) || have.has(n) || taken.has(n)) continue
      const inHole = holes.has(n) || (!Number.isInteger(n) && n > Math.min(...have) && n < newest)
      const newer = n > newest && n - newest <= maxNewer
      if (!inHole && !newer) continue
      taken.set(n, { ...c, fill: o.sourceId, fillName: o.name })
    }
  }
  return [...taken.values()]
}

/** Own chapters and filled ones in one list, newest first (the order the sites use). */
export function mergeFilled<T extends Chap>(own: T[], fills: FilledChap[]): (T | FilledChap)[] {
  if (fills.length === 0) return own
  const all: (T | FilledChap)[] = [...own, ...fills]
  const key = (c: Chap, i: number): [number, number] => [numberOf(c.title) ?? -Infinity, i]
  const indexed = all.map((c, i) => ({ c, k: key(c, i) }))
  // chapters without a number keep their place relative to the site's own order (at the end of their group)
  indexed.sort((a, b) => b.k[0] - a.k[0] || a.k[1] - b.k[1])
  return indexed.map((x) => x.c)
}
