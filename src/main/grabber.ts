import { app, BrowserWindow, session } from 'electron'
import { pickPageGroup } from './staticParse'

const PARTITION = 'persist:sources'

const AD_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adnxs.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'exoclick.com',
  'juicyads.com',
  'adsterra.com',
  'onclickads.net',
  'taboola.com',
  'outbrain.com',
  'histats.com',
  // analytics and tracking: nothing the app needs, and they keep a page's scripts busy for seconds
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'connect.facebook.net',
  'facebook.net',
  'hotjar.com',
  'clarity.ms',
  'cloudflareinsights.com',
  'scorecardresearch.com',
  'quantserve.com',
  'mc.yandex.ru',
  'amazon-adsystem.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'a-ads.com',
  'clickadu.com',
  'hilltopads.net',
  'richpush.co',
  'monetag.com'
]

/** url -> Referer to send, for requests the app makes itself (image proxy, downloads). */
export const refererHints = new Map<string, string>()

// Data requests a page makes (XHR/fetch) that the site refused, per hidden window. Lets us tell "this series has
// no chapters" apart from "the site refused to send them" (rate limits, blocks).
const refusedRequests = new Map<number, { status: number; url: string }[]>()

// Data requests (XHR/fetch) in flight per hidden window. Pages like to fetch their chapter list a moment after
// they load, so "the page is ready" really means "its data requests have finished".
const xhrPending = new Map<number, number>()
const xhrLast = new Map<number, number>()
function xhrBump(id: number, delta: number): void {
  xhrPending.set(id, Math.max(0, (xhrPending.get(id) ?? 0) + delta))
  xhrLast.set(id, Date.now())
}

/**
 * Waits until the page has finished its data requests (none running for `quietMs`), at least ~1 s after the call
 * so that requests which start a moment after load are caught. Gives up after `maxMs`.
 */
export async function waitXhrIdle(win: BrowserWindow, quietMs = 700, maxMs = 9000, minMs = 1000): Promise<void> {
  const id = win.webContents.id
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 100))
    if (
      (xhrPending.get(id) ?? 0) === 0 &&
      Date.now() - start >= minMs &&
      Date.now() - (xhrLast.get(id) ?? 0) >= quietMs
    )
      return
  }
}

/** Requests that the site refused (status 400+) in this window so far. */
export function refusedIn(win: BrowserWindow): { status: number; url: string }[] {
  return refusedRequests.get(win.webContents.id) ?? []
}

// "Light" windows (list pages, series pages) only need the page text: skip images, video and fonts.
const lightWindows = new Set<number>()
const HEAVY = new Set(['image', 'media', 'font'])

