import { app, BrowserWindow, Notification, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'
import type {
  DownloadRequest,
  FollowCategory,
  FollowInfo,
  FollowMeta,
  FollowRecord,
  NewChapter,
  UpdateStatus
} from '../preload/index.d'
import { getSeries, getSeriesCached, getSource, mergeNewest, openSeries } from './catalog'
import { enqueueDownloads } from './downloads'
import { getProgress, recentProgress } from './progress'
import { isUnreadable, readJson, writeAtomic } from './safefile'
import { mapHost } from './repair'
import { coverBytes } from './imageProxy'
import { dropOtherSeries } from './chapterText'

const ICON_W = 192

/**
 * The series cover, small, for its new-chapter notice. JPEG and PNG are read directly; other kinds (WebP, AVIF) are
 * turned into a PNG by one of Yomi's windows, whose browser engine reads them. Null means the notice shows no picture.
 */
async function noticeIcon(cover: string, referer: string): Promise<NativeImage | null> {
  try {
    const got = await coverBytes(cover, referer || undefined)
    if (!got) return null
    let img = nativeImage.createFromBuffer(got.buf)
    if (img.isEmpty()) {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
      if (!w) return null
      const png = await w.webContents.executeJavaScript(
        `(async () => {
          const raw = atob(${JSON.stringify(got.buf.toString('base64'))})
          const bytes = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
          const bm = await createImageBitmap(new Blob([bytes], { type: ${JSON.stringify(got.type)} }))
          const w = Math.min(${ICON_W}, bm.width), h = Math.max(1, Math.round((bm.height * w) / bm.width))
          const c = new OffscreenCanvas(w, h)
          c.getContext('2d').drawImage(bm, 0, 0, w, h)
          const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
          let s = ''
          for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192))
          return btoa(s)
        })()`
      )
      if (typeof png !== 'string') return null
      img = nativeImage.createFromBuffer(Buffer.from(png, 'base64'))
    }
    if (img.isEmpty()) return null
    return img.getSize().width > ICON_W ? img.resize({ width: ICON_W, quality: 'good' }) : img
  } catch {
    return null
  }
}

interface State {
  follows: Record<string, FollowRecord>
  autoDownload: boolean
  lastChecked: number
}

let state: State | null = null
let saveTimer: NodeJS.Timeout | undefined
let checking = false
let schedulerStarted = false

const file = (): string => join(app.getPath('userData'), 'updates.json')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function load(): State {
  if (state && !isUnreadable(file())) return state
  state = readJson<State>(file(), state ? 1 : 8) ?? state
  state ??= { follows: {}, autoDownload: true, lastChecked: 0 }
  // "New chapters" that were really other series' chapters from the site's sidebar: drop them, and forget what was
  // learned from that sidebar so the next check takes a fresh look (a first look never reports anything as new).
  for (const rec of Object.values(state.follows)) {
    const kept = dropOtherSeries(rec.newChapters, rec.seriesUrl)
    if (kept.length === rec.newChapters.length) continue
    rec.newChapters = kept
    rec.known = []
    saveSoon()
  }
  return state
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushUpdates, 1000)
}

export function flushUpdates(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  if (!state) return
  try {
    writeAtomic(file(), JSON.stringify(state))
  } catch (e) {
    console.error('updates save failed', e)
  }
}

/** Identity of a chapter that survives the site switching which provider link is listed first. */
const keyOf = (c: { title: string; url: string }): string =>
  c.title.toLowerCase().replace(/\s+/g, ' ').trim() || c.url

export function updateStatus(): UpdateStatus {
  const s = load()
  return {
    checking,
    lastChecked: s.lastChecked,
    autoDownload: s.autoDownload,
    following: Object.values(s.follows).filter((f) => f.following).length
  }
}

function emit(): void {
  const status = updateStatus()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updates-changed', status)
}

/** New chapters you haven't read yet. */
function unreadOf(rec: FollowRecord): NewChapter[] {
  const read = new Set(getProgress(rec.seriesUrl)?.read ?? [])
  return rec.newChapters.filter((c) => ![c.url, ...(c.alts ?? [])].some((u) => read.has(u)))
}

function toInfo(rec: FollowRecord): FollowInfo {
  const { known: _known, ...rest } = rec
  const unreadChapters = unreadOf(rec)
  return { ...rest, unread: unreadChapters.length, unreadChapters }
}

/** Follow a source onto a new host so Following still matches the series. */
export function rewriteFollowHost(oldHost: string, newOrigin: string): void {
  const s = load()
  const next: Record<string, FollowRecord> = {}
  let changed = false
  for (const rec of Object.values(s.follows)) {
    const seriesUrl = mapHost(rec.seriesUrl, oldHost, newOrigin)
    if (seriesUrl !== rec.seriesUrl) changed = true
    next[seriesUrl] = {
      ...rec,
      seriesUrl,
      coverReferer: mapHost(rec.coverReferer, oldHost, newOrigin),
      newChapters: rec.newChapters.map((c) => ({
        ...c,
        url: mapHost(c.url, oldHost, newOrigin),
        alts: c.alts?.map((u) => mapHost(u, oldHost, newOrigin))
      }))
    }
  }
  if (!changed) return
  s.follows = next
  saveSoon()
  emit()
}

