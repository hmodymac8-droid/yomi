/*
 * What Yomi shows on your Discord profile ("Playing Yomi"), worked out from the screen you are on. Kept free of
 * Electron so it can be tested on its own.
 */

/** What the window tells the main process about the screen it shows. */
export interface PresenceInput {
  screen: string
  title?: string
  chapter?: string
  cover?: string
}

export interface DiscordActivity {
  details?: string
  state?: string
  timestamps?: { start: number }
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string }
}

/** off: nothing on Discord. app: only that you are using Yomi. full: also the series and chapter. */
export type PresenceMode = 'off' | 'app' | 'full'

export const YOMI_LOGO =
  'https://raw.githubusercontent.com/hmodymac8-droid/yomi/main/resources/icon.png'

const SCREEN_TEXT: Record<string, string> = {
  browse: 'Browsing Discover',
  added: 'Browsing their library',
  new: 'Checking new chapters',
  following: 'Checking followed series',
  downloads: 'Looking at downloads',
  sites: 'Managing sites',
  settings: 'In settings',
  stats: 'Looking at reading stats'
}

/** Discord refuses text longer than 128 characters or shorter than 2. */
function fit(s: string | undefined): string | undefined {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length < 2) return undefined
  return t.length > 128 ? t.slice(0, 127) + '…' : t
}

/** A cover Discord can fetch itself: a plain https address that is not too long. */
function usableCover(u: string | undefined): string | undefined {
  return u && /^https:\/\//i.test(u) && u.length <= 256 ? u : undefined
}

export function activityFor(
  p: PresenceInput,
  mode: PresenceMode,
  since: number
): DiscordActivity | null {
  if (mode === 'off') return null
  const reading = p.screen === 'reader'
  const series = p.screen === 'series'
  const logo = { large_image: YOMI_LOGO, large_text: 'Yomi' }
  if (mode === 'app' || !(reading || series) || !fit(p.title)) {
    return {
      details: reading
        ? 'Reading manga'
        : series
          ? 'Choosing what to read'
          : (SCREEN_TEXT[p.screen] ?? 'Using Yomi'),
      timestamps: { start: since },
      assets: logo
    }
  }
  const cover = usableCover(p.cover)
  return {
    details: fit((reading ? 'Reading ' : 'Looking at ') + p.title),
    state: reading ? fit(p.chapter) : 'Picking a chapter',
    timestamps: { start: since },
    assets: cover
      ? { large_image: cover, large_text: fit(p.title), small_image: YOMI_LOGO, small_text: 'Yomi' }
      : logo
  }
}

/** The same thing on screen keeps its start time; a new series or chapter starts the clock again. */
export function presenceKey(p: PresenceInput, mode: PresenceMode): string {
  if (mode !== 'full') return p.screen === 'reader' ? 'reader' : p.screen
  return [p.screen, p.title ?? '', p.screen === 'reader' ? (p.chapter ?? '') : ''].join('|')
}

/** One message to Discord's local connection: opcode, length, then the JSON (little-endian). */
export function encodeFrame(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

/** Splits what arrived into whole messages; returns them and whatever is left over for next time. */
export function decodeFrames(buf: Buffer): {
  frames: { op: number; data: unknown }[]
  rest: Buffer
} {
  const frames: { op: number; data: unknown }[] = []
  let at = 0
  while (buf.length - at >= 8) {
    const op = buf.readInt32LE(at)
    const len = buf.readInt32LE(at + 4)
    if (buf.length - at - 8 < len) break
    const raw = buf.subarray(at + 8, at + 8 + len).toString('utf8')
    let data: unknown = null
    try {
      data = JSON.parse(raw)
    } catch {
      /* a broken message is skipped */
    }
    frames.push({ op, data })
    at += 8 + len
  }
  return { frames, rest: buf.subarray(at) }
}
