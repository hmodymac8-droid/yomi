import { session } from 'electron'
import { ensureSession, grabChapter, grabChapterLight, refererHints, type GrabResult } from './grabber'
import { fetchHtml } from './http'
import { parseChapterImages } from './staticParse'
import { getMode, setMode } from './hostmode'

const TTL = 20 * 60 * 1000
const cache = new Map<string, { at: number; res: GrabResult }>()
const inflight = new Map<string, Promise<GrabResult>>()

const usable = (r: GrabResult | null): r is GrabResult => !!r && r.pages.length >= 2

async function viaHttp(url: string): Promise<GrabResult | null> {
  try {
    const r = await fetchHtml(url)
    if (r.status !== 200) return null
    const p = parseChapterImages(r.html, url)
    return { url, title: p.title, pages: p.pages }
  } catch {
    return null
  }
}

async function viaLight(url: string): Promise<GrabResult | null> {
  try {
    return await grabChapterLight(url)
  } catch {
    return null
  }
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(b)
  const overlap = a.filter((u) => set.has(u)).length
  const ratio = a.length / b.length
  return overlap >= 0.9 * Math.min(a.length, b.length) && ratio >= 0.9 && ratio <= 1.1
}

/**
 * Is a fast result trustworthy compared with the slow full-browser result? The full browser can MISS
 * lazy-loaded pages but doesn't invent them, so a fast result may have more pages than it, never far fewer.
 */
function agreesWithFull(fast: GrabResult | null, full: GrabResult): boolean {
  if (!usable(fast)) return false
  const set = new Set(fast.pages)
  const overlap = full.pages.filter((u) => set.has(u)).length
  return fast.pages.length >= 0.8 * full.pages.length && overlap >= 0.9 * full.pages.length
}

/**
 * Three ways to get a chapter's page list, fastest first:
 *   static  plain HTTP + HTML parsing            (no browser at all)
 *   light   hidden browser without images        (for sites that build the list with JavaScript)
 *   browser hidden browser loading every image   (last resort: slow, and lazy pages can be missed)
 * Per site we remember the fastest one that agreed with the others.
 */
async function grab(url: string): Promise<GrabResult> {
  const key = new URL(url).hostname + '|chapter'
  const mode = getMode(key)

  if (mode === 'static') {
    const s = await viaHttp(url)
    if (usable(s)) return s
  }
  if (mode === 'static' || mode === 'light') {
    const l = await viaLight(url)
    if (usable(l)) return l
  }
  if (mode === 'browser') return grabChapter(url)

  if (mode === undefined) {
    // First chapter opened on this site. Run all three ways side by side. The full browser is slow, so when
    // the fast ways agree on a healthy-looking list we show it right away and let the check finish in the
    // background; if it later shows the fast list was incomplete, that site is switched to the browser.
    const fullP = grabChapter(url).catch(() => null)
    const sP = viaHttp(url)
    const lP = viaLight(url)
    const healthy = (r: GrabResult | null): r is GrabResult => usable(r) && r.pages.length >= 3

    const verify = async (): Promise<GrabResult | null> => {
      const [s, l, full] = await Promise.all([sP, lP, fullP])
      if (!full || full.pages.length < 2) {
        // nothing to compare with: trust the fast ways only if they agree with each other
        if (usable(s) && usable(l) && sameList(s.pages, l.pages)) setMode(key, 'static')
        else if (usable(l)) setMode(key, 'light')
        return full
      }
      const mode: 'static' | 'light' | 'browser' = agreesWithFull(s, full)
        ? 'static'
        : agreesWithFull(l, full)
          ? 'light'
          : 'browser'
      setMode(key, mode)
      if (mode === 'browser') cache.delete(url) // whatever we showed from the fast ways was incomplete
      return full
    }

    // Answer as soon as the cheapest healthy result is in; the slower checks carry on in the background.
    const s = await sP
    if (healthy(s)) {
      track(verify())
      return s
    }
    const l = await lP
    if (healthy(l)) {
      track(verify())
      return l
    }
    const full = await verify()
    if (full && full.pages.length >= 2) return full
    if (usable(s)) return s
    if (usable(l)) return l
    return full ?? { url, title: '', pages: [] }
  }
  return grabChapter(url)
}

// Background site checks still running (the dev smoke tests wait for these before quitting).
const pending = new Set<Promise<unknown>>()
function track(p: Promise<unknown>): void {
  pending.add(p)
  void p.finally(() => pending.delete(p))
}
export const settleVerifications = (): Promise<unknown> => Promise.allSettled([...pending])

/**
 * Some readers show ONE page per screen (…/read/<series>/<chapter>/1, /2...) and only that page's image is in the
 * address you can read. The images themselves are numbered (…/001, …/002), so once one numbered image is known the
 * next ones are asked for (a quick HEAD request each, a few at a time) until the site says there are no more.
 */
const NUMBERED = /^(.*\/)(\d{1,4})((?:\.[a-z0-9]{2,4})?\??[^/]*)$/i

async function exists(url: string, referer: string): Promise<boolean> {
  const ses = session.fromPartition('persist:sources')
  ensureSession()
  refererHints.set(url, referer)
  try {
    const r = await ses.fetch(url, { method: 'HEAD' })
    const type = (r.headers.get('content-type') ?? '').toLowerCase()
    return r.status === 200 && type.startsWith('image/')
  } catch {
    return false
  } finally {
    refererHints.delete(url)
  }
}

async function extendSequence(res: GrabResult): Promise<GrabResult> {
  const numbered = res.pages.filter((u) => NUMBERED.test(u))
  if (numbered.length !== 1 || res.pages.length > 4) return res // already a real list (or nothing to follow)
  const m = numbered[0].match(NUMBERED)!
  const [, head, digits, tail] = m
  const referer = new URL(res.url).origin + '/'
  const start = Number(digits)
  const make = (n: number): string => head + String(n).padStart(digits.length, '0') + tail
  const found: string[] = [numbered[0]]
  const BATCH = 6
  for (let n = start + 1; n < start + 400; n += BATCH) {
    const batch = Array.from({ length: BATCH }, (_, i) => n + i)
    const ok = await Promise.all(batch.map((x) => exists(make(x), referer)))
    let stop = false
    for (let i = 0; i < batch.length; i++) {
      if (!ok[i]) {
        stop = true
        break
      }
      found.push(make(batch[i]))
    }
    if (stop) break
  }
  if (found.length < 2) return res
  return { ...res, pages: found }
}

/** Page list for a chapter: memory cache -> fastest verified method for the site. */
export function grabChapterFast(url: string): Promise<GrabResult> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.res)
  const running = inflight.get(url)
  if (running) return running
  const p = grab(url)
    .then((res) => extendSequence(res).catch(() => res))
    .then((res) => {
      if (res.pages.length > 0) cache.set(url, { at: Date.now(), res })
      return res
    })
    .finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}

/** Warms the cache for a chapter the reader is likely to open next. Returns its first page URLs. */
export async function prefetchChapter(url: string): Promise<string[]> {
  try {
    return (await grabChapterFast(url)).pages.slice(0, 3)
  } catch {
    return []
  }
}
