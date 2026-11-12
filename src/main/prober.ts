import { relocateSource, sourceDefs, updateSource } from './catalog'
import { isOffline, rewriteDownloadHost } from './downloads'
import { reconcileRepair } from './fallback'
import { fetchHtml } from './http'
import { peekOutage, writeOutage } from './health'
import { rewriteProgressHost } from './progress'
import {
  interpretResponse,
  isBlockedSource,
  runProbePass,
  writeSourceStatus,
  type ProbeTarget,
  type ProbeVerdict
} from './repair'
import { rewriteFollowHost } from './updates'

/**
 * Quietly retries sources that were taken out of rotation. One cheap request to the original address,
 * a few sites per minute, with the per-site backoff from repair.ts. It does not run detectSource:
 * that opens hidden browser windows and can ask you to pass a human check. A new domain is adopted
 * only when that address has already answered (a redirect, or a host a chapter was served from).
 */

const GAP_MS = 15_000
const MAX_PER_PASS = 3
let started = false
let running = false

async function probeUrl(url: string): Promise<ProbeVerdict> {
  try {
    const r = await fetchHtml(url, 8000)
    return interpretResponse({ status: r.status, html: r.html, finalUrl: r.finalUrl }, url, 'home')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return interpretResponse({ status: 0, html: '', finalUrl: url, error: message }, url, 'home')
  }
}

async function pass(busy: (id: string) => boolean): Promise<void> {
  if (running || isOffline()) return
  running = true
  try {
    const targets: ProbeTarget[] = sourceDefs()
      .filter((s) => !busy(s.id) && !isBlockedSource(s.id, s.baseUrl))
      .map((s) => ({ id: s.id, baseUrl: s.baseUrl, state: peekOutage(s.id) }))
    const results = await runProbePass({
      targets,
      now: Date.now(),
      random: Math.random,
      probe: probeUrl,
      max: MAX_PER_PASS,
      gapMs: GAP_MS,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    })
    for (const r of results) {
      if (r.action === 'relocated' && r.movedTo) {
        const moved = relocateSource(r.id, r.movedTo)
        if (moved) {
          rewriteProgressHost(moved.oldHost, r.movedTo)
          rewriteFollowHost(moved.oldHost, r.movedTo)
          rewriteDownloadHost(moved.oldHost, r.movedTo)
        } else {
          updateSource(r.id, (src) => writeSourceStatus(src, 'ok', Date.now()))
        }
        writeOutage(r.id, r.state)
        continue
      }
      writeOutage(r.id, r.state)
      updateSource(r.id, (src) =>
        writeSourceStatus(
          src,
          r.state.availability,
          r.state.failedAt ?? Date.now(),
          r.action === 'restored' ? undefined : r.state.reason
        )
      )
    }
  } catch (e) {
    console.log('probe failed', e instanceof Error ? e.message : String(e))
  } finally {
    running = false
  }
}

export function startSourceProber(busy: (id: string) => boolean): void {
  if (started) return
  started = true
  try {
    reconcileRepair()
  } catch (e) {
    console.log('repair reconcile failed', e instanceof Error ? e.message : String(e))
  }
  // After the window is up, then about once a minute. Each pass probes at most a few sites.
  const tick = (): void => void pass(busy)
  setTimeout(tick, 45_000).unref?.()
  setInterval(tick, 60_000)
}
