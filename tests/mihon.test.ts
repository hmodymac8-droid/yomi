import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { parseBackup, readNumbers, shelfFor } from '../src/main/mihonLogic.ts'

// a tiny protobuf writer, enough to build a Mihon backup the way Mihon writes it
const varint = (n: bigint): number[] => {
  const out: number[] = []
  let v = BigInt.asUintN(64, n)
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return out
}
const key = (no: number, wire: number): number[] => varint(BigInt((no << 3) | wire))
const vInt = (no: number, n: number | bigint): number[] => [...key(no, 0), ...varint(BigInt(n))]
const vStr = (no: number, s: string): number[] => {
  const b = [...new TextEncoder().encode(s)]
  return [...key(no, 2), ...varint(BigInt(b.length)), ...b]
}
const vMsg = (no: number, body: number[]): number[] => [...key(no, 2), ...varint(BigInt(body.length)), ...body]
const vFloat = (no: number, f: number): number[] => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setFloat32(0, f, true)
  return [...key(no, 5), ...b]
}

const chapter = (name: string, n: number, read: boolean): number[] =>
  [...vStr(1, '/c/' + n), ...vStr(2, name), ...vInt(4, read ? 1 : 0), ...vFloat(9, n)]

const SOURCE_ID = 6247824327199706550n // big source ids, like Mihon's
const backup = [
  ...vMsg(1, [
    ...vInt(1, SOURCE_ID),
    ...vStr(2, '/manga/solo'),
    ...vStr(3, 'Solo Leveling'),
    ...vMsg(16, chapter('Chapter 1', 1, true)),
    ...vMsg(16, chapter('Chapter 2', 2, true)),
    ...vMsg(16, chapter('Chapter 2.5', 2.5, false)),
    ...vInt(17, 1), // category order 1 → "Plan to read"
    ...vMsg(104, [...vStr(1, '/c/2'), ...vInt(2, 1731000000000)]),
    ...vInt(100, 1)
  ]),
  ...vMsg(1, [...vInt(1, SOURCE_ID), ...vStr(2, '/manga/x'), ...vStr(3, 'الفارس'), ...vInt(100, 0)]),
  ...vMsg(2, [...vStr(1, 'Reading'), ...vInt(2, 0)]),
  ...vMsg(2, [...vStr(1, 'Plan to read'), ...vInt(2, 1)]),
  ...vMsg(101, [...vStr(1, 'Asura Scans'), ...vInt(2, SOURCE_ID)])
]

test('parseBackup reads library, categories, chapters, history and source names from a .tachibk', () => {
  const b = parseBackup(gzipSync(Uint8Array.from(backup)))
  assert.deepEqual(b.categories, ['Reading', 'Plan to read'])
  assert.equal(b.manga.length, 2)
  const solo = b.manga[0]
  assert.equal(solo.title, 'Solo Leveling')
  assert.equal(solo.sourceName, 'Asura Scans')
  assert.equal(solo.favorite, true)
  assert.deepEqual(solo.categories, ['Plan to read'])
  assert.deepEqual(solo.chapters.map((c) => [c.name, c.read, c.number]), [
    ['Chapter 1', true, 1],
    ['Chapter 2', true, 2],
    ['Chapter 2.5', false, 2.5]
  ])
  assert.equal(solo.lastReadAt, 1731000000000)
  assert.deepEqual([...readNumbers(solo)], [1, 2])
  assert.equal(b.manga[1].title, 'الفارس')
  assert.equal(b.manga[1].favorite, false)
})

test('parseBackup also takes an unzipped backup, and rejects a file that is not one', () => {
  assert.equal(parseBackup(Uint8Array.from(backup)).manga.length, 2)
  assert.throws(() => parseBackup(Uint8Array.from([0x1f, 0x8b, 1, 2, 3])), /not a Mihon/)
  assert.throws(() => parseBackup(Uint8Array.from([0x0a, 0x50, 1])), /cut short/)
})

test('shelfFor maps category names to Yomi shelves', () => {
  assert.equal(shelfFor(['Plan to read']), 'plan')
  assert.equal(shelfFor(['Completed']), 'finished')
  assert.equal(shelfFor(['Dropped']), 'dropped')
  assert.equal(shelfFor(['Action', 'Reading']), 'reading')
  assert.equal(shelfFor([]), 'reading')
})

test('parseBackup reads categories written as one packed block too', () => {
  const packed = [...key(17, 2), ...varint(2n), 0, 1] // categories [order 0, order 1] packed
  const b = parseBackup(
    Uint8Array.from([
      ...vMsg(1, [...vInt(1, 1), ...vStr(2, '/m'), ...vStr(3, 'Packed'), ...packed]),
      ...vMsg(2, [...vStr(1, 'Reading'), ...vInt(2, 0)]),
      ...vMsg(2, [...vStr(1, 'Completed'), ...vInt(2, 1)])
    ])
  )
  assert.deepEqual(b.manga[0].categories, ['Reading', 'Completed'])
})
