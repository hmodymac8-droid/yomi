import { app, BrowserWindow, clipboard, session } from 'electron'
import { pickPageGroup } from './staticParse'
import { COMMAND_RE, FAKE_CHECK_RE } from './fakeCheck'

const PARTITION = 'persist:sources'

/**
 * Look like a normal Chrome: Electron's own name ("… Electron/x manga-reader/y") trips some bot checks, and Chrome
 * itself only gives its major version ("Chrome/152.0.0.0").
 *
 * It is set once for the whole app, before any page opens, and never per session: a session's own name reaches its
 * pages and requests but not the background workers they start, and Cloudflare's "verify you are human" check compares
 * the two. Seeing two different browsers, it gave its pass and then refused it, reloading forever (2026-11-21).
 */
export function chromeName(ua: string): string {
  return ua.replace(/\s(?:Electron|manga-reader|yomi)\/\S+/gi, '').replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0')
}
if (process.env['MR_KEEP_UA'] !== '1') app.userAgentFallback = chromeName(app.userAgentFallback)

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
  'monetag.com',
  'pubadx.one'
]

/** A picture from an ad network is never a chapter page (KingOfShojo: pubadx banners in a one-picture chapter). */
const fromAdHost = (u: string): boolean => {
  try {
    const host = new URL(u).hostname
    return AD_HOSTS.some((h) => host === h || host.endsWith('.' + h))
  } catch {
    return false
  }
}

/**
 * url -> Referer to send, for requests the app makes itself (image proxy, downloads). Keyed without the part after
 * '#', which a request never carries (an encrypted picture's key travels there, see sealed.ts).
 */
