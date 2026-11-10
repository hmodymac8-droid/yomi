import { net } from 'electron'

/** The bytes of a page picture the reader shows (mr-img:// only), for finding its white borders. */
export async function pageBytes(src: string): Promise<{ type: string; data: Uint8Array } | null> {
  if (!src.startsWith('mr-img://')) return null
  try {
    const r = await net.fetch(src)
    if (!r.ok) return null
    return { type: r.headers.get('content-type') ?? 'image/jpeg', data: new Uint8Array(await r.arrayBuffer()) }
  } catch {
    return null
  }
}
