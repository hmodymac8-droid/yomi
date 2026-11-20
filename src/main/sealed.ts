import { createDecipheriv, type CipherGCMTypes } from 'crypto'
import { session } from 'electron'
import { ensureSession, refererHints } from './grabber'

/**
 * Sites that send their page pictures encrypted (Stellar Saber's "flavor" theme: each picture is an AES-GCM blob that
 * the site's own script decrypts in the page). The key for the chapter is put on each page address after a '#', a
 * part of an address that is never sent to the site, so the reader, the image cache and downloads can all decrypt
 * the picture after fetching it.
 */
const MARK = '#yomi-aesgcm='

export function sealedKey(url: string): Buffer | null {
  const i = url.indexOf(MARK)
  if (i < 0) return null
  const key = Buffer.from(decodeURIComponent(url.slice(i + MARK.length)), 'base64')
  return key.length === 16 || key.length === 24 || key.length === 32 ? key : null
}

/** The kind of picture, from its first bytes. */
function sniff(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.subarray(0, 4).toString('latin1') === '\x89PNG') return 'image/png'
  if (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  if (b.subarray(4, 12).toString('latin1').startsWith('ftypavi')) return 'image/avif'
  return 'application/octet-stream'
}

/**
 * The picture itself: for an address with a key, the decrypted bytes and their real type (12-byte IV first, then the
 * data, then the 16-byte tag); any other picture is passed on as it is. Throws when the key doesn't fit.
 */
export function unseal(url: string, buf: Buffer, type: string): { buf: Buffer; type: string } {
  const key = sealedKey(url)
  if (!key || buf.length < 12 + 16) return { buf, type }
  const d = createDecipheriv(`aes-${key.length * 8}-gcm` as CipherGCMTypes, key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(buf.length - 16))
  const out = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()])
  return { buf: out, type: sniff(out) }
}

/**
 * A chapter page of the "flavor" theme with encrypted pictures: the picture addresses are in the page (data-cdn-url),
 * the key is asked for with the nonce the page carries. Null when the page is not like that.
 */
export async function flavorCdnPages(html: string, pageUrl: string): Promise<string[] | null> {
  if (!/flavorReaderData\s*=/.test(html) || !/\bcdn:\s*true/.test(html)) return null
  const nonce = /cdnNonce:\s*['"]([^'"]+)['"]/.exec(html)?.[1]
  const chapterId = /chapterId:\s*(\d+)/.exec(html)?.[1]
  const pics = [...html.matchAll(/data-cdn-url=["']([^"']+)["']/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  )
  if (!nonce || !chapterId || pics.length === 0) return null
  const origin = new URL(pageUrl).origin
  const ajax =
    /ajaxurl:\s*['"]([^'"]+)['"]/.exec(html)?.[1]?.replace(/\\\//g, '/') ??
    origin + '/wp-admin/admin-ajax.php'
  ensureSession()
  const ses = session.fromPartition('persist:sources')
  refererHints.set(ajax, pageUrl)
  try {
    const r = await ses.fetch(ajax, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'flavor_cdn_get_key',
        nonce,
        chapter_id: chapterId
      }).toString()
    })
    const j = (await r.json()) as { success?: boolean; data?: { key?: string } }
    const key = j?.data?.key
    if (!key) return null
    return pics.map((u) => new URL(u, pageUrl).href + MARK + encodeURIComponent(key))
  } catch {
    return null
  } finally {
    refererHints.delete(ajax)
  }
}
