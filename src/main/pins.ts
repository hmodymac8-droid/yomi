import { app } from 'electron'
import { join } from 'path'
import { readJson, writeAtomic } from './safefile'
import { normalizeTitle } from './repair'

/**
 * The site you picked with "Read from" for a title. Fallback uses it first, and a repair never
 * overwrites it: when that site is down the chapter is read elsewhere for the moment, then the pin
 * is used again once the site answers.
 */
const file = (): string => join(app.getPath('userData'), 'site-pins.json')
let data: Record<string, string> | null = null

function load(): Record<string, string> {
  if (data) return data
  data = readJson<Record<string, string>>(file()) ?? {}
  return data
}

export function pinMap(): Record<string, string> {
  return load()
}

export function pinnedSite(title: string): string | undefined {
  const id = load()[normalizeTitle(title)]
  return id || undefined
}

export function pinSite(title: string, sourceId: string): void {
  const key = normalizeTitle(title)
  if (!key || !sourceId) return
  const all = load()
  if (all[key] === sourceId) return
  all[key] = sourceId
  try {
    writeAtomic(file(), JSON.stringify(all))
  } catch {
    /* the pin still applies until the app closes */
  }
}
