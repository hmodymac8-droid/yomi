import { app } from 'electron'
import { join } from 'path'
import type { SiteHealth, HealthCheck } from '../preload/index.d'
import { isUnreadable, readJson, writeAtomic } from './safefile'

/**
 * What we know about how each site is doing: the outcome of your last 20 series opens, and the result of the
 * last "Re-check" (title list, chapter list, chapter pages, an image). Saved in site-health.json.
 */
interface Entry {
  recent: ('ok' | 'incomplete' | 'failed')[]
  lastAt: number
  lastError?: string
  check?: HealthCheck
}

let data: Record<string, Entry> | null = null
let timer: NodeJS.Timeout | undefined
const file = (): string => join(app.getPath('userData'), 'site-health.json')

function load(): Record<string, Entry> {
  if (data && !isUnreadable(file())) return data
  data = readJson<Record<string, Entry>>(file(), data ? 1 : 8) ?? data
  data ??= {}
  return data
}

export function flushHealth(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  if (!data) return
  try {
    writeAtomic(file(), JSON.stringify(data))
  } catch {
    /* not critical */
  }
}

function saveSoon(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushHealth, 800)
}

function entry(id: string): Entry {
  const d = load()
  return (d[id] ??= { recent: [], lastAt: 0 })
}

/** One series was opened on this site. */
export function recordOpen(
  sourceId: string,
  outcome: 'ok' | 'incomplete' | 'failed',
  error?: string
): void {
  const e = entry(sourceId)
  e.recent = [...e.recent, outcome].slice(-20)
  e.lastAt = Date.now()
  if (outcome === 'failed' && error) e.lastError = error.slice(0, 160)
  saveSoon()
}

export function recordCheck(sourceId: string, check: HealthCheck): void {
  const e = entry(sourceId)
  e.check = check
  // a fresh Re-check starts the count over: opens from before it no longer colour the site
  e.recent = []
  saveSoon()
}

export function dropHealth(sourceId: string): void {
  delete load()[sourceId]
  saveSoon()
}

export function allHealth(): SiteHealth[] {
  return Object.entries(load()).map(([sourceId, e]) => ({
    sourceId,
    ok: e.recent.filter((r) => r === 'ok').length,
    incomplete: e.recent.filter((r) => r === 'incomplete').length,
    failed: e.recent.filter((r) => r === 'failed').length,
    lastAt: e.lastAt,
    lastError: e.lastError,
    check: e.check
  }))
}

export function healthOf(sourceId: string): SiteHealth {
  return (
    allHealth().find((h) => h.sourceId === sourceId) ?? {
      sourceId,
      ok: 0,
      incomplete: 0,
      failed: 0,
      lastAt: 0
    }
  )
}
