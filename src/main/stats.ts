import { app } from 'electron'
import { join } from 'path'
import type { ReadingStats } from '../preload/index.d'
import { seriesMeta } from './catalog'
import { readJson, writeAtomic } from './safefile'
import { dayKey, summarize, type StatsData } from './statsLogic'

/*
 * Reading stats: each chapter you finish (the first time) and the time the reader is open and in use, by day.
 * Saved in reading-stats.json; nothing leaves the computer.
 */

const file = (): string => join(app.getPath('userData'), 'reading-stats.json')
let data: StatsData | null = null
let timer: NodeJS.Timeout | undefined

function load(): StatsData {
  if (!data) {
    const d = readJson<StatsData>(file(), 4)
    data = { days: d?.days ?? {}, finished: d?.finished ?? [] }
  }
  return data
}

export function flushStats(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  if (!data) return
  try {
    writeAtomic(file(), JSON.stringify(data))
  } catch {
    /* the next save tries again */
  }
}
function saveSoon(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushStats, 2000)
}

/** A chapter was finished for the first time. */
export function statChapter(c: { seriesUrl: string; title: string; chapterTitle: string }): void {
  const d = load()
  const k = dayKey(Date.now())
  const day = (d.days[k] ??= { chapters: 0, ms: 0 })
  day.chapters++
  d.finished.push({
    at: Date.now(),
    seriesUrl: c.seriesUrl,
    title: c.title,
    chapter: c.chapterTitle
  })
  if (d.finished.length > 20000) d.finished = d.finished.slice(-20000)
  saveSoon()
}

/** Time spent reading (the reader sends this while it is open and you are using it). */
export function statTime(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return
  const d = load()
  const k = dayKey(Date.now())
  const day = (d.days[k] ??= { chapters: 0, ms: 0 })
  day.ms += Math.min(ms, 120000) // one report covers at most two minutes
  saveSoon()
}

export function readingStats(): ReadingStats {
  return summarize(load(), Date.now(), (url) => seriesMeta(url)?.genres ?? [])
}
