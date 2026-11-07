import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { ProgressPatch, ProgressRecord } from '../preload/index.d'

let data: Record<string, ProgressRecord> | null = null
let timer: NodeJS.Timeout | undefined

const file = (): string => join(app.getPath('userData'), 'progress.json')

function load(): Record<string, ProgressRecord> {
  if (data) return data
  try {
    if (existsSync(file())) data = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    data = null
  }
  return (data ??= {})
}

export function flushProgress(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  if (!data) return
  try {
    writeFileSync(file(), JSON.stringify(data))
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

export function recentProgress(limit: number): ProgressRecord[] {
  return Object.values(load())
    .filter((r) => !r.hidden)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}