let blockerInstalled = false
function installAdBlocker(): void {
  if (blockerInstalled) return
  blockerInstalled = true
  const ses = session.fromPartition(PARTITION)
  // Look like a normal Chrome: Electron's default user-agent trips some bot checks.
  if (process.env['MR_KEEP_UA'] !== '1') ses.setUserAgent(app.userAgentFallback.replace(/\s(?:Electron|manga-reader)\/\S+/g, ''))
  // Requests the app makes itself (image proxy, plain-HTTP page fetches, downloads) don't carry the headers a
  // real browser adds, and Cloudflare-protected image servers answer those with "Attention Required" (403).
  // Add them here. Requests made by hidden browser windows already have them (webContentsId is set).
  const major = app.userAgentFallback.match(/Chrome\/(\d+)/)?.[1] ?? '130'
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    if (details.webContentsId) return cb({ requestHeaders: details.requestHeaders }) // a browser window: already has them
    const h = details.requestHeaders
    // Image servers often only answer requests that look like they come from the site's own pages.
    // (A Referer set through fetch() options is blocked by Electron, so callers register it here instead.)
    const hint = refererHints.get(details.url)
    if (hint) h['Referer'] = hint
    const accept = h['Accept'] ?? ''
    const isHtml = accept.includes('text/html')
    if (!accept || accept === '*/*') {
      h['Accept'] = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      h['Sec-Fetch-Dest'] = 'image'
      h['Sec-Fetch-Mode'] = 'no-cors'
      h['Sec-Fetch-Site'] = 'cross-site'
    } else if (isHtml) {
      h['Sec-Fetch-Dest'] = 'document'
      h['Sec-Fetch-Mode'] = 'navigate'
      h['Sec-Fetch-Site'] = 'none'
      h['Upgrade-Insecure-Requests'] = '1'
    }
    h['Accept-Language'] ??= 'en-US,en;q=0.9'
    h['sec-ch-ua'] = `"Chromium";v="${major}", "Not_A Brand";v="24", "Google Chrome";v="${major}"`
    h['sec-ch-ua-mobile'] = '?0'
    h['sec-ch-ua-platform'] = '"Windows"'
    cb({ requestHeaders: h })
  })
  ses.webRequest.onErrorOccurred((d) => {
    if (d.webContentsId && d.resourceType === 'xhr') xhrBump(d.webContentsId, -1)
  })
  ses.webRequest.onCompleted((d) => {
    if (d.webContentsId && d.resourceType === 'xhr') xhrBump(d.webContentsId, -1)
    if (!d.webContentsId || d.resourceType !== 'xhr' || d.statusCode < 400) return
    const list = refusedRequests.get(d.webContentsId) ?? []
    if (list.length < 20) list.push({ status: d.statusCode, url: d.url })
    refusedRequests.set(d.webContentsId, list)
  })
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (details.webContentsId && details.resourceType === 'xhr') xhrBump(details.webContentsId, 1)
    if (details.webContentsId !== undefined && lightWindows.has(details.webContentsId) && HEAVY.has(details.resourceType))
      return cb({ cancel: true })
    try {
      const host = new URL(details.url).hostname
      if (AD_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return cb({ cancel: true })
    } catch {
      /* ignore bad urls */
    }
    cb({})
  })
}

export function ensureSession(): void {
  installAdBlocker()
}

/**
 * A hidden window in the shared "sources" session (cookies, ad blocking). Caller must destroy it.
 * `light` windows don't download images/video/fonts (much faster; use when you only need text/links).
 */
