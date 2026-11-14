/* Reading stats arithmetic (no Electron, no files), so it can be tested. */

export interface StatsData {
  /** By local day (YYYY-MM-DD): chapters finished and time spent reading (ms). */
  days: Record<string, { chapters: number; ms: number }>
  /** Every chapter finished, oldest first. */
  finished: { at: number; seriesUrl: string; title: string; chapter: string }[]
}

export interface StatsSummary {
  totalChapters: number
  totalMs: number
  weekChapters: number
  weekMs: number
  /** Days in a row (up to today, or up to yesterday if nothing is read yet today) with at least one chapter. */
  streak: number
  longestStreak: number
  /** The last 30 days, oldest first. */
  daily: { day: string; chapters: number; ms: number }[]
  topGenres: { name: string; chapters: number }[]
  topSeries: { title: string; seriesUrl: string; chapters: number }[]
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** The local calendar day of a time, as YYYY-MM-DD. */
export function dayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function addDays(t: number, n: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

export function summarize(
  data: StatsData,
  now: number,
  genresOf: (seriesUrl: string) => string[]
): StatsSummary {
  const has = (k: string): boolean => (data.days[k]?.chapters ?? 0) > 0
  let totalChapters = 0
  let totalMs = 0
  for (const d of Object.values(data.days)) {
    totalChapters += d.chapters
    totalMs += d.ms
  }
  const daily: StatsSummary['daily'] = []
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(addDays(now, -i))
    daily.push({ day: k, chapters: data.days[k]?.chapters ?? 0, ms: data.days[k]?.ms ?? 0 })
  }
  const week = daily.slice(-7)
  // current streak: today counts if you read today; if not yet, the streak up to yesterday still stands
  let streak = 0
  let t = has(dayKey(now)) ? now : addDays(now, -1)
  while (has(dayKey(t))) {
    streak++
    t = addDays(t, -1)
  }
  let longestStreak = 0
  const keys = Object.keys(data.days).filter(has).sort()
  let run = 0
  let prev = ''
  for (const k of keys) {
    const [y, m, d] = k.split('-').map(Number)
    const before = dayKey(new Date(y, m - 1, d - 1).getTime())
    run = prev === before ? run + 1 : 1
    prev = k
    if (run > longestStreak) longestStreak = run
  }
  // the last 90 days decide your top genres and series
  const since = addDays(now, -90)
  const recent = data.finished.filter((f) => f.at >= since)
  const genreCount = new Map<string, number>()
  const seriesCount = new Map<string, { title: string; chapters: number }>()
  for (const f of recent) {
    for (const g of genresOf(f.seriesUrl)) genreCount.set(g, (genreCount.get(g) ?? 0) + 1)
    const s = seriesCount.get(f.seriesUrl) ?? { title: f.title, chapters: 0 }
    s.chapters++
    seriesCount.set(f.seriesUrl, s)
  }
  return {
    totalChapters,
    totalMs,
    weekChapters: week.reduce((n, d) => n + d.chapters, 0),
    weekMs: week.reduce((n, d) => n + d.ms, 0),
    streak,
    longestStreak: Math.max(longestStreak, streak),
    daily,
    topGenres: [...genreCount.entries()]
      .map(([name, chapters]) => ({ name, chapters }))
      .sort((a, b) => b.chapters - a.chapters)
      .slice(0, 8),
    topSeries: [...seriesCount.entries()]
      .map(([seriesUrl, s]) => ({ seriesUrl, title: s.title, chapters: s.chapters }))
      .sort((a, b) => b.chapters - a.chapters)
      .slice(0, 6)
  }
}
