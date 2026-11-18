import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropOtherSeries } from '../src/main/chapterText.ts'

const S = 'https://www.manganato.gg/manga/hitozuma-colored'
const ch = (url: string): { url: string } => ({ url })

test("a sidebar of other series' chapters is dropped", () => {
  const list = [
    ch('https://www.manganato.gg/manga/chiikawa/chapter-200'),
    ch('https://www.manganato.gg/manga/d-frag/chapter-184'),
    ch('https://www.manganato.gg/manga/hitozuma-colored/chapter-3')
  ]
  assert.deepEqual(dropOtherSeries(list, S), [list[2]])
  assert.deepEqual(dropOtherSeries(list.slice(0, 2), S), [])
})

test('chapters under one other address are kept (the series may have moved)', () => {
  const list = [
    ch('https://www.manganato.gg/manga/hitozuma-colored-v2/chapter-1'),
    ch('https://www.manganato.gg/manga/hitozuma-colored-v2/chapter-2')
  ]
  assert.deepEqual(dropOtherSeries(list, S), list)
})

test('opaque chapter addresses are kept', () => {
  const list = [ch('https://site.com/chapter/123'), ch('https://site.com/read/456')]
  assert.deepEqual(dropOtherSeries(list, 'https://site.com/series/abc'), list)
  assert.deepEqual(dropOtherSeries(list, 'https://site.com/abc'), list)
})
