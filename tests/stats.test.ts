import assert from 'node:assert/strict'
import test from 'node:test'
import { dayKey, summarize, type StatsData } from '../src/main/statsLogic.ts'

const NOW = new Date(2026, 10, 14, 15, 0).getTime() // 14 Nov 2026, afternoon
const day = (back: number): string => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - back)
  return dayKey(d.getTime())
}
const at = (back: number): number => NOW - back * 86400000

test('streak counts days in a row up to today, longest streak is kept', () => {
  const data: StatsData = {
    days: {
      [day(0)]: { chapters: 2, ms: 600000 },
      [day(1)]: { chapters: 1, ms: 0 },
      [day(2)]: { chapters: 3, ms: 0 },
      // gap at 3
      [day(10)]: { chapters: 1, ms: 0 },
      [day(11)]: { chapters: 1, ms: 0 },
      [day(12)]: { chapters: 1, ms: 0 },
      [day(13)]: { chapters: 1, ms: 0 }
    },
    finished: []
  }
  const s = summarize(data, NOW, () => [])
  assert.equal(s.streak, 3)
  assert.equal(s.longestStreak, 4)
  assert.equal(s.totalChapters, 10)
  assert.equal(s.weekChapters, 6)
  assert.equal(s.weekMs, 600000)
  assert.equal(s.daily.length, 30)
  assert.equal(s.daily[29].day, day(0))
  assert.equal(s.daily[29].chapters, 2)
})

test('nothing read yet today keeps the streak up to yesterday', () => {
  const data: StatsData = { days: { [day(1)]: { chapters: 1, ms: 0 }, [day(2)]: { chapters: 1, ms: 0 } }, finished: [] }
  assert.equal(summarize(data, NOW, () => []).streak, 2)
  const broken: StatsData = { days: { [day(2)]: { chapters: 1, ms: 0 } }, finished: [] }
  assert.equal(summarize(broken, NOW, () => []).streak, 0)
})

test('top genres and series come from the last 90 days', () => {
  const data: StatsData = {
    days: {},
    finished: [
      { at: at(1), seriesUrl: 'a', title: 'A', chapter: '1' },
      { at: at(2), seriesUrl: 'a', title: 'A', chapter: '2' },
      { at: at(3), seriesUrl: 'b', title: 'B', chapter: '1' },
      { at: at(200), seriesUrl: 'c', title: 'C', chapter: '1' } // too old
    ]
  }
  const genres: Record<string, string[]> = { a: ['Action', 'Fantasy'], b: ['Romance'], c: ['Horror'] }
  const s = summarize(data, NOW, (u) => genres[u] ?? [])
  assert.deepEqual(s.topGenres.map((g) => [g.name, g.chapters]), [['Action', 2], ['Fantasy', 2], ['Romance', 1]])
  assert.deepEqual(s.topSeries.map((x) => [x.title, x.chapters]), [['A', 2], ['B', 1]])
})
