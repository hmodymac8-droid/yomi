import { app, BrowserWindow, Notification } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { DownloadRequest, FollowInfo, FollowMeta, FollowRecord, NewChapter, UpdateStatus } from '../preload/index.d'
import { getSeries, getSeriesCached, getSource, mergeNewest } from './catalog'
import { enqueueDownloads } from './downloads'
import { getProgress } from './progress'

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
  if (state) return state
  try {
    if (existsSync(file())) state = JSON.parse(readFileSync(file(), 'utf8')) as State
  } catch {
    state = null
  }
  return (state ??= { follows: {}, autoDownload: true, lastChecked: 0 })
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
    writeFileSync(file(), JSON.stringify(state))
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
  const rec: FollowRecord = s.follows[meta.seriesUrl] ?? { ...meta, following, known: [], newChapters: [], lastChecked: 0 }
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

function notify(found: { rec: FollowRecord; fresh: NewChapter[] }[]): void {
  if (found.length === 0 || !Notification.isSupported()) return
  const show = (title: string, body: string): void => {
    const n = new Notification({ title, body })
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible()) ?? BrowserWindow.getAllWindows()[0]
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
    })
    n.show()
  }
  if (found.length <= 4) {
    for (const { rec, fresh } of found)
      show(rec.title, fresh.length === 1 ? `${fresh[0].title} is out` : `${fresh.length} new chapters are out`)
  } else {
    show('New chapters', `${found.length} series you follow have new chapters`)
  }
}

/** Checks every followed series for chapters that weren't there last time. */
export async function checkAll(manual: boolean): Promise<void> {
  if (checking) return
  checking = true
  emit()
  const found: { rec: FollowRecord; fresh: NewChapter[] }[] = []
  try {
    const s = load()
    for (const rec of Object.values(s.follows).filter((f) => f.following)) {
      if (!getSource(rec.sourceId)) continue
      try {
        const d = await getSeries(rec.sourceId, rec.seriesUrl, true) // newest chapters only
        mergeNewest(rec.seriesUrl, d) // keep the saved chapter list current, so opening the series needs no load
        const keys = d.chapters.map(keyOf)
        if (d.chapters.length === 0) continue // the page gave nothing: don't treat that as "all chapters removed"
        if (rec.known.length === 0) {
          // first look at this series: what's on it counts as already known (newest page only, which is
          // enough: later checks only ever see the newest page too)
          rec.known = keys
        } else {
          const known = new Set(rec.known)
          const fresh: NewChapter[] = d.chapters
            .filter((c) => !known.has(keyOf(c)))
            .map((c) => ({ title: c.title, url: c.url, alts: c.alts, at: Date.now() }))
          rec.known = [...new Set([...rec.known, ...keys])]
          // A sudden flood of "new" chapters means the site changed how it lists them, not that 50 chapters dropped.
          const flood = fresh.length > 20 && fresh.length > d.chapters.length * 0.5
          if (fresh.length > 0 && !flood) {
            const have = new Set(rec.newChapters.map((c) => keyOf(c)))
            rec.newChapters.push(...fresh.filter((c) => !have.has(keyOf(c))))
            found.push({ rec, fresh })
            if (s.autoDownload) {
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
  if (!manual) notify(found)
}

/** Background checks: shortly after launch, then every 30 minutes while the app is open. */
export function startUpdateScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  setTimeout(() => void checkAll(false), 45_000)
  setInterval(() => void checkAll(false), 30 * 60_000)
}

/** Dev/test helper: pretend the newest `n` chapters of a series were never seen. */
export function debugForget(seriesUrl: string, n: number): void {
  const rec = load().follows[seriesUrl]
  if (rec) rec.known = rec.known.slice(n)
}