function createHidden(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { partition: PARTITION, backgroundThrottling: false, sandbox: true, contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return win
}

// Starting a browser window cold takes seconds. While pages are being read one after another, a spare is kept ready
// so the next one starts right away. A spare is a whole Chromium page (~100 MB), so it is only made once hidden pages
// are in use, and closed again after a minute with nothing to do.
let warm: BrowserWindow | null = null
let warmEnabled = false
let warmTimer: NodeJS.Timeout | undefined
const SPARE_IDLE_MS = 60 * 1000

function prewarm(): void {
  if (!warmEnabled || (warm && !warm.isDestroyed())) return
  warm = createHidden()
  warm.loadURL('about:blank').catch(() => undefined)
  if (warmTimer) clearTimeout(warmTimer)
  warmTimer = setTimeout(() => {
    if (warm && !warm.isDestroyed()) warm.destroy()
    warm = null
  }, SPARE_IDLE_MS)
}

/** Call once at startup (not in dev smoke modes). */
export function warmUp(): void {
  installAdBlocker()
  warmEnabled = true
}

const CHALLENGE_RE = /just a moment|security verification|checking your browser|verify you are human|attention required/i

/** Is this window showing a "verify you are human" screen (Cloudflare and similar) instead of the site? */
export async function pageIsChallenge(win: BrowserWindow): Promise<boolean> {
  const text: string = await win.webContents
    .executeJavaScript('document.title + " " + (document.body ? document.body.innerText.slice(0, 400) : "")')
    .catch(() => '')
  return CHALLENGE_RE.test(text)
}

/**
 * Some sites put a "verify you are human" check in front of everything. The app never tries to pass it by itself.
 * This opens a normal, visible window on the site and waits while YOU complete the check; the proof it gives
 * (a cookie) is kept for the app's hidden windows. Resolves true once the real page shows, false if you close the
 * window or it takes more than 4 minutes.
 */
export function waitForHuman(url: string): Promise<boolean> {
  if (process.env['MR_NOHUMAN']) return Promise.resolve(false) // dev batch tests must never open windows
  installAdBlocker()
  const host = new URL(url).hostname
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    show: true,
    title: `Verify you are human — ${host}`,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.loadURL(url).catch(() => undefined)
  return new Promise((resolve) => {
    let finished = false
    const finish = (ok: boolean): void => {
      if (finished) return
      finished = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.destroy()
      resolve(ok)
    }
    const started = Date.now()
    const timer = setInterval(async () => {
      if (win.isDestroyed()) return finish(false)
      if (Date.now() - started > 4 * 60 * 1000) return finish(false)
      if (!(await pageIsChallenge(win))) {
        await new Promise((r) => setTimeout(r, 1200)) // let the site set its cookie before we close
        finish(true)
      }
    }, 1000)
    win.on('closed', () => finish(false))
  })
}

export function closeWarm(): void {
  warmEnabled = false
  if (warm && !warm.isDestroyed()) warm.destroy()
  warm = null
}

export function hiddenWindow(opts: { light?: boolean } = {}): BrowserWindow {
  installAdBlocker()
  const win = warm && !warm.isDestroyed() ? warm : createHidden()
  if (win === warm) warm = null
  setTimeout(prewarm, 300) // have a spare ready for the next page (it closes again after a minute unused)
  const id = win.webContents.id
  refusedRequests.delete(id) // a reused spare window starts with a clean slate
  xhrPending.delete(id)
  xhrLast.delete(id)
  if (opts.light) lightWindows.add(id)
  win.on('closed', () => {
    lightWindows.delete(id)
    refusedRequests.delete(id)
    xhrPending.delete(id)
    xhrLast.delete(id)
  })
  return win
}

export async function loadPage(win: BrowserWindow, url: string, timeoutMs = 45000): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        win.loadURL(url),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error('Page load timed out')), timeoutMs)
        })
      ])
      return
    } catch (e) {
      // ERR_ABORTED (-3) is normal when a site redirects client-side; the new page is still loading.
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ERR_ABORTED')) return
      if (attempt === 2 || msg.includes('timed out')) throw e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/**
 * Like loadPage, but returns as soon as the page's structure is ready (dom-ready) instead of waiting for every
 * ad, tracker and image to finish. For reading links and cards that is all that's needed, and it is much quicker
 * on sites that load slow third-party scripts.
 */
export function loadPageReady(win: BrowserWindow, url: string, timeoutMs = 20000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const wc = win.webContents
    let done = false
    const finish = (err?: Error): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      wc.removeListener('dom-ready', onReady)
      if (err) reject(err)
      else resolve()
    }
    const onReady = (): void => finish()
    const timer = setTimeout(() => finish(new Error('Page load timed out')), timeoutMs)
    wc.once('dom-ready', onReady)
    win.loadURL(url).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ERR_ABORTED')) return // a client-side redirect: the new page is still loading
      finish(new Error(msg))
    })
  })
}

export interface GrabResult {
  url: string
  title: string
  pages: string[]
  /** The address the page ended up on (a site can send a chapter that's gone to its home page). */
  landed?: string
}

