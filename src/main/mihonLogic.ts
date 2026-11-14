import { gunzipSync } from 'node:zlib'

/*
 * Reading a Mihon / Tachiyomi backup (.tachibk, or the older .proto.gz): gzip around a protobuf message. The field
 * numbers follow Mihon's backup models (eu.kanade.tachiyomi.data.backup.models). Only what Yomi uses is read: the
 * library entries with their categories and chapters (read or not), category names, and source names.
 * Pure logic: no Electron, no files, so it can be tested.
 */

export interface MihonChapter {
  name: string
  read: boolean
  number: number
}

export interface MihonManga {
  title: string
  url: string
  sourceName: string
  favorite: boolean
  categories: string[]
  chapters: MihonChapter[]
  lastReadAt: number
}

export interface MihonBackup {
  manga: MihonManga[]
  categories: string[]
}

type Field = { no: number; wire: number; v: bigint | Uint8Array | number }

/** Splits one protobuf message into its fields (repeated fields come back as several entries). */
export function readFields(buf: Uint8Array): Field[] {
  const out: Field[] = []
  let i = 0
  const varint = (): bigint => {
    let shift = 0n
    let r = 0n
    for (;;) {
      if (i >= buf.length) throw new Error('backup file is cut short')
      const b = buf[i++]
      r |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) return r
      shift += 7n
      if (shift > 70n) throw new Error('backup file is damaged (bad number)')
    }
  }
  while (i < buf.length) {
    const key = Number(varint())
    const no = key >>> 3
    const wire = key & 7
    if (wire === 0) out.push({ no, wire, v: varint() })
    else if (wire === 2) {
      const len = Number(varint())
      if (i + len > buf.length) throw new Error('backup file is cut short')
      out.push({ no, wire, v: buf.subarray(i, i + len) })
      i += len
    } else if (wire === 5) {
      if (i + 4 > buf.length) throw new Error('backup file is cut short')
      out.push({ no, wire, v: new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true) })
      i += 4
    } else if (wire === 1) {
      i += 8 // 64-bit fixed: not used by the fields Yomi reads
    } else throw new Error('backup file is damaged (unknown field type ' + wire + ')')
  }
  return out
}

const text = (v: Field['v']): string => (v instanceof Uint8Array ? new TextDecoder().decode(v) : '')
const int = (v: Field['v']): bigint => (typeof v === 'bigint' ? v : 0n)

/** A repeated whole-number field, whether it was written one by one or packed into a single block. */
function ints(fields: Field[], no: number): bigint[] {
  const out: bigint[] = []
  for (const f of fields) {
    if (f.no !== no) continue
    if (f.wire === 0) out.push(int(f.v))
    else if (f.v instanceof Uint8Array) {
      // packed: a run of varints
      let i = 0
      const b = f.v
      while (i < b.length) {
        let shift = 0n
        let r = 0n
        for (;;) {
          const x = b[i++]
          r |= BigInt(x & 0x7f) << shift
          if ((x & 0x80) === 0) break
          shift += 7n
        }
        out.push(r)
      }
    }
  }
  return out
}

export function parseBackup(file: Uint8Array): MihonBackup {
  let raw: Uint8Array
  try {
    raw = file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file) : file
  } catch {
    throw new Error('This is not a Mihon / Tachiyomi backup (it could not be unpacked).')
  }
  const top = readFields(raw)
  // categories: name (1), order (2), id (3). Library entries point at a category by its order (older backups) or id.
  const cats: { name: string; order: bigint; id: bigint }[] = []
  for (const f of top) {
    if (f.no !== 2 || !(f.v instanceof Uint8Array)) continue
    const c = readFields(f.v)
    cats.push({
      name: text(c.find((x) => x.no === 1)?.v ?? new Uint8Array()),
      order: int(c.find((x) => x.no === 2)?.v ?? 0n),
      id: int(c.find((x) => x.no === 3)?.v ?? 0n)
    })
  }
  const sources = new Map<bigint, string>()
  for (const f of top) {
    if (f.no !== 101 || !(f.v instanceof Uint8Array)) continue
    const s = readFields(f.v)
    sources.set(int(s.find((x) => x.no === 2)?.v ?? 0n), text(s.find((x) => x.no === 1)?.v ?? new Uint8Array()))
  }
  const manga: MihonManga[] = []
  for (const f of top) {
    if (f.no !== 1 || !(f.v instanceof Uint8Array)) continue
    const m = readFields(f.v)
    const title = text(m.find((x) => x.no === 3)?.v ?? new Uint8Array()).trim()
    if (!title) continue
    const fav = m.find((x) => x.no === 100)
    const catRefs = ints(m, 17)
    const categories = catRefs
      .map((ref) => (cats.find((c) => c.id !== 0n && c.id === ref) ?? cats.find((c) => c.order === ref))?.name)
      .filter((n): n is string => !!n)
    const chapters: MihonChapter[] = []
    for (const cf of m) {
      if (cf.no !== 16 || !(cf.v instanceof Uint8Array)) continue
      const c = readFields(cf.v)
      const num = c.find((x) => x.no === 9)?.v
      chapters.push({
        name: text(c.find((x) => x.no === 2)?.v ?? new Uint8Array()),
        read: int(c.find((x) => x.no === 4)?.v ?? 0n) === 1n,
        number: typeof num === 'number' ? Math.round(num * 100) / 100 : -1
      })
    }
    let lastReadAt = 0
    for (const hf of m) {
      if (hf.no !== 104 || !(hf.v instanceof Uint8Array)) continue
      const t = Number(int(readFields(hf.v).find((x) => x.no === 2)?.v ?? 0n))
      if (t > lastReadAt) lastReadAt = t
    }
    manga.push({
      title,
      url: text(m.find((x) => x.no === 2)?.v ?? new Uint8Array()),
      sourceName: sources.get(int(m.find((x) => x.no === 1)?.v ?? 0n)) ?? '',
      favorite: fav ? int(fav.v) === 1n : true,
      categories,
      chapters,
      lastReadAt
    })
  }
  return { manga, categories: cats.map((c) => c.name) }
}

export type Shelf = 'reading' | 'plan' | 'finished' | 'dropped'

/** Which Yomi shelf a Mihon category name means (anything else is Reading). */
export function shelfFor(categories: string[]): Shelf {
  const all = categories.join(' ').toLowerCase()
  if (/drop|abandon|متروك|توقفت/.test(all)) return 'dropped'
  if (/plan|later|to.?read|backlog|wish|سأقرأ|لاحق/.test(all)) return 'plan'
  if (/complet|finish|done|read all|مكتمل|انتهيت/.test(all)) return 'finished'
  return 'reading'
}

/** The chapter numbers marked read in Mihon. */
export function readNumbers(m: MihonManga): Set<number> {
  return new Set(m.chapters.filter((c) => c.read && c.number >= 0).map((c) => c.number))
}