class HintMap extends Map<string, string> {
  private static bare = (url: string): string => url.split('#')[0]
  override set(url: string, referer: string): this {
    return super.set(HintMap.bare(url), referer)
  }
  override get(url: string): string | undefined {
    return super.get(HintMap.bare(url))
  }
  override delete(url: string): boolean {
    return super.delete(HintMap.bare(url))
  }
}
export const refererHints = new HintMap()

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
  // (the browser's name is set for the whole app, see chromeName at the top, not per session here)
  // Site pages never get the clipboard: fake "verify you are human" pages put a command there and ask you to paste it
  // into Run or a terminal (see FAKE_CHECK_RE). Only these two permissions; everything else keeps Electron's default.
  const CLIPBOARD = new Set<string>(['clipboard-read', 'clipboard-sanitized-write'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(!CLIPBOARD.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => !CLIPBOARD.has(permission))
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
      // what a browser says for a picture on that page: a site that keeps its pages on its own server (Drake Comics)
      // refuses "cross-site" requests for them
      h['Sec-Fetch-Site'] = fetchSite(details.url, h['Referer'])
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

/** Sec-Fetch-Site of a request for `url` made from the page `referer`, as a browser would send it. */
export function fetchSite(url: string, referer: string | undefined): string {
  if (!referer) return 'cross-site'
  try {
    const a = new URL(url)
    const b = new URL(referer)
    if (a.origin === b.origin) return 'same-origin'
    // (the last two labels of the host name: close enough to the registrable domain for these sites)
    const site = (h: string): string => h.split('.').slice(-2).join('.')
    return a.protocol === b.protocol && site(a.hostname) === site(b.hostname) ? 'same-site' : 'cross-site'
  } catch {
    return 'cross-site'
  }
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

/** A script call that answers within 1.5 s, or '' (Cloudflare's own check frame can leave one waiting forever). */
function frameText(run: () => Promise<unknown>): Promise<string> {
  return Promise.race([
    run()
      .then((t) => String(t))
      .catch(() => ''),
    new Promise<string>((r) => setTimeout(() => r(''), 1500))
  ])
}

/** The text of every frame in the window (a fake check often sits in a frame from another site). */
async function windowText(win: BrowserWindow): Promise<string> {
  // (Cloudflare's own check frame is left alone: a script run inside it makes the real check fail)
  const frames = win.webContents.mainFrame.framesInSubtree.filter((f) => !/^https:\/\/challenges\.cloudflare\.com\//.test(f.url))
  const texts = await Promise.all(
    frames.map((f) =>
      frameText(() =>
        f.executeJavaScript('(document.title || "") + " " + (document.body ? document.body.innerText.slice(0, 4000) : "")')
      )
    )
  )
  return texts.join('\n')
}

/** passed: the real page showed. closed: you closed the window or gave up. fake: a fake check that asks for a command. */
export type HumanCheck = 'passed' | 'closed' | 'fake'

/**
 * Some sites put a "verify you are human" check in front of everything. The app never tries to pass it by itself.
 * This opens a normal, visible window on the site and waits while YOU complete the check; the proof it gives
 * (a cookie) is kept for the app's hidden windows. Gives up after 4 minutes.
 * The window stays on the site (an ad cannot send it elsewhere), and closes at once on a fake check page; a command
 * such a page put on the clipboard is wiped.
 */
export function waitForHuman(url: string): Promise<HumanCheck> {
  if (process.env['MR_NOHUMAN']) return Promise.resolve('closed') // dev batch tests must never open windows
  installAdBlocker()
  const host = new URL(url).hostname
  const site = (h: string): string => h.split('.').slice(-2).join('.')
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    show: true,
    title: `Yomi: site check for ${host}`,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // The page (or an ad on it) may not take the window to another site: that is how ads bring fake checks in.
  // (Redirects the site's server answers with still go through: sites move to new addresses.)
  win.webContents.on('will-navigate', (e) => {
    try {
      if (site(new URL(e.url).hostname) !== site(host)) e.preventDefault()
    } catch {
      e.preventDefault()
    }
  })
  void win.loadURL(url).catch(() => undefined)
  const clipBefore = clipboard.readText().catch(() => '')
  /** Did something put a command on the clipboard while the window was open? Wipe it. */
  const commandPlanted = async (): Promise<boolean> => {
    const now = await clipboard.readText().catch(() => '')
    if (now === (await clipBefore) || !COMMAND_RE.test(now)) return false
    clipboard.clear()
    return true
  }
  return new Promise((resolve) => {
    let finished = false
    const finish = async (how: HumanCheck): Promise<void> => {
      if (finished) return
      finished = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.destroy()
      resolve((await commandPlanted()) ? 'fake' : how)
    }
    const started = Date.now()
    let busy = false // one look at a time
    const timer = setInterval(async () => {
      if (finished || busy) return
      if (win.isDestroyed()) return finish('closed')
      if (Date.now() - started > 4 * 60 * 1000) return finish('closed')
      busy = true
      try {
        if ((await commandPlanted()) || FAKE_CHECK_RE.test(await windowText(win))) return finish('fake')
        if (win.isDestroyed()) return finish('closed')
        const text = await frameText(() =>
          win.webContents.executeJavaScript('document.title + " " + (document.body ? document.body.innerText.slice(0, 400) : "")')
        )
        if (process.env['MR_FAKEDEBUG']) console.log('CHECKWIN', Math.round((Date.now() - started) / 1000), JSON.stringify(text.slice(0, 80)))
        if (text && !CHALLENGE_RE.test(text)) {
          await new Promise((r) => setTimeout(r, 1200)) // let the site set its cookie before we close
          finish('passed')
        }
      } finally {
        busy = false
      }
    }, 1000)
    win.on('closed', () => finish('closed'))
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
 * Like loadPage, but does not wait forever for a page's slow leftovers. Electron runs no script in a page (so Yomi
 * cannot read it) until the page has fully loaded, and some sites take 10 s or more to finish loading files they
 * don't need to show their content (Lagoon Scans: ready after 0.7 s, fully loaded after 8-15 s). The page's own
 * scripts have all run by dom-ready, so give it a few more seconds for its data requests, then stop the rest.
 */
export async function loadPageSettled(
  win: BrowserWindow,
  url: string,
  graceMs = 3000,
  timeoutMs = 45000
): Promise<void> {
  const wc = win.webContents
  let grace: NodeJS.Timeout | undefined
  let stopped = false
  const forwarding = (): boolean => onCheckPage(win, url)
  const onReady = (): void => {
    clearTimeout(grace)
    grace = setTimeout(() => {
      if (win.isDestroyed() || !wc.isLoadingMainFrame()) return
      // a "just a moment" check, or a check page about to send us on: let it finish
      if (CHALLENGE_TITLE.test(wc.getTitle()) || forwarding()) return onReady()
      stopped = true
      wc.stop()
    }, graceMs)
  }
  // The page sends itself on to another address: wait for that one's dom-ready instead of cutting it off.
  const onNavigate = (d: { isMainFrame: boolean; isSameDocument: boolean }): void => {
    if (d.isMainFrame && !d.isSameDocument) clearTimeout(grace)
  }
  wc.on('dom-ready', onReady) // (on every dom-ready: a client-side redirect starts a new page)
  wc.on('did-start-navigation', onNavigate)
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          wc.loadURL(url),
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('Page load timed out')), timeoutMs)
          })
        ])
        break
      } catch (e) {
        if (stopped) break // stopped on purpose: the page is there, only its leftovers were cut off
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('ERR_ABORTED')) break // a client-side redirect: the new page is still loading
        if (attempt === 2 || msg.includes('timed out')) throw e
        await sleep(1500 * (attempt + 1))
      } finally {
        clearTimeout(timer)
      }
    }
    // (its dom-ready + grace stop the real page's leftovers as usual)
    await waitPastCheckPage(win, url)
  } finally {
    clearTimeout(grace)
    if (!win.isDestroyed()) {
      wc.removeListener('dom-ready', onReady)
      wc.removeListener('did-start-navigation', onNavigate)
    }
  }
}

