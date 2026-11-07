import { app, session } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { readdir, rm, writeFile } from 'fs/promises'
import { readFile } from 'fs/promises'
import type { SeriesDetail } from '../preload/index.d'
import type { DownloadItem, DownloadRequest } from '../preload/index.d'
import { grabChapterFast } from './fastgrab'
import { ensureSession, refererHints } from './grabber'

export const downloadsRoot = (): string => join(app.getPath('userData'), 'downloads')
const indexFile = (): string => join(app.getPath('userData'), 'downloads.json')

let items: Record<string, DownloadItem> | null = null
let saveTimer: NodeJS.Timeout | undefined
let emitter: (item: DownloadItem) => void = () => {}
const cancelled = new Set<string>()
const active = new Set<string>() // chapters being downloaded right now

// How many chapters download at the same time (you choose it on the Downloads screen). Saved in download-settings.json.
const settingsFile = (): string => join(app.getPath('userData'), 'download-settings.json')
let concurrency: number | null = null

let paused = false // the queue is on hold: nothing new starts, and running chapters go back to the queue
let offline = false // offline mode: only downloaded chapters are used, the network is left alone

function loadSettings(): void {
  if (concurrency !== null) return
  let n = 3
  try {
    if (existsSync(settingsFile())) {
      const j = JSON.parse(readFileSync(settingsFile(), 'utf8'))
      n = Number(j.concurrency)
      paused = !!j.paused
      offline = !!j.offline
    }
  } catch {
    /* defaults */
  }
  concurrency = Number.isFinite(n) ? Math.max(1, Math.min(8, Math.round(n))) : 3
}

function saveSettings(): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify({ concurrency, paused, offline }))
  } catch {
    /* not critical */
  }
}

export function getConcurrency(): number {
  loadSettings()
  return concurrency!
}

export function setConcurrency(n: number): number {
  loadSettings()
  concurrency = Math.max(1, Math.min(8, Math.round(Number(n) || 1)))
  saveSettings()
  void pump() // a higher number starts more chapters right away
  return concurrency
}

export function isPaused(): boolean {
  loadSettings()
  return paused
}

/** Hold or release the whole queue. Holding sends the chapters being downloaded back to the queue (they restart on resume). */
export function setPaused(on: boolean): boolean {
  loadSettings()
  paused = on
  saveSettings()
  if (!on) void pump()
  return paused
}

export function isOffline(): boolean {
  loadSettings()
  return offline
}

export function setOffline(on: boolean): boolean {
  loadSettings()
  offline = on
  saveSettings()
  return offline
}

/** A series' page built only from what is saved on this computer (offline mode, or when the site cannot be reached). */
export function offlineSeries(seriesUrl: string): SeriesDetail | null {
  const mine = Object.values(load()).filter((i) => i.seriesUrl === seriesUrl && i.status === 'done')
  if (mine.length === 0) return null
  const num = (t: string): number => Number(t.match(/(\d+(?:\.\d+)?)/)?.[1] ?? -1)
  mine.sort((a, b) => num(b.chapterTitle) - num(a.chapterTitle) || b.queuedAt - a.queuedAt)
  return {
    url: seriesUrl,
    title: mine[0].seriesTitle,
    cover: '',
    description: 'Offline: only the chapters saved on this computer are shown.',
    chapters: mine.map((i) => ({ title: i.chapterTitle, url: i.id }))
  }
}

