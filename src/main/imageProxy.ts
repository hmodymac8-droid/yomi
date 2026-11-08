import { app, nativeImage, net, protocol, session } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { createHash } from 'crypto'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { downloadsRoot } from './downloads'
import { ensureSession, refererHints } from './grabber'

export const IMG_SCHEME = 'mr-img'

// Must run before app is ready.
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

// ---- on-disk image cache: every cover/page is downloaded once, then served from disk ----
const CACHE_CAP = 500 * 1024 * 1024
const TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif'
}
const MIME = Object.fromEntries(Object.entries(TYPES).map(([m, e]) => [e, m]))
const cacheDir = (): string => join(app.getPath('userData'), 'imgcache')
let writes = 0

function cachePath(url: string, ext: string): string {
  const key = createHash('sha1').update(url).digest('hex')
  return join(cacheDir(), key.slice(0, 2), `${key}.${ext}`)
}

// The disk cache is read and written in the background (never while the app waits), so covers arriving while you
// scroll don't make it stutter. extOf remembers which kind of file each cached image is, to find it in one go.
const extOf = new Map<string, string>()

async function cacheGet(url: string): Promise<{ buf: Buffer; type: string } | null> {
  const known = extOf.get(url)
  for (const ext of known ? [known] : Object.keys(MIME)) {
    try {
      const buf = await readFile(cachePath(url, ext))
      extOf.set(url, ext)
      return { buf, type: MIME[ext] }
    } catch {
      /* not this kind */
    }
  }
  extOf.delete(url)
  return null
}

function cachePut(url: string, type: string, buf: Buffer): void {
  const ext = TYPES[type]
  if (!ext || buf.length < 200 || buf.length > 12 * 1024 * 1024) return
  const p = cachePath(url, ext)
  void mkdir(join(p, '..'), { recursive: true })
    .then(() => writeFile(p, buf))
    .then(() => {
      extOf.set(url, ext)
      if (++writes % 150 === 0) setTimeout(trimCache, 2000)
    })
    .catch(() => undefined) // the cache is best-effort
}

/** Delete the oldest cached images once the cache grows past its cap. */
function trimCache(): void {
  try {
    const files: { p: string; size: number; t: number }[] = []
    let total = 0
    for (const d of readdirSync(cacheDir())) {
      const dir = join(cacheDir(), d)
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        const st = statSync(p)
        files.push({ p, size: st.size, t: st.mtimeMs })
        total += st.size
      }
    }
    if (total <= CACHE_CAP) return
    files.sort((a, b) => a.t - b.t)
    for (const f of files) {
      if (total <= CACHE_CAP * 0.8) break
      unlinkSync(f.p)
      total -= f.size
    }
  } catch {
    /* ignore */
  }
}

// ---- politeness: a few requests at a time per image server, so a screen full of covers can't trip rate limits ----
const MAX_PER_HOST = 6
const active = new Map<string, number>()
const waiting = new Map<string, (() => void)[]>()

async function withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  while ((active.get(host) ?? 0) >= MAX_PER_HOST) {
    await new Promise<void>((r) => waiting.set(host, [...(waiting.get(host) ?? []), r]))
  }
  active.set(host, (active.get(host) ?? 0) + 1)
  try {
    return await fn()
  } finally {
    active.set(host, (active.get(host) ?? 1) - 1)
    waiting.get(host)?.shift()?.()
  }
}

async function fetchRemote(target: string, referer: string | undefined): Promise<Response> {
  ensureSession() // makes sure the browser-like header hook is installed
  const ses = session.fromPartition('persist:sources')
  const host = new URL(target).hostname
  return withHostSlot(host, async () => {
    // Electron blocks a Referer set through fetch(); the header hook in grabber.ts adds it from this table.
    if (referer) refererHints.set(target, referer)
    try {
      let res = await ses.fetch(target)
      // rate-limited or a hiccup: wait a moment and try again, up to twice
      for (let i = 0; i < 2 && (res.status === 429 || res.status >= 500); i++) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)))
        res = await ses.fetch(target)
      }
      return res
    } finally {
      refererHints.delete(target)
    }
  })
}

/*
 * Covers (&c=1) are shown on cards about 200 px wide. Some sites send the full poster (up to 4,600 px), which the screen
 * then keeps in memory at full size. A big JPEG or PNG cover is shrunk to COVER_W px wide once, when it is first
 * downloaded, and the small copy is what gets cached and shown. Other kinds (WebP, AVIF, GIF) are passed on as they are.
 */
const COVER_W = 400
function shrinkCover(buf: Buffer, type: string): { buf: Buffer; type: string } {
  if (type !== 'image/jpeg' && type !== 'image/png') return { buf, type }
  try {
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return { buf, type }
    const { width } = img.getSize()
    if (width <= COVER_W * 1.2) return { buf, type }
    const small = img.resize({ width: COVER_W, quality: 'good' }).toJPEG(86)
    return small.length > 0 && small.length < buf.length ? { buf: small, type: 'image/jpeg' } : { buf, type }
  } catch {
    return { buf, type }
  }
}

// Two kinds of URLs:
//   mr-img://img/?u=<image url>&r=<referer url>   remote image (cached on disk after the first download)
//   mr-img://local/?f=<dir>/<file>                a page saved by the download manager
export function installImageProxy(): void {
  // The renderer lives in the default session, so the scheme is registered there;
  // the actual fetch goes through the "sources" session (shares cookies with the grabber).
  protocol.handle(IMG_SCHEME, async (req) => {
    const url = new URL(req.url)

    if (url.hostname === 'local') {
      const rel = url.searchParams.get('f') ?? ''
      const root = resolve(downloadsRoot())
      const full = resolve(join(root, rel))
      // never serve anything outside the downloads folder
      if (!full.startsWith(root + sep)) return new Response('forbidden', { status: 403 })
      try {
        return await net.fetch(pathToFileURL(full).toString())
      } catch {
        return new Response('not found', { status: 404 })
      }
    }

    const target = url.searchParams.get('u')
    const referer = url.searchParams.get('r') ?? undefined
    if (!target || !/^https?:/i.test(target)) return new Response('bad request', { status: 400 })

    const cover = url.searchParams.get('c') === '1'
    const key = cover ? target + '#cover' : target // the small cover copy is cached apart from the original
    const cached = await cacheGet(key)
    if (cached) return new Response(new Uint8Array(cached.buf), { headers: { 'content-type': cached.type, 'cache-control': 'max-age=31536000' } })
    if (cover) {
      // the original is already saved from before: make the small copy from it instead of downloading again
      const orig = await cacheGet(target)
      if (orig) {
        const s = shrinkCover(orig.buf, orig.type)
        cachePut(key, s.type, s.buf)
        return new Response(new Uint8Array(s.buf), { headers: { 'content-type': s.type, 'cache-control': 'max-age=31536000' } })
      }
    }

    try {
      const res = await fetchRemote(target, referer)
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!res.ok || !type.startsWith('image/')) return new Response(`upstream ${res.status}`, { status: res.ok ? 502 : res.status })
      let buf: Buffer = Buffer.from(await res.arrayBuffer())
      let outType = type
      if (cover) ({ buf, type: outType } = shrinkCover(buf, type))
      cachePut(key, outType, buf)
      return new Response(new Uint8Array(buf), { headers: { 'content-type': outType, 'cache-control': 'max-age=31536000' } })
    } catch {
      return new Response('fetch failed', { status: 502 })
    }
  })
}
