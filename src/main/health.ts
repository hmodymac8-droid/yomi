import { app } from 'electron'
import { join } from 'path'
import type { SiteHealth, HealthCheck } from '../preload/index.d'
import { isUnreadable, readJson, writeAtomic } from './safefile'
import { emptyOutage, type HealthEvent, type OutageState } from './repair'

/**
 * What we know about how each site is doing: the outcome of your last 20 series opens, the result of the
 * last "Re-check", and a short history of when the site was taken out of rotation and why. Saved in
 * site-health.json. The address and the current status also live on the source row in catalog.json.
 */
interface Entry {
  recent: ('ok' | 'incomplete' | 'failed')[]
  lastAt: number
  lastError?: string
  check?: HealthCheck
  availability?: OutageState['availability']
  failedAt?: number
  reason?: string
  history?: HealthEvent[]
  probeAttempt?: number
  nextProbeAt?: number
  candidateOrigin?: string
  speedMs?: number
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
    check: e.check,
    availability: e.availability,
    failedAt: e.failedAt,
    reason: e.reason,
    history: e.history,
    nextProbeAt: e.nextProbeAt,
    speedMs: e.speedMs
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

function toOutage(e: Entry | undefined): OutageState {
  if (!e) return emptyOutage()
  return {
    availability: e.availability ?? 'ok',
    reason: e.reason,
    failedAt: e.failedAt,
    probeAttempt: e.probeAttempt ?? 0,
    nextProbeAt: e.nextProbeAt,
    history: e.history ?? [],
    candidateOrigin: e.candidateOrigin,
    speedMs: e.speedMs
  }
}

/** The outage record without creating one (a lookup must not grow site-health.json). */
export function peekOutage(id: string): OutageState {
  return toOutage(load()[id])
}

export function writeOutage(id: string, s: OutageState): void {
  const e = entry(id)
  e.availability = s.availability === 'ok' ? undefined : s.availability
  e.failedAt = s.failedAt
  e.reason = s.reason
  e.history = s.history
  e.probeAttempt = s.probeAttempt
  e.nextProbeAt = s.nextProbeAt
  e.candidateOrigin = s.candidateOrigin
  if (s.speedMs !== undefined) e.speedMs = s.speedMs
  e.lastAt = Date.now()
  if (s.reason) e.lastError = s.reason
  saveSoon()
}

/** How long the last full re-check took. Lower is a faster site, used when picking a fallback. */
export function recordSpeed(id: string, ms: number): void {
  const e = entry(id)
  e.speedMs = ms
  saveSoon()
}

export function speedOf(id: string): number | undefined {
  return load()[id]?.speedMs
}