// ---- CBZ export ---------------------------------------------------------------------------------------------------
// A .cbz is a zip of the page images (stored, not compressed: they are already compressed pictures).

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zipStore(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, e.data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x0800, 8)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(e.data.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + e.data.length
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

const safeName = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'chapter'

/** Writes one .cbz per finished chapter into the folder. Returns how many were written and the folder's files. */
export async function exportCbz(ids: string[], folder: string): Promise<{ written: number; skipped: number }> {
  const all = load()
  let written = 0
  let skipped = 0
  for (const id of ids) {
    const i = all[id]
    if (!i || i.status !== 'done' || i.files.length === 0) {
      skipped++
      continue
    }
    try {
      const dir = join(downloadsRoot(), i.dir)
      const present = new Set(await readdir(dir))
      const entries: { name: string; data: Buffer }[] = []
      for (const f of i.files) if (f && present.has(f)) entries.push({ name: f, data: await readFile(join(dir, f)) })
      if (entries.length === 0) {
        skipped++
        continue
      }
      let out = join(folder, safeName(i.seriesTitle + ' - ' + i.chapterTitle) + '.cbz')
      for (let n = 2; existsSync(out); n++) out = join(folder, safeName(i.seriesTitle + ' - ' + i.chapterTitle) + ' (' + n + ').cbz')
      await writeFile(out, zipStore(entries))
      written++
    } catch {
      skipped++
    }
    await new Promise((r) => setImmediate(r)) // let the app breathe between chapters
  }
  return { written, skipped }
}

export function setDownloadEmitter(fn: (item: DownloadItem) => void): void {
  emitter = fn
}

function load(): Record<string, DownloadItem> {
  if (items) return items
  try {
    if (existsSync(indexFile())) items = JSON.parse(readFileSync(indexFile(), 'utf8'))
  } catch {
    items = null
  }
  items ??= {}
  // Anything that was mid-download when the app closed goes back in the queue.
  for (const i of Object.values(items)) if (i.status === 'downloading') i.status = 'queued'
  return items
}

function saveSoon(immediate = false): void {
  if (saveTimer) clearTimeout(saveTimer)
  const write = (): void => {
    try {
      writeFileSync(indexFile(), JSON.stringify(load()))
    } catch (e) {
      console.error('downloads save failed', e)
    }
  }
  if (immediate) write()
  else saveTimer = setTimeout(write, 800)
}

export function flushDownloads(): void {
  if (items) saveSoon(true)
}

function update(item: DownloadItem, patch: Partial<DownloadItem>): void {
  Object.assign(item, patch)
  saveSoon()
  emitter({ ...item })
}

export function listDownloads(): DownloadItem[] {
  return Object.values(load()).sort((a, b) => a.queuedAt - b.queuedAt)
}

export function getDownload(chapterUrl: string): DownloadItem | null {
  const i = load()[chapterUrl]
  return i && i.status === 'done' ? i : null
}

export function enqueueDownloads(reqs: DownloadRequest[]): void {
  const all = load()
  const now = Date.now()
  reqs.forEach((r, n) => {
    const old = all[r.chapterUrl]
    if (old && (old.status === 'done' || old.status === 'queued' || old.status === 'downloading')) return
    const dir = createHash('sha1').update(r.chapterUrl).digest('hex').slice(0, 16)
    const item: DownloadItem = {
      id: r.chapterUrl,
      seriesUrl: r.seriesUrl,
      seriesTitle: r.seriesTitle,
      sourceId: r.sourceId,
      referer: r.referer,
      chapterTitle: r.chapterTitle,
      urls: [r.chapterUrl, ...(r.alts ?? [])],
      dir,
      status: 'queued',
      done: 0,
      total: 0,
      files: [],
      bytes: 0,
      queuedAt: now + n // keeps the order the caller gave
    }
    if (!active.has(r.chapterUrl)) cancelled.delete(r.chapterUrl) // a leftover flag must not cancel a fresh download
    all[r.chapterUrl] = item
    emitter({ ...item })
  })
  saveSoon()
  void pump()
}

export function cancelDownload(id: string): void {
  const i = load()[id]
  if (!i) return
  if (i.status === 'queued') update(i, { status: 'error', error: 'Cancelled' })
  else if (i.status === 'downloading') cancelled.add(id)
}

export function removeDownload(id: string): void {
  const all = load()
  const i = all[id]
  if (!i) return
  if (active.has(id)) cancelled.add(id)
  try {
    rmSync(join(downloadsRoot(), i.dir), { recursive: true, force: true })
  } catch {
    /* already gone */
  }
  delete all[id]
  saveSoon(true)
  emitter({ ...i, status: 'removed' })
}

/** Starts queued chapters until as many are running as you allowed; each one starts the next when it ends. */
/**
 * Deletes many downloads at once without freezing the app: they leave the saved list in one step (one file write, no
 * per-item messages), then their folders are removed in the background, a few at a time, without blocking anything.
 */
export async function removeDownloads(ids: string[]): Promise<void> {
  const all = load()
  const dirs: string[] = []
  for (const id of ids) {
    const i = all[id]
    if (!i) continue
    if (active.has(id)) cancelled.add(id) // a running download stops itself (and clears this flag when it ends)
    dirs.push(join(downloadsRoot(), i.dir))
    delete all[id]
  }
  saveSoon(true)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const d = dirs[next++]
      if (d === undefined) return
      try {
        await rm(d, { recursive: true, force: true })
      } catch {
        /* already gone */
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
}

async function pump(): Promise<void> {
  for (;;) {
    if (isPaused() || active.size >= getConcurrency()) return
    const next = listDownloads().find((i) => i.status === 'queued' && !active.has(i.id))
    if (!next) return
    active.add(next.id)
    void run(next).finally(() => {
      active.delete(next.id)
      setTimeout(() => void pump(), 250)
    })
  }
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
}

async function fetchImage(url: string, referer: string): Promise<{ buf: Buffer; ext: string }> {
  const ses = session.fromPartition('persist:sources')
  // Electron refuses a hand-set Referer header (ERR_BLOCKED_BY_CLIENT); the header hook in grabber.ts adds it from this table.
  ensureSession()
  if (referer) refererHints.set(url, referer)
  let res: Response
  try {
    res = await ses.fetch(url)
  } finally {
    refererHints.delete(url)
  }
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type && !type.startsWith('image/') && !type.includes('octet-stream')) throw new Error('not an image: ' + type)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 500) throw new Error('image too small')
  const fromUrl = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1] ?? 'jpg').toLowerCase()
  return { buf, ext: EXT[type] ?? fromUrl.replace('jpeg', 'jpg') }
}

