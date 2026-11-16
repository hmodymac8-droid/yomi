export interface ShareInfo {
  title: string
  cover: string
  coverReferer: string
  tags: string[]
  chapters: number
  /** Where you are, e.g. "Chapter 45" (empty when you haven't started). */
  reading?: string
}

const W = 1080
const H = 1350

async function loadCover(info: ShareInfo): Promise<ImageBitmap | null> {
  if (!info.cover) return null
  try {
    // the main process hands over the picture's bytes (a canvas can't read the mr-img:// pictures itself)
    const got = await window.api.coverBytes(info.cover, info.coverReferer)
    if (!got) return null
    return await createImageBitmap(new Blob([got.data as BlobPart], { type: got.type }))
  } catch {
    return null
  }
}


/**
 * A short link for a series, e.g. https://yomi.yomi-reader.workers.dev/k7m2xq . The finished card is uploaded (as a
 * small JPEG) so chat apps show it full size under the link, and anyone who taps it gets a Download Yomi button.
 */
export async function createShareLink(info: ShareInfo): Promise<string> {
  const blob = await makeShareCard(info, 'image/jpeg', 0.86)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const meta = {
    t: info.title,
    r: info.reading ?? '',
    n: info.chapters,
    g: info.tags.slice(0, 4).join(',')
  }
  return await window.api.shareCreate(meta, bytes)
}

/** Breaks text into at most `max` lines that fit `width`; the last line ends with "…" when it was cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= width || !line) line = next
    else {
      lines.push(line)
      line = words[i]
    }
    if (lines.length === max) break
  }
  if (lines.length < max && line) lines.push(line)
  else if (lines.length === max) lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '') + '…'
  return lines
}

/** A 1080×1350 picture (cover, title, tags, "Read on Yomi") that is ready to post anywhere. */
export async function makeShareCard(
  info: ShareInfo,
  type = 'image/png',
  quality?: number
): Promise<Blob> {
  const cover = await loadCover(info)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Background: the cover, blown up and darkened, so every card gets its own colours.
  ctx.fillStyle = '#16150f'
  ctx.fillRect(0, 0, W, H)
  if (cover) {
    const s = Math.max(W / cover.width, H / cover.height)
    ctx.filter = 'blur(40px) brightness(0.45)'
    ctx.drawImage(
      cover,
      (W - cover.width * s) / 2,
      (H - cover.height * s) / 2,
      cover.width * s,
      cover.height * s
    )
    ctx.filter = 'none'
  }

  // Cover, centred, 3:4
  const cw = 560
  const ch = 800
  const cx = (W - cw) / 2
  const cy = 90
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 50
  ctx.shadowOffsetY = 20
  ctx.beginPath()
  ctx.roundRect(cx, cy, cw, ch, 24)
  ctx.fillStyle = '#26241a'
  ctx.fill()
  ctx.restore()
  if (cover) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(cx, cy, cw, ch, 24)
    ctx.clip()
    const s = Math.max(cw / cover.width, ch / cover.height)
    ctx.drawImage(
      cover,
      cx + (cw - cover.width * s) / 2,
      cy + (ch - cover.height * s) / 2,
      cover.width * s,
      cover.height * s
    )
    ctx.restore()
  }

  // Title
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 62px "Newsreader Variable", Georgia, serif'
  const lines = wrap(ctx, info.title, W - 160, 2)
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 990 + i * 72))

  // Where you are, then tags
  const total = info.chapters > 0 ? ` of ${info.chapters}` : ''
  const progressLine = info.reading ? `I'm on ${info.reading}${total}` : ''
  let y = 990 + lines.length * 72 + 20
  if (progressLine) {
    ctx.fillStyle = '#e4c94a'
    ctx.font = '700 40px "DM Sans Variable", system-ui, sans-serif'
    ctx.fillText(progressLine, W / 2, y)
    y += 56
  }
  const sub = [
    ...info.tags.slice(0, 4),
    !progressLine && info.chapters > 0 ? `${info.chapters} chapters` : ''
  ]
    .filter(Boolean)
    .join('  ·  ')
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.font = '500 34px "DM Sans Variable", system-ui, sans-serif'
  ctx.fillText(sub, W / 2, y)

  // Footer
  ctx.fillStyle = '#e4c94a'
  ctx.font = '700 38px "DM Sans Variable", system-ui, sans-serif'
  ctx.fillText('Read it on Yomi', W / 2, H - 92)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '500 30px "DM Sans Variable", system-ui, sans-serif'
  ctx.fillText('hmodymac8-droid.github.io/yomi', W / 2, H - 46)

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), type, quality)
  )
}