export function listFollows(): FollowInfo[] {
  return Object.values(load().follows)
    .filter((f) => f.following)
    .map(toInfo)
    .sort((a, b) => b.unread - a.unread || b.lastChecked - a.lastChecked)
}

export function getFollow(seriesUrl: string): FollowInfo | null {
  const rec = load().follows[seriesUrl]
  return rec ? toInfo(rec) : null
}

function baselineFromCache(rec: FollowRecord): void {
  // The chapter list you've been looking at is the baseline: chapters in it are not "new".
  if (rec.known.length > 0) return
  const cached = getSeriesCached(rec.seriesUrl)
  if (cached) rec.known = cached.chapters.map(keyOf)
}

export function setFollow(meta: FollowMeta, following: boolean): void {
  const s = load()
  const rec: FollowRecord = s.follows[meta.seriesUrl] ?? {
    ...meta,
    following,
    known: [],
    newChapters: [],
    lastChecked: 0
  }
  Object.assign(rec, meta, { following })
  if (following) baselineFromCache(rec)
  else rec.newChapters = []
  s.follows[meta.seriesUrl] = rec
  saveSoon()
  emit()
}

/** Reading a series follows it, unless you unfollowed it before (the record stays so it isn't re-followed). */
export function autoFollow(meta: FollowMeta): void {
  if (load().follows[meta.seriesUrl]) return
  setFollow(meta, true)
}

export function setCategory(seriesUrl: string, category: FollowCategory): void {
  const rec = load().follows[seriesUrl]
  if (!rec) return
  rec.category = category
  if (category === 'finished' || category === 'dropped') rec.newChapters = [] // nothing to tell you about any more
  saveSoon()
  emit()
}

export function dismissNew(seriesUrl: string): void {
  const rec = load().follows[seriesUrl]
  if (!rec) return
  rec.newChapters = []
  saveSoon()
  emit()
}

export function setAutoDownload(on: boolean): void {
  load().autoDownload = on
  saveSoon()
  emit()
}

/** Auto-download for one series: on, off, or undefined to follow the Settings switch. */
export function setSeriesAutoDownload(seriesUrl: string, on: boolean | undefined): void {
  const rec = load().follows[seriesUrl]
  if (!rec) return
  if (on === undefined) delete rec.autoDownload
  else rec.autoDownload = on
  saveSoon()
  emit()
}

async function notify(found: { rec: FollowRecord; fresh: NewChapter[] }[]): Promise<void> {
  if (found.length === 0 || !Notification.isSupported()) return
  const show = (title: string, body: string, icon?: NativeImage | null): void => {
    const n = new Notification(icon ? { title, body, icon } : { title, body })
    n.on('click', () => {
      const w =
        BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible()) ??
        BrowserWindow.getAllWindows()[0]
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
    })
    n.show()
  }
  if (found.length <= 4) {
    // each notice shows the series' cover (fetched side by side; a cover that can't be had just isn't shown)
    const icons = await Promise.all(found.map(({ rec }) => noticeIcon(rec.cover, rec.coverReferer)))
    found.forEach(({ rec, fresh }, i) =>
      show(
        rec.title,
        fresh.length === 1 ? `${fresh[0].title} is out` : `${fresh.length} new chapters are out`,
        icons[i]
      )
    )
  } else {
    show('New chapters', `${found.length} series you follow have new chapters`)
  }
}

/**
 * New-chapter entries whose chapter now has another name (a site glued the chapter's age onto its number, so
 * "Chapter 48" was read as "Chapter 4819"): the newest chapter keeps its entry under the right name, an older one was
 * never new and is dropped.
 */
function retitleNew(rec: FollowRecord, chapters: { title: string; url: string }[]): void {
  if (rec.newChapters.length === 0) return
  const nameOf = new Map(chapters.map((c) => [c.url, c.title]))
  const num = (t: string): number => Number(t.match(/(\d+(?:\.\d+)?)/)?.[1] ?? NaN)
  const top = Math.max(...chapters.map((c) => num(c.title)).filter((n) => !Number.isNaN(n)))
  let changed = false
  rec.newChapters = rec.newChapters.flatMap((c) => {
    const now = nameOf.get(c.url)
    // not on the newest page any more, but numbered far past the newest chapter: a glued name like "Chapter 182120"
    if (now === undefined && top > 0 && num(c.title) > top * 10) {
      changed = true
      return []
    }
    if (now === undefined || now === c.title) return [c]
    changed = true
    return num(now) >= top ? [{ ...c, title: now }] : []
  })
  if (changed) saveSoon()
}