// Runs inside the page: scroll to trigger lazy loading, then collect big images in DOM order.
const PAGE_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Some sites show a short "checking your browser" screen first: wait for the real page.
  for (let i = 0; i < 40 && (!document.body || /just a moment|checking your browser/i.test(document.title)); i++) await sleep(150);
  let lastHeight = 0, stable = 0;
  for (let i = 0; i < 150 && stable < 3; i++) {
    window.scrollBy(0, Math.max(600, window.innerHeight * 0.9));
    await sleep(110);
    const h = document.documentElement.scrollHeight;
    if (h === lastHeight && window.scrollY + window.innerHeight >= h - 5) stable++;
    else stable = 0;
    lastHeight = h;
  }
  await sleep(250);
  const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'src'];
  const seen = new Set();
  const out = [];
  for (const img of document.images) {
    let src = '';
    for (const a of attrs) {
      const v = img.getAttribute(a);
      if (v && !v.startsWith('data:') && v.trim()) { src = v.trim(); break; }
    }
    if (!src) src = img.currentSrc || '';
    if (!src) continue;
    try { src = new URL(src, location.href).href; } catch { continue; }
    const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    const r = img.getBoundingClientRect();
    out.push({ src, w, h, rw: r.width, rh: r.height });
  }
  return { title: document.title, imgs: out };
})()
`

interface RawImg {
  src: string
  w: number
  h: number
  rw: number
  rh: number
}

function pickPages(imgs: RawImg[]): string[] {
  // Keep big, tall-ish images. Manga pages are large; icons/banners/avatars are not.
  const big = imgs.filter((i) => {
    const w = Math.max(i.w, i.rw)
    const h = Math.max(i.h, i.rh)
    return w >= 400 && h >= 400
  })
  if (big.length === 0) return []
  // Most pages share the same host (the CDN). Drop outliers from other hosts (ad banners).
  const hostCount = new Map<string, number>()
  for (const i of big) {
    const h = new URL(i.src).hostname
    hostCount.set(h, (hostCount.get(h) ?? 0) + 1)
  }
  const topHost = [...hostCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const seen = new Set<string>()
  const pages: string[] = []
  for (const i of big) {
    if (new URL(i.src).hostname !== topHost) continue
    if (seen.has(i.src)) continue
    seen.add(i.src)
    pages.push(i.src)
  }
  return pages
}

// Loads any page in the hidden browser and returns its title + links (used to discover series/chapter URLs).
export async function probeLinks(url: string): Promise<{ title: string; status: string; links: string[] }> {
  installAdBlocker()
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: PARTITION, backgroundThrottling: false, sandbox: true }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Page load timed out')), 45000))
    ])
    await new Promise((r) => setTimeout(r, 4000))
    return await win.webContents.executeJavaScript(
      `({ title: document.title, status: document.body ? document.body.innerText.slice(0, 120).replace(/\\s+/g,' ') : '', links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))] })`
    )
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

// Runs in a "light" window (images blocked): lets the page build its image list, then reads every <img>.
// Nothing is downloaded, so this takes a moment instead of waiting for every page image to arrive.
const LIGHT_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && (!document.body || /just a moment|checking your browser/i.test(document.title)); i++) await sleep(150);
  const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'src'];
  const collect = () => {
    const out = [];
    for (const img of document.images) {
      let src = '';
      for (const a of attrs) {
        const v = img.getAttribute(a);
        if (v && !v.startsWith('data:') && v.trim()) { src = v.trim(); break; }
      }
      if (!src) src = img.currentSrc || '';
      if (!src) continue;
      try { src = new URL(src, location.href).href; } catch { continue; }
      out.push({ src, w: Number(img.getAttribute('width')) || 0, h: Number(img.getAttribute('height')) || 0 });
    }
    return out;
  };
  // Scrolling makes lazy loaders add their images; wait until the list stops growing.
  let last = -1, stable = 0, imgs = [];
  for (let i = 0; i < 60 && stable < 3; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(120);
    imgs = collect();
    if (imgs.length > 0 && imgs.length === last) stable++;
    else stable = 0;
    last = imgs.length;
  }
  return { title: document.title, imgs };
})()
`

export async function grabChapterLight(url: string): Promise<GrabResult> {
  const win = hiddenWindow({ light: true })
  try {
    await loadPage(win, url, 30000)
    const r = (await win.webContents.executeJavaScript(LIGHT_SCRIPT)) as {
      title: string
      imgs: { src: string; w: number; h: number }[]
    }
    const urls = r.imgs.filter((i) => !((i.w && i.w < 200) || (i.h && i.h < 200))).map((i) => i.src)
    return { url, title: r.title, pages: pickPageGroup(urls), landed: win.webContents.getURL() }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Slowest, last-resort path: loads every image to measure it. */
export async function grabChapter(url: string): Promise<GrabResult> {
  installAdBlocker()
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      partition: PARTITION,
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true
    }
  })
  // Block popups spawned by sites.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Page load timed out')), 45000))
    ])
    const result = (await win.webContents.executeJavaScript(PAGE_SCRIPT)) as {
      title: string
      imgs: RawImg[]
    }
    return { url, title: result.title, pages: pickPages(result.imgs), landed: win.webContents.getURL() }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
