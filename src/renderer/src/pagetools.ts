/*
 * Page tools for the reader (optional): finding the plain borders around a page so they can be cut off. This needs
 * the picture's pixels, which come from the main process.
 */

export interface Insets {
  t: number
  r: number
  b: number
  l: number
}

async function bitmapOf(src: string): Promise<ImageBitmap | null> {
  const got = await window.api.pageBytes(src)
  if (!got) return null
  try {
    return await createImageBitmap(new Blob([got.data as BlobPart], { type: got.type }))
  } catch {
    return null
  }
}

// ---------- borders ----------
const cropCache = new Map<string, Insets | null>()

/**
 * The plain white (or black) margins around a page, as fractions of its size, or null when there are none worth
 * cutting. Each side is cut by at most 20%, so a mostly-white panel is never cut away.
 */
export async function findBorders(src: string): Promise<Insets | null> {
  if (cropCache.has(src)) return cropCache.get(src) ?? null
  const bmp = await bitmapOf(src)
  if (!bmp) return null
  const W = 240
  const H = Math.max(1, Math.round((bmp.height / bmp.width) * W))
  const c = new OffscreenCanvas(W, Math.min(H, 4000))
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height)
  const lum = (i: number): number => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  // the margin colour is whatever the corner is, if it is near white or near black
  const corner = lum(0)
  if (corner < 235 && corner > 25) {
    cropCache.set(src, null)
    return null
  }
  const plain = (v: number): boolean => Math.abs(v - corner) < 18
  const rowPlain = (y: number): boolean => {
    let off = 0
    for (let x = 0; x < width; x++) if (!plain(lum((y * width + x) * 4))) off++
    return off <= width * 0.01
  }
  const colPlain = (x: number): boolean => {
    let off = 0
    for (let y = 0; y < height; y++) if (!plain(lum((y * width + x) * 4))) off++
    return off <= height * 0.01
  }
  const maxY = Math.floor(height * 0.2)
  const maxX = Math.floor(width * 0.2)
  let t = 0
  while (t < maxY && rowPlain(t)) t++
  let b = 0
  while (b < maxY && rowPlain(height - 1 - b)) b++
  let l = 0
  while (l < maxX && colPlain(l)) l++
  let r = 0
  while (r < maxX && colPlain(width - 1 - r)) r++
  // keep a hair of margin, and ignore tiny borders
  const pad = (n: number, of: number): number => (n > of * 0.015 ? Math.max(0, n - 1) / of : 0)
  const res = { t: pad(t, height), b: pad(b, height), l: pad(l, width), r: pad(r, width) }
  const any = res.t + res.b + res.l + res.r > 0
  cropCache.set(src, any ? res : null)
  return any ? res : null
}