/**
 * On a site's own check page that sends you on to the page you asked for when it is done (Batcave:
 * /_c?t=…&u=<the address asked for>)?
 */
function onCheckPage(win: BrowserWindow, asked: string): boolean {
  if (win.isDestroyed()) return false
  try {
    const at = new URL(win.webContents.getURL())
    return at.href !== asked && [...at.searchParams.values()].includes(asked)
  } catch {
    return false
  }
}

/** If the site put up such a check page, waits (up to 30 s) until it has sent us on and the real page has loaded. */
export async function waitPastCheckPage(win: BrowserWindow, asked: string): Promise<void> {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  if (!onCheckPage(win, asked)) return
  const end = Date.now() + 30000
  while (Date.now() < end && onCheckPage(win, asked)) await sleep(200)
  while (!win.isDestroyed() && Date.now() < end && win.webContents.isLoadingMainFrame()) await sleep(200)
}


/**
 * For a page already past dom-ready (see loadPageReady): give it up to graceMs to finish loading, then stop its
 * leftovers so Yomi can read it (Electron holds back Yomi's scripts until the page has finished loading).
 */
export async function settleLoading(win: BrowserWindow, graceMs = 3000): Promise<void> {
  const end = Date.now() + graceMs
  while (Date.now() < end) {
    if (win.isDestroyed() || !win.webContents.isLoadingMainFrame()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  if (win.isDestroyed() || !win.webContents.isLoadingMainFrame()) return
  // (never cut a "just a moment" check short)
  if (!CHALLENGE_TITLE.test(win.webContents.getTitle())) win.webContents.stop()
}

/** The title of a "checking your browser" page (read without running a script: none runs while the page loads). */
const CHALLENGE_TITLE =
  /just a moment|checking your browser|attention required|security verification|un instant/i

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
    // Time's up: a slow site (Scythe Scans runs 67 scripts before "ready") may still have drawn its whole page by
    // now. If it has, read that; links and cards are all that's needed.
    const timer = setTimeout(() => {
      if (done || win.isDestroyed()) return finish(new Error('Page load timed out'))
      Promise.race([
        wc.executeJavaScript('document.body ? document.links.length : 0') as Promise<number>,
        new Promise<number>((r) => setTimeout(() => r(0), 3000))
      ])
        .catch(() => 0)
        .then((links) => finish(links >= 30 ? undefined : new Error('Page load timed out')))
    }, timeoutMs)
    wc.once('dom-ready', onReady)
    win.loadURL(url).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ERR_ABORTED')) return // a client-side redirect: the new page is still loading
      finish(new Error(msg))
    })
  })
}

/**
 * A picture made inside the page (blob:, data:) exists only there: it can't be fetched again or saved. Ad pictures
 * are left out too.
 */
const downloadable = (u: string): boolean => /^https?:/i.test(u) && !fromAdHost(u)

export interface GrabResult {
  url: string
  title: string
  pages: string[]
  /** The address the page ended up on (a site can send a chapter that's gone to its home page). */
  landed?: string
  /** The list came from the site itself (decryption key, or asked for by chapter number): trust it over a browser. */
  fromSite?: boolean
}

// Runs inside the page: scroll to trigger lazy loading, then collect big images in DOM order.
const PAGE_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Some sites show a short "checking your browser" screen first: wait for the real page.
  for (let i = 0; i < 40 && (!document.body || /just a moment|checking your browser/i.test(document.title)); i++) await sleep(150);
  // pages whose addresses are written into the page, base64-encoded (Mangadar): read them directly
  const mds = [...document.querySelectorAll('img[data-mds]')].map((i) => { try { return atob(i.getAttribute('data-mds') || ''); } catch { return ''; } }).filter((u) => u.startsWith('http'));
  if (mds.length) return { title: document.title, imgs: [], mds };
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
    // Drawn small on the page = a comment sticker or emoji, however big its file is (Gourmet: 181 stickers at 40px).
    // (Pages not laid out yet measure 0 and are kept.)
    if (i.rw > 0 && i.rw < 150) return false
    if (/\/wp-content\/plugins\//i.test(i.src)) return false // a plugin's own pictures (coins popups...)
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
  // pages whose addresses are written into the page, base64-encoded (Mangadar): read them directly
  const mds = [...document.querySelectorAll('img[data-mds]')].map((i) => { try { return atob(i.getAttribute('data-mds') || ''); } catch { return ''; } }).filter((u) => u.startsWith('http'));
  if (mds.length) return { title: document.title, imgs: [], mds };
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
      // comment stickers / emoji: drawn small by their style or named so by their class (Gourmet)
      const sw = /(?:^|;)\\s*(?:max-)?width:\\s*(\\d+)px/i.exec(img.getAttribute('style') || '');
      if ((sw && Number(sw[1]) < 200) || /\\b(sticker|emoji|emoticon|avatar)\\b/i.test(img.className || '')) continue;
      const reader = !!img.closest('.reading-content, #readerarea') || img.classList.contains('wp-manga-chapter-img');
      // a sidebar or widget ("popular series" covers) never holds the chapter's pages (KingOfShojo)
      if (!reader && img.closest('aside, #sidebar, .sidebar, .widget, .widget-area')) continue;
      out.push({ src, w: Number(img.getAttribute('width')) || 0, h: Number(img.getAttribute('height')) || 0, reader });
    }
    return out;
  };
  // Some readers fill in each page's picture only when that page comes into view (Mangasid): walk down the chapter a
  // screen at a time first, so every page gets its turn, instead of jumping straight to the end.
  for (let y = 0, i = 0; i < 300; i++) {
    window.scrollTo(0, y);
    await sleep(70);
    y += Math.max(400, window.innerHeight * 0.8);
    if (y >= document.documentElement.scrollHeight) break;
  }
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

