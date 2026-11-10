import { session } from 'electron'
import { ensureSession } from './grabber'

/** Downloads a file as raw bytes (used for gzipped sitemaps). */
export async function fetchBuffer(
  url: string,
  timeoutMs = 30000
): Promise<{ status: number; buf: Buffer }> {
  ensureSession()
  const ses = session.fromPartition('persist:sources')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await ses.fetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'application/xml,text/xml,*/*;q=0.8' }
    })
    return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) }
  } finally {
    clearTimeout(timer)
  }
}

/** Downloads a page's HTML without a browser window, using the same session (cookies, user-agent) as the hidden browser. */
export async function fetchHtml(
  url: string,
  timeoutMs = 15000,
  method: 'GET' | 'POST' = 'GET'
): Promise<{ status: number; html: string; finalUrl: string }> {
  ensureSession()
  const ses = session.fromPartition('persist:sources')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await ses.fetch(url, {
      method,
      signal: ctl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // (Madara sites answer their chapter-list requests only when they look like the page's own)
        ...(method === 'POST' ? { 'X-Requested-With': 'XMLHttpRequest' } : {})
      }
    })
    const html = await res.text()
    return { status: res.status, html, finalUrl: res.url || url }
  } finally {
    clearTimeout(timer)
  }
}

/** Reads a JSON address (a site's data feed) with the same session as the rest of the app. */
export async function fetchJson<T>(
  url: string,
  timeoutMs = 20000
): Promise<{ status: number; data: T | null }> {
  ensureSession()
  const ses = session.fromPartition('persist:sources')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await ses.fetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'application/json' }
    })
    let data: T | null = null
    try {
      data = (await res.json()) as T
    } catch {
      /* not JSON */
    }
    return { status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}
