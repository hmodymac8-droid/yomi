import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeFilled, missingNumbers, numberOf, pickFills } from '../src/main/gapfillLogic.ts'

const ch = (n: number | string, site = 'a'): { title: string; url: string } => ({
  title: typeof n === 'number' ? `Chapter ${n}` : n,
  url: `https://${site}.test/c/${n}`
})

test('numberOf reads the chapter number, not the season', () => {
  assert.equal(numberOf('Season 2 Chapter 15'), 15)
  assert.equal(numberOf('الفصل ٤٠'), 40)
  assert.equal(numberOf('Ch. 7.5'), 7.5)
  assert.equal(numberOf('Prologue'), null)
})

test('missingNumbers finds holes between the first and last chapter', () => {
  const own = [10, 9, 6, 5, 3, 1].map((n) => ch(n))
  assert.deepEqual(missingNumbers(own), [2, 4, 7, 8])
  assert.deepEqual(missingNumbers([ch(1), ch(2), ch(3)]), [])
  assert.equal(missingNumbers([ch(20240101), ch(1)]).length, 0) // dates or ids, not a chapter count
})

test('pickFills takes holes and newer chapters from the first site that has them', () => {
  const own = [10, 9, 6, 5].map((n) => ch(n))
  const b = { sourceId: 'b', name: 'Site B', chapters: [12, 11, 10, 8, 7, 6].map((n) => ch(n, 'b')) }
  const c = { sourceId: 'c', name: 'Site C', chapters: [13, 8, 7.5].map((n) => ch(n, 'c')) }
  const fills = pickFills(own, [b, c])
  const got = Object.fromEntries(fills.map((f) => [numberOf(f.title), f.fill]))
  assert.deepEqual(got, { 12: 'b', 11: 'b', 8: 'b', 7: 'b', 13: 'c', 7.5: 'c' })
  assert.ok(fills.every((f) => f.fillName))
})

test('pickFills adds nothing the site already has, or chapters older than its first', () => {
  const own = [5, 4, 3].map((n) => ch(n))
  const b = { sourceId: 'b', name: 'B', chapters: [5, 4, 3, 2, 1].map((n) => ch(n, 'b')) }
  assert.deepEqual(pickFills(own, [b]), [])
})

test('mergeFilled slots filled chapters in by number, newest first', () => {
  const own = [10, 9, 6].map((n) => ch(n))
  const fills = pickFills(own, [{ sourceId: 'b', name: 'B', chapters: [8, 7].map((n) => ch(n, 'b')) }])
  const merged = mergeFilled(own, fills)
  assert.deepEqual(merged.map((c) => numberOf(c.title)), [10, 9, 8, 7, 6])
})