/** What a chapter that only members may read says (Asura Scans sends its newest chapters to /login?return=…). */
export const NEEDS_ACCOUNT =
  'This chapter needs an account on the site: it only shows it to members who are logged in there.'

const onLoginPage = (win: BrowserWindow): boolean => {
  try {
    return !win.isDestroyed() && /\/(login|log-in|signin|sign-in)(\/|$)/i.test(new URL(win.webContents.getURL()).pathname)
  } catch {
    return false
  }
}

/**
 * Runs a reading script in the chapter's window. If the site moves to its login page meanwhile, the script is gone and
 * would never answer: notice that (and any other hang) instead of waiting forever.
 */
async function runReader<T>(win: BrowserWindow, script: string, ms = 60000): Promise<T> {
  if (onLoginPage(win)) throw new Error(NEEDS_ACCOUNT)
  let poll: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(script) as Promise<T>,
      new Promise<T>((_, rej) => {
        const t0 = Date.now()
        poll = setInterval(() => {
          if (onLoginPage(win)) rej(new Error(NEEDS_ACCOUNT))
          else if (win.isDestroyed() || Date.now() - t0 > ms) rej(new Error('Reading the chapter page took too long'))
        }, 500)
      })
    ])
  } finally {
    clearInterval(poll)
  }
}

export async function grabChapterLight(url: string): Promise<GrabResult> {
  const win = hiddenWindow({ light: true })
  try {
    await loadPageSettled(win, url, 5000, 30000) // (a reader may ask for its page list after dom-ready: 5 s)
    const r = await runReader<{
      title: string
      imgs: { src: string; w: number; h: number; reader?: boolean }[]
      mds?: string[]
    }>(win, LIGHT_SCRIPT)
    if (r.mds?.length) return { url, title: r.title, pages: r.mds, landed: win.webContents.getURL() }
    const urls = r.imgs
      .filter((i) => !((i.w && i.w < 200) || (i.h && i.h < 200)) && downloadable(i.src))
      .map((i) => i.src)
    // the site's reader area holds exactly the pages, in order (see parseChapterImages)
    const reader = [
      ...new Set(r.imgs.filter((i) => i.reader).map((i) => i.src))
    ].filter((u) => pickPageGroup([u]).length === 1) // (not a logo / icon / plugin picture)
    // (one picture in the reader area is a one-picture chapter, not a reason to look at the sidebar's covers)
    let pages = reader.length >= 1 ? reader : pickPageGroup(urls)
    // Readers that draw a page only once the one before it has loaded (Batcave) show just the first few here, with
    // images off; their whole list is in the page's data (__DATA__.images).
    const listed: unknown = await win.webContents
      .executeJavaScript(
        `(() => { try { const d = typeof __DATA__ !== 'undefined' ? __DATA__ : null; return d && Array.isArray(d.images) ? d.images : null } catch { return null } })()`
      )
      .catch(() => null)
    if (Array.isArray(listed)) {
      const all = listed.filter((u): u is string => typeof u === 'string' && downloadable(u))
      if (all.length > pages.length) pages = all
    }
    return { url, title: r.title, pages: pages.filter(downloadable), landed: win.webContents.getURL() }
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
    const result = await runReader<{
      title: string
      imgs: RawImg[]
      mds?: string[]
    }>(win, PAGE_SCRIPT, 120000)
    if (result.mds?.length) return { url, title: result.title, pages: result.mds, landed: win.webContents.getURL() }
    return {
      url,
      title: result.title,
      pages: pickPages(result.imgs.filter((i) => downloadable(i.src))),
      landed: win.webContents.getURL()
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