async function run(item: DownloadItem): Promise<void> {
  update(item, { status: 'downloading', error: undefined, done: 0, files: [], bytes: 0 })
  const dir = join(downloadsRoot(), item.dir)
  try {
    // 1) find the page image URLs (main link first, then the other providers' links)
    let pages: string[] = []
    let lastErr = 'No pages found for this chapter.'
    for (const u of item.urls) {
      try {
        pages = (await grabChapterFast(u)).pages
        if (pages.length > 0) {
          // the page list may come from a provider page: use its host as the Referer
          break
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    if (pages.length === 0) throw new Error(lastErr)
    if (cancelled.has(item.id) || paused) throw new Error(paused && !cancelled.has(item.id) ? 'Paused' : 'Cancelled')

    mkdirSync(dir, { recursive: true })
    update(item, { total: pages.length })

    // 2) download pages, 3 at a time, each with up to 3 tries
    const files: string[] = new Array(pages.length)
    let next = 0
    let failed = 0
    let lastImgErr = ''
    const worker = async (): Promise<void> => {
      for (;;) {
        const idx = next++
        if (idx >= pages.length || cancelled.has(item.id) || paused) return
        let ok = false
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const { buf, ext } = await fetchImage(pages[idx], item.referer)
            const name = String(idx + 1).padStart(3, '0') + '.' + ext
            await writeFile(join(dir, name), buf)
            files[idx] = name
            item.bytes += buf.length
            ok = true
          } catch (e) {
            lastImgErr = e instanceof Error ? e.message : String(e)
            await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
          }
        }
        if (!ok) failed++
        update(item, { done: item.done + 1 })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (cancelled.has(item.id)) throw new Error('Cancelled')
    if (paused) throw new Error('Paused')
    if (failed > 0) throw new Error(`${failed} of ${pages.length} pages failed to download (${lastImgErr})`)
    update(item, { status: 'done', files, done: pages.length })
  } catch (e) {
    if (!load()[item.id]) return // removed while running
    if (e instanceof Error && e.message === 'Paused') {
      update(item, { status: 'queued', done: 0, total: 0, files: [], bytes: 0, error: undefined }) // waits in the queue until you resume
      return
    }
    update(item, { status: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    cancelled.delete(item.id)
    saveSoon(true)
  }
}

export function resumeDownloads(): void {
  if (listDownloads().some((i) => i.status === 'queued')) void pump()
}
