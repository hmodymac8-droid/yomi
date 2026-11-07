import { app, session } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import type { DownloadItem, DownloadRequest } from '../preload/index.d'
import { grabChapterFast } from './fastgrab'
import { ensureSession, refererHints } from './grabber'

export const downloadsRoot = (): string => join(app.getPath('userData'), 'downloads')
const indexFile = (): string => join(app.getPath('userData'), 'downloads.json')

let items: Record<string, DownloadItem> | null = null
let saveTimer: NodeJS.Timeout | undefined
let emitter: (item: DownloadItem) => void = () => {}
const cancelled = new Set<string>()
let running = false

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
  cancelled.add(id)
  try {
    rmSync(join(downloadsRoot(), i.dir), { recursive: true, force: true })
  } catch {
    /* already gone */
  }
  delete all[id]
  saveSoon(true)
  emitter({ ...i, status: 'removed' })
}

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (;;) {
      const next = listDownloads().find((i) => i.status === 'queued')
      if (!next) break
      await run(next)
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    running = false
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
    if (cancelled.has(item.id)) throw new Error('Cancelled')

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
        if (idx >= pages.length || cancelled.has(item.id)) return
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
    if (failed > 0) throw new Error(`${failed} of ${pages.length} pages failed to download (${lastImgErr})`)
    update(item, { status: 'done', files, done: pages.length })
  } catch (e) {
    if (!load()[item.id]) return // removed while running
    update(item, { status: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    cancelled.delete(item.id)
    saveSoon(true)
  }
}

export function resumeDownloads(): void {
  if (listDownloads().some((i) => i.status === 'queued')) void pump()
}
