import { connect, type Socket } from 'net'
import { join } from 'path'
import { getSettings } from './settings'
import {
  activityFor,
  decodeFrames,
  encodeFrame,
  presenceKey,
  type PresenceInput,
  type PresenceMode
} from './discordLogic'

/*
 * Discord Rich Presence: "Playing Yomi" on your Discord profile, with what you are reading. It talks to the Discord
 * app on this computer through its local pipe (no library, nothing sent over the internet by Yomi). When Discord is
 * not running it tries again every 30 seconds, quietly.
 */

/**
 * The Discord application named "Yomi" (Discord shows its name: "Playing Yomi"). Public, not a secret.
 * Made in the Discord Developer Portal.
 */
const CLIENT_ID = '1571593772608004256'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

let sock: Socket | null = null
let ready = false
let retry: ReturnType<typeof setTimeout> | undefined
let sendTimer: ReturnType<typeof setTimeout> | undefined
let current: PresenceInput = { screen: 'browse' }
let key = ''
let since = Date.now()
let lastSent = ''
let started = false

export function presenceMode(): PresenceMode {
  const s = getSettings()
  if (s.discord === false) return 'off'
  return s.discordDetails === false ? 'app' : 'full'
}

function pipePath(n: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${n}`
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp'
  return join(dir, `discord-ipc-${n}`)
}

function later(ms = 30000): void {
  clearTimeout(retry)
  retry = setTimeout(open, ms)
}

function drop(): void {
  ready = false
  lastSent = ''
  sock?.destroy()
  sock = null
}

function open(n = 0): void {
  if (sock || !CLIENT_ID || presenceMode() === 'off') return
  const s = connect(pipePath(n))
  sock = s
  let buf: Buffer = Buffer.alloc(0)
  s.on('connect', () => s.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID })))
  s.on('data', (d: Buffer) => {
    const got = decodeFrames(Buffer.concat([buf, d]))
    buf = got.rest
    for (const f of got.frames) {
      if (f.op === OP_PING) s.write(encodeFrame(OP_PONG, f.data))
      else if (f.op === OP_CLOSE) {
        drop()
        later()
      } else if (f.op === OP_FRAME && (f.data as { evt?: string } | null)?.evt === 'READY') {
        ready = true
        send()
      }
    }
  })
  s.on('error', () => {
    if (sock !== s) return
    drop()
    // Discord uses the first free pipe of ten; when it is not running, none of them answer
    if (!ready && n < 9) open(n + 1)
    else later()
  })
  s.on('close', () => {
    if (sock !== s) return
    drop()
    later()
  })
}

function send(): void {
  if (!ready || !sock) return
  const activity = activityFor(current, presenceMode(), since)
  const body = JSON.stringify(activity)
  if (body === lastSent) return
  lastSent = body
  sock.write(
    encodeFrame(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`
    })
  )
}

/** Discord takes about one change every few seconds; quick screen changes are sent as one. */
function sendSoon(): void {
  clearTimeout(sendTimer)
  sendTimer = setTimeout(send, 1500)
}

/** The window reports the screen it shows. */
export function setPresence(p: PresenceInput): void {
  current = p
  const k = presenceKey(p, presenceMode())
  if (k !== key) {
    key = k
    since = Date.now()
  }
  sendSoon()
}

/** Settings changed: turn it on or off, or show more or less. */
export function presenceSettingsChanged(): void {
  if (!started) return
  if (presenceMode() === 'off') {
    drop() // Discord takes it off your profile as soon as the connection closes
    clearTimeout(retry)
    return
  }
  key = presenceKey(current, presenceMode())
  if (sock) sendSoon()
  else open()
}

export function startPresence(): void {
  if (started) return
  started = true
  open()
}

export function stopPresence(): void {
  clearTimeout(retry)
  clearTimeout(sendTimer)
  drop()
}
