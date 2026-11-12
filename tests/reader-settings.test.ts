import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ORIGINAL_DEFAULTS,
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

const wide: GlobalReaderSettings = {
  mode: 'paged',
  dir: 'rtl',
  spread: true,
  coverSingle: true
}

const TYPES = ['manga', 'manhwa', 'manhua', undefined, null] as const

test('the original program defaults are a vertical scroll, left to right, no spread, no cover', () => {
  assert.deepEqual(ORIGINAL_DEFAULTS, {
    mode: 'webtoon',
    dir: 'ltr',
    spread: false,
    coverSingle: false
  })
})

test('with the type defaults off, the type has no effect at all', () => {
  for (const g of [ORIGINAL_DEFAULTS, wide]) {
    for (const t of TYPES) {
      assert.deepEqual(resolveReaderSettings(undefined, t, g, false), g)
      assert.deepEqual(resolveReaderSettings({}, t, g, false), g)
      // leaving the toggle out behaves like false
      assert.deepEqual(resolveReaderSettings(undefined, t, g), g)
      assert.deepEqual(resolveReaderSettings({}, t, g), g)
    }
  }
})

test('with the type defaults on, a manga reads paged and right to left', () => {
  const r = resolveReaderSettings(undefined, 'manga', global, true)
  assert.equal(r.mode, 'paged')
  assert.equal(r.dir, 'rtl')
  // spread and cover are not type defaults: they stay global
  assert.equal(r.spread, false)
  assert.equal(r.coverSingle, false)
})

test('with the type defaults on, manhwa and manhua read as a vertical scroll, left to right', () => {
  for (const t of ['manhwa', 'manhua'] as const) {
    const r = resolveReaderSettings(undefined, t, wide, true)
    assert.equal(r.mode, 'webtoon')
    assert.equal(r.dir, 'ltr')
    assert.equal(r.spread, true)
    assert.equal(r.coverSingle, true)
  }
})

test('with the type defaults on, an unknown type keeps the global settings', () => {
  for (const t of [undefined, null] as const) {
    assert.deepEqual(resolveReaderSettings(undefined, t, wide, true), wide)
    assert.deepEqual(resolveReaderSettings({}, t, global, true), global)
  }
})

test('a series override wins whether the type defaults are on or off', () => {
  for (const on of [true, false]) {
    const r = resolveReaderSettings({ mode: 'paged', dir: 'ltr' }, 'manhwa', global, on)
    assert.equal(r.mode, 'paged')
    assert.equal(r.dir, 'ltr')
  }
})

test('one field of the series override leaves the other to the type (when on), then the global setting', () => {
  const on = resolveReaderSettings({ mode: 'webtoon' }, 'manga', global, true)
  assert.equal(on.mode, 'webtoon')
  assert.equal(on.dir, 'rtl')

  const off = resolveReaderSettings({ mode: 'webtoon' }, 'manga', global, false)
  assert.equal(off.mode, 'webtoon')
  assert.equal(off.dir, 'ltr')

  const back = resolveReaderSettings({ dir: 'ltr' }, 'manga', global, true)
  assert.equal(back.mode, 'paged')
  assert.equal(back.dir, 'ltr')
})

test('an empty override with the type defaults off gives back exactly the global settings', () => {
  for (const g of [ORIGINAL_DEFAULTS, wide]) {
    for (const t of TYPES) {
      assert.deepEqual(resolveReaderSettings({}, t, g, false), g)
    }
  }
})

test('spread and cover can be set per series', () => {
  const r = resolveReaderSettings({ spread: true, coverSingle: true }, 'manga', global, false)
  assert.equal(r.spread, true)
  assert.equal(r.coverSingle, true)
  const off = resolveReaderSettings({ spread: false }, 'manga', { ...global, spread: true }, false)
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
