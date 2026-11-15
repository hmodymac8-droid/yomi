import assert from 'node:assert/strict'
import test from 'node:test'
import { YOMI_LOGO, activityFor, decodeFrames, encodeFrame, presenceKey } from '../src/main/discordLogic.ts'

test('reading shows the series, chapter and cover', () => {
  const a = activityFor(
    { screen: 'reader', title: 'Solo Leveling', chapter: 'Chapter 12', cover: 'https://x.com/c.jpg' },
    'full',
    5
  )
  assert.equal(a?.details, 'Reading Solo Leveling')
  assert.equal(a?.state, 'Chapter 12')
  assert.equal(a?.assets?.large_image, 'https://x.com/c.jpg')
  assert.equal(a?.assets?.small_image, YOMI_LOGO)
  assert.deepEqual(a?.timestamps, { start: 5 })
})

test('without details, no title is shown', () => {
  const a = activityFor({ screen: 'reader', title: 'Secret', chapter: 'Ch 1' }, 'app', 1)
  assert.equal(a?.details, 'Reading manga')
  assert.equal(a?.state, undefined)
  assert.ok(!JSON.stringify(a).includes('Secret'))
})

test('off shows nothing; other screens get a short line; long text is cut', () => {
  assert.equal(activityFor({ screen: 'browse' }, 'off', 1), null)
  assert.equal(activityFor({ screen: 'browse' }, 'full', 1)?.details, 'Browsing Discover')
  const long = activityFor({ screen: 'series', title: 'a'.repeat(300), cover: 'http://x/c.jpg' }, 'full', 1)
  assert.equal(long?.details?.length, 128)
  assert.equal(long?.assets?.large_image, YOMI_LOGO) // not https: Discord could not fetch it
})

test('the clock restarts only on a new chapter', () => {
  const k1 = presenceKey({ screen: 'reader', title: 'A', chapter: '1' }, 'full')
  const k2 = presenceKey({ screen: 'reader', title: 'A', chapter: '2' }, 'full')
  assert.notEqual(k1, k2)
  assert.equal(presenceKey({ screen: 'reader', title: 'A', chapter: '1' }, 'app'), presenceKey({ screen: 'reader', title: 'B' }, 'app'))
})

test('frames round-trip, also when split', () => {
  const buf = Buffer.concat([encodeFrame(1, { a: 1 }), encodeFrame(3, { b: 'ü' })])
  const part = decodeFrames(buf.subarray(0, buf.length - 3))
  assert.equal(part.frames.length, 1)
  const all = decodeFrames(Buffer.concat([part.rest, buf.subarray(buf.length - 3)]))
  assert.deepEqual(all.frames, [{ op: 3, data: { b: 'ü' } }])
})
