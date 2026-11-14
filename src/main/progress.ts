import { app } from 'electron'
import { join } from 'path'
import type { ProgressPatch, ProgressRecord } from '../preload/index.d'
import { isUnreadable, readJson, writeAtomic } from './safefile'
import { mapHost } from './repair'

let data: Record<string, ProgressRecord> | null = null
let timer: NodeJS.Timeout | undefined

const file = (): string => join(app.getPath('userData'), 'progress.json')

function load(): Record<string, ProgressRecord> {
  if (data && !isUnreadable(file())) return data
  data = readJson<Record<string, ProgressRecord>>(file(), data ? 1 : 8) ?? data
  return (data ??= {})
}

export function flushProgress(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  if (!data) return
  try {
    writeAtomic(file(), JSON.stringify(data))
  } catch (e) {
    console.error('progress save failed', e)
  }
}

export function getProgress(seriesUrl: string): ProgressRecord | null {
  return load()[seriesUrl] ?? null
}

export function saveProgress(p: ProgressPatch): void {
  const all = load()
  const old = all[p.seriesUrl]
  const read = new Set(old?.read ?? [])
  if (p.markRead) read.add(p.markRead)
  const { markRead: _m, ...rest } = p
  all[p.seriesUrl] = { ...rest, read: [...read], updatedAt: Date.now(), hidden: false }
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushProgress, 1000)
}

/** Take a title off "Continue reading" without losing which chapters are marked read. */
export function hideProgress(seriesUrl: string): void {
  const rec = load()[seriesUrl]
  if (!rec) return
  rec.hidden = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushProgress, 300)
}


/**
 * Apply an AniList import: add read marks and optionally move the bookmark forward.
 * Never removes an existing read url, and never creates a record without seed or an existing row.
 */
export function applyForwardProgress(
  seriesUrl: string,
  addedRead: string[],
  current?: { chapterUrl: string; chapterTitle: string; pos: number },
  seed?: { sourceId: string; title: string; cover: string; coverReferer: string }
): boolean {
  const all = load()
  let rec = all[seriesUrl]
  if (!rec) {
    if (!seed) return false
    rec = {
      seriesUrl,
      sourceId: seed.sourceId,
      title: seed.title,
      cover: seed.cover,
      coverReferer: seed.coverReferer,
      chapterUrl: current?.chapterUrl ?? '',
      chapterTitle: current?.chapterTitle ?? '',
      pos: current?.pos ?? 0,
      read: [],
      updatedAt: Date.now(),
      hidden: false
    }
    all[seriesUrl] = rec
  }
  const read = new Set(rec.read)
  let changed = false
  for (const url of addedRead) {
    if (read.has(url)) continue
    read.add(url)
    changed = true
  }
  rec.read = [...read]
  if (current && current.chapterUrl) {
    if (rec.chapterUrl !== current.chapterUrl || rec.chapterTitle !== current.chapterTitle || rec.pos !== current.pos) {
      rec.chapterUrl = current.chapterUrl
      rec.chapterTitle = current.chapterTitle
      rec.pos = current.pos
      changed = true
    }
  }
  if (!changed) return false
  rec.updatedAt = Date.now()
  rec.hidden = false
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushProgress, 300)
  return true
}

/** Follow a source onto a new host so Continue reading still finds the series. */
export function rewriteProgressHost(oldHost: string, newOrigin: string): number {
  const all = load()
  const next: Record<string, ProgressRecord> = {}
  let n = 0
  for (const rec of Object.values(all)) {
    const seriesUrl = mapHost(rec.seriesUrl, oldHost, newOrigin)
    const chapterUrl = mapHost(rec.chapterUrl, oldHost, newOrigin)
    const read = rec.read.map((u) => mapHost(u, oldHost, newOrigin))
    const coverReferer = mapHost(rec.coverReferer, oldHost, newOrigin)
    if (seriesUrl !== rec.seriesUrl || chapterUrl !== rec.chapterUrl) n++
    next[seriesUrl] = { ...rec, seriesUrl, chapterUrl, read, coverReferer }
  }
  if (n === 0) return 0
  data = next
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushProgress, 300)
  return n
}

export function recentProgress(limit: number): ProgressRecord[] {
  return Object.values(load())
    .filter((r) => !r.hidden)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}
