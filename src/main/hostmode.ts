import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

/**
 * Per site and task, remember whether plain HTTP + HTML parsing gives the same answer as the
 * real browser ('static'), or whether the site needs the browser ('browser').
 * Keys look like "example.com|chapter", "example.com|series", "example.com|list".
 */
export type Mode = 'static' | 'light' | 'browser'

let data: Record<string, Mode> | null = null
let timer: NodeJS.Timeout | undefined

const file = (): string => join(app.getPath('userData'), 'hostmode.json')

// Bump when the way "fast" and "browser" are compared changes: older verdicts may have been wrong.
const VERDICT_VERSION = 3

function load(): Record<string, Mode> {
  if (data) return data
  try {
    if (existsSync(file())) data = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    data = null
  }
  data ??= {}
  const rec = data as unknown as Record<string, unknown>
  if (rec['__v'] !== VERDICT_VERSION) {
    // Series verdicts from before the page-finished-loading fix could have locked in half-loaded lists as "correct".
    for (const k of Object.keys(rec)) if (k.endsWith('|series')) delete rec[k]
    rec['__v'] = VERDICT_VERSION
  }
  return data
}

export function getMode(key: string): Mode | undefined {
  // Dev/benchmark override: MR_FORCE_MODE=browser|static
  const forced = process.env['MR_FORCE_MODE']
  if (forced === 'browser' || forced === 'static' || forced === 'light') return forced
  return load()[key]
}

export function flushModes(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  if (!data) return
  try {
    writeFileSync(file(), JSON.stringify(data))
  } catch {
    /* not critical */
  }
}

export function setMode(key: string, mode: Mode): void {
  if (process.env['MR_FORCE_MODE']) return
  load()[key] = mode
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushModes, 500)
}