/** Checks every followed series for chapters that weren't there last time. */
export async function checkAll(manual: boolean): Promise<void> {
  if (checking) return
  checking = true
  emit()
  const found: { rec: FollowRecord; fresh: NewChapter[] }[] = []
  try {
    const s = load()
    // (series on your Finished or Dropped shelf are not checked: fewer requests to the sites)
    for (const rec of Object.values(s.follows).filter(
      (f) => f.following && f.category !== 'finished' && f.category !== 'dropped'
    )) {
      if (!getSource(rec.sourceId)) continue
      try {
        const d = await getSeries(rec.sourceId, rec.seriesUrl, true) // newest chapters only
        mergeNewest(rec.seriesUrl, d) // keep the saved chapter list current, so opening the series needs no load
        if (d.chapters.length === 0) continue // the page gave nothing: don't treat that as "all chapters removed"
        retitleNew(rec, d.chapters)
        // a chapter is known by its name and by its address, so a site that renames chapters doesn't make old ones new
        const keys = [...d.chapters.map(keyOf), ...d.chapters.map((c) => c.url)]
        if (rec.known.length === 0) {
          // first look at this series: what's on it counts as already known (newest page only, which is
          // enough: later checks only ever see the newest page too)
          rec.known = keys
        } else {
          const known = new Set([...rec.known, ...rec.newChapters.map((c) => c.url)])
          const fresh: NewChapter[] = d.chapters
            .filter((c) => !known.has(keyOf(c)) && !known.has(c.url))
            .map((c) => ({ title: c.title, url: c.url, alts: c.alts, at: Date.now() }))
          rec.known = [...new Set([...rec.known, ...keys])]
          // A sudden flood of "new" chapters means the site changed how it lists them, not that 50 chapters dropped.
          const flood = fresh.length > 20 && fresh.length > d.chapters.length * 0.5
          if (fresh.length > 0 && !flood) {
            const have = new Set(rec.newChapters.map((c) => keyOf(c)))
            rec.newChapters.push(...fresh.filter((c) => !have.has(keyOf(c))))
            found.push({ rec, fresh })
            // each series can have its own choice (in Following); otherwise the Settings switch decides
            if (rec.autoDownload ?? s.autoDownload) {
              const referer = new URL(rec.seriesUrl).origin + '/'
              const reqs: DownloadRequest[] = [...fresh].reverse().map((c) => ({
                chapterUrl: c.url,
                alts: c.alts,
                chapterTitle: c.title,
                seriesUrl: rec.seriesUrl,
                seriesTitle: rec.title,
                sourceId: rec.sourceId,
                referer
              }))
              enqueueDownloads(reqs) // oldest first
            }
          }
        }
        rec.lastChecked = Date.now()
      } catch {
        /* site unreachable: try again at the next check */
      }
      saveSoon()
      emit()
      await sleep(1200) // be polite to the sites
    }
  } finally {
    load().lastChecked = Date.now()
    checking = false
    saveSoon()
    emit()
  }
  if (!manual) void notify(found)
}

let preloading = false

/**
 * Reads the full chapter list, once, of the series you follow or are reading and that have no saved list yet, so they
 * open instantly. Quietly in the background: one series at a time with pauses, a few per run, and the sites that failed
 * recently are left alone for a while.
 */
const preloadFailedAt = new Map<string, number>()
export async function preloadLists(limit = 12): Promise<number> {
  if (preloading) return 0
  preloading = true
  let done = 0
  try {
    const wanted = new Map<string, string>() // series url -> source id
    for (const f of Object.values(load().follows)) {
      if (f.following && f.category !== 'finished' && f.category !== 'dropped')
        wanted.set(f.seriesUrl, f.sourceId)
    }
    for (const r of recentProgress(30))
      if (!wanted.has(r.seriesUrl)) wanted.set(r.seriesUrl, r.sourceId)
    for (const [url, sourceId] of wanted) {
      if (done >= limit) break
      if (!getSource(sourceId) || getSeriesCached(url)) continue
      if (Date.now() - (preloadFailedAt.get(url) ?? 0) < 6 * 3600_000) continue
      try {
        const d = await openSeries(sourceId, url, 'auto')
        if (d.chapters.length === 0) preloadFailedAt.set(url, Date.now())
        else done++
      } catch {
        preloadFailedAt.set(url, Date.now())
      }
      await sleep(3000) // be polite to the sites
    }
  } finally {
    preloading = false
  }
  return done
}

/** Background checks: shortly after launch, then every 30 minutes while the app is open. */
export function startUpdateScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  setTimeout(() => void checkAll(false), 45_000)
  setInterval(() => void checkAll(false), 30 * 60_000)
  if (!process.env['MR_NOPRELOAD']) {
    setTimeout(() => void preloadLists(), 120_000)
    setInterval(() => void preloadLists(), 2 * 3600_000)
  }
}

/** Dev/test helper: pretend the newest `n` chapters of a series were never seen. */
export function debugForget(seriesUrl: string, n: number): void {
  const rec = load().follows[seriesUrl]
  if (!rec) return
  // A chapter is known by its name AND its address (see checkAll), so both have to go for it to count as new again.
  const newest = (getSeriesCached(seriesUrl)?.chapters ?? []).slice(0, n)
  const drop = new Set(newest.flatMap((c) => [keyOf(c), c.url]))
  rec.known = drop.size ? rec.known.filter((k) => !drop.has(k)) : rec.known.slice(n)
}
