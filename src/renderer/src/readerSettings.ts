/**
 * How a series is read: the series' own choice, else (only if the type defaults are on) the default for its type, else the global setting.
 * Plain functions only (no React, no Electron) so the tests can import this file directly.
 */

export type Mode = 'webtoon' | 'paged'
export type Dir = 'ltr' | 'rtl'
export type SeriesType = 'manga' | 'manhwa' | 'manhua'

export interface GlobalReaderSettings {
  mode: Mode
  dir: Dir
  /** Two pages side by side; only used when the mode is paged. */
  spread: boolean
  /** Show the first page alone, then pair the rest. */
  coverSingle: boolean
}

export interface SeriesReaderOverride {
  mode?: Mode
  dir?: Dir
  spread?: boolean
  coverSingle?: boolean
}

/**
 * What the program did before any setting was touched: a vertical scroll, left to right, no spread, no cover.
 * Someone who never opens the reading settings gets exactly this.
 */
export const ORIGINAL_DEFAULTS: GlobalReaderSettings = {
  mode: 'webtoon',
  dir: 'ltr',
  spread: false,
  coverSingle: false
}

/**
 * What a series type is usually read like. A helper only: it says nothing about spread or cover, and it is
 * used only when the reader has turned the type defaults on (see resolveReaderSettings).
 */
export function typeDefault(type?: SeriesType | null): Partial<GlobalReaderSettings> {
  if (type === 'manga') return { mode: 'paged', dir: 'rtl' }
  if (type === 'manhwa' || type === 'manhua') return { mode: 'webtoon', dir: 'ltr' }
  return {}
}

/**
 * Series override, then the type's default (only when `openByType` is on), then the global setting, field by field.
 * With `openByType` off — the default — the type is ignored completely, so the result is the global setting unless
 * the series has a choice of its own.
 */
export function resolveReaderSettings(
  override: SeriesReaderOverride | undefined,
  type: SeriesType | null | undefined,
  global: GlobalReaderSettings,
  openByType = false
): GlobalReaderSettings {
  const byType = openByType ? typeDefault(type) : {}
  return {
    mode: override?.mode ?? byType.mode ?? global.mode,
    dir: override?.dir ?? byType.dir ?? global.dir,
    spread: override?.spread ?? byType.spread ?? global.spread,
    coverSingle: override?.coverSingle ?? byType.coverSingle ?? global.coverSingle
  }
}

export interface SpreadView {
  /** First page index of this view (0-based). */
  start: number
  /** Page index shown on the LEFT, if any. */
  left?: number
  /** Page index shown on the RIGHT, if any. */
  right?: number
  /** When only one page is shown (the cover, or a leftover last page). */
  single?: number
  /** 1 or 2: how far next / prev should move. */
  size: number
}

/** Snap an index to a valid spread start (0, 2, 4… or 0, 1, 3, 5… when the first page is a cover). */
export function snapSpreadStart(index: number, pageCount: number, coverSingle: boolean): number {
  if (pageCount <= 0) return 0
  const i = Math.max(0, Math.min(pageCount - 1, Math.floor(index)))
  if (i === 0) return 0
  if (coverSingle) return i % 2 === 1 ? i : i - 1
  return i % 2 === 0 ? i : i - 1
}

/**
 * The pages of the spread that begins at `start`, already snapped.
 * Left to right: the earlier page is on the left. Right to left: the earlier page is on the right (manga order).
 */
export function spreadView(
  start: number,
  pageCount: number,
  dir: Dir,
  coverSingle: boolean
): SpreadView {
  if (pageCount <= 0) return { start: 0, size: 1 }
  const s = snapSpreadStart(start, pageCount, coverSingle)
  if (coverSingle && s === 0) return { start: 0, single: 0, size: 1 }
  const second = s + 1
  if (second >= pageCount) return { start: s, single: s, size: 1 }
  return dir === 'rtl'
    ? { start: s, left: second, right: s, size: 2 }
    : { start: s, left: s, right: second, size: 2 }
}

// ---- the series' own choices, kept in localStorage (one map, keyed by series) ----

const OVERRIDES_KEY = 'reader.seriesOverrides'

/** The key a series' own settings are kept under: its title, or the series URL when it has no title. */
export function seriesKey(title: string, seriesUrl: string): string {
  const t = (title ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  return t || seriesUrl
}

function tidy(o: SeriesReaderOverride | undefined): SeriesReaderOverride | undefined {
  if (!o) return undefined
  const out: SeriesReaderOverride = {}
  if (o.mode !== undefined) out.mode = o.mode
  if (o.dir !== undefined) out.dir = o.dir
  if (o.spread !== undefined) out.spread = o.spread
  if (o.coverSingle !== undefined) out.coverSingle = o.coverSingle
  return Object.keys(out).length > 0 ? out : undefined
}

function readAll(): Record<string, SeriesReaderOverride> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, SeriesReaderOverride>)
      : {}
  } catch {
    return {}
  }
}

export function loadSeriesOverride(key: string): SeriesReaderOverride | undefined {
  const own = readAll()[key]
  return own && typeof own === 'object' ? own : undefined
}

export function saveSeriesOverride(key: string, override: SeriesReaderOverride | undefined): void {
  try {
    const all = readAll()
    const clean = tidy(override)
    if (clean) all[key] = clean
    else delete all[key]
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all))
  } catch {
    /* storage blocked: the choice just won't stick */
  }
}
