import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveReaderSettings,
  snapSpreadStart,
  spreadView,
  typeDefault,
  type GlobalReaderSettings
} from '../src/renderer/src/readerSettings.ts'

const global: GlobalReaderSettings = {
  mode: 'webtoon',
  dir: 'ltr',
  spread: false,
  coverSingle: false
}

test('no override and no type keeps the global settings', () => {
  assert.deepEqual(resolveReaderSettings(undefined, undefined, global), global)
  assert.deepEqual(resolveReaderSettings({}, null, global), global)
  const other: GlobalReaderSettings = { mode: 'paged', dir: 'rtl', spread: true, coverSingle: true }
  assert.deepEqual(resolveReaderSettings(undefined, undefined, other), other)
  assert.deepEqual(resolveReaderSettings({}, undefined, other), other)
})

test('a manga reads paged and right to left', () => {
  const r = resolveReaderSettings(undefined, 'manga', global)
  assert.equal(r.mode, 'paged')
  assert.equal(r.dir, 'rtl')
  // spread and cover are not type defaults: they stay global
  assert.equal(r.spread, false)
  assert.equal(r.coverSingle, false)
})

test('manhwa and manhua read as a vertical scroll, left to right', () => {
  const wide: GlobalReaderSettings = { mode: 'paged', dir: 'rtl', spread: true, coverSingle: true }
  for (const t of ['manhwa', 'manhua'] as const) {
    const r = resolveReaderSettings(undefined, t, wide)
    assert.equal(r.mode, 'webtoon')
    assert.equal(r.dir, 'ltr')
    assert.equal(r.spread, true)
    assert.equal(r.coverSingle, true)
  }
})

test('one field of the series override leaves the other to the type', () => {
  const r = resolveReaderSettings({ mode: 'webtoon' }, 'manga', global)
  assert.equal(r.mode, 'webtoon')
  assert.equal(r.dir, 'rtl')

  const back = resolveReaderSettings({ dir: 'ltr' }, 'manga', global)
  assert.equal(back.mode, 'paged')
  assert.equal(back.dir, 'ltr')
})

test('the series override wins over the type and the global setting', () => {
  const r = resolveReaderSettings({ mode: 'paged', dir: 'ltr' }, 'manhwa', global)
  assert.equal(r.mode, 'paged')
  assert.equal(r.dir, 'ltr')
})

test('an empty override falls back to the type, then to the global setting', () => {
  assert.deepEqual(
    resolveReaderSettings({}, 'manga', global),
    resolveReaderSettings(undefined, 'manga', global)
  )
  assert.deepEqual(resolveReaderSettings({}, undefined, global), global)
})

test('spread and cover can be set per series', () => {
  const r = resolveReaderSettings({ spread: true, coverSingle: true }, 'manga', global)
  assert.equal(r.spread, true)
  assert.equal(r.coverSingle, true)
  const off = resolveReaderSettings({ spread: false }, 'manga', {
    ...global,
    spread: true
  })
  assert.equal(off.spread, false)
})

test('typeDefault only speaks for the types it knows', () => {
  assert.deepEqual(typeDefault('manga'), { mode: 'paged', dir: 'rtl' })
  assert.deepEqual(typeDefault('manhwa'), { mode: 'webtoon', dir: 'ltr' })
  assert.deepEqual(typeDefault('manhua'), { mode: 'webtoon', dir: 'ltr' })
  assert.deepEqual(typeDefault(undefined), {})
  assert.deepEqual(typeDefault(null), {})
})

test('left to right: the earlier page is on the left', () => {
  assert.deepEqual(spreadView(0, 20, 'ltr', false), { start: 0, left: 0, right: 1, size: 2 })
  assert.deepEqual(spreadView(2, 20, 'ltr', false), { start: 2, left: 2, right: 3, size: 2 })
})

test('right to left: the earlier page is on the right', () => {
  assert.deepEqual(spreadView(0, 20, 'rtl', false), { start: 0, left: 1, right: 0, size: 2 })
  assert.deepEqual(spreadView(2, 20, 'rtl', false), { start: 2, left: 3, right: 2, size: 2 })
})

test('a cover is shown alone, then the pairs start at page 1', () => {
  assert.deepEqual(spreadView(0, 20, 'ltr', true), { start: 0, single: 0, size: 1 })
  assert.deepEqual(spreadView(1, 20, 'ltr', true), { start: 1, left: 1, right: 2, size: 2 })
  assert.deepEqual(spreadView(1, 20, 'rtl', true), { start: 1, left: 2, right: 1, size: 2 })
})

test('an odd last page is shown alone', () => {
  assert.deepEqual(spreadView(4, 5, 'ltr', false), { start: 4, single: 4, size: 1 })
  assert.deepEqual(spreadView(4, 5, 'rtl', false), { start: 4, single: 4, size: 1 })
  assert.deepEqual(spreadView(0, 1, 'ltr', false), { start: 0, single: 0, size: 1 })
})

test('snapSpreadStart pulls an index back to the start of its spread', () => {
  assert.equal(snapSpreadStart(0, 20, false), 0)
  assert.equal(snapSpreadStart(1, 20, false), 0)
  assert.equal(snapSpreadStart(2, 20, false), 2)
  assert.equal(snapSpreadStart(3, 20, false), 2)
  assert.equal(snapSpreadStart(0, 20, true), 0)
  assert.equal(snapSpreadStart(1, 20, true), 1)
  assert.equal(snapSpreadStart(2, 20, true), 1)
  assert.equal(snapSpreadStart(3, 20, true), 3)
  assert.equal(snapSpreadStart(4, 20, true), 3)
  assert.equal(snapSpreadStart(99, 20, false), 18)
  assert.equal(snapSpreadStart(-5, 20, false), 0)
  assert.equal(snapSpreadStart(3, 0, false), 0)
})

test('a mid-spread index still shows the whole spread', () => {
  assert.deepEqual(spreadView(3, 20, 'ltr', false), { start: 2, left: 2, right: 3, size: 2 })
  assert.deepEqual(spreadView(2, 20, 'ltr', true), { start: 1, left: 1, right: 2, size: 2 })
})
