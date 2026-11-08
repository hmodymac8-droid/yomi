import { app } from 'electron'
import { join } from 'path'
import { readJson, writeAtomic } from './safefile'

/**
 * Settings from the Settings screen, saved in app-settings.json.
 *
 * showLibrary: show the sites of the Yomi Library (the ready-made sites, titles and genres that come from your Yomi
 * account) on Discover, in search and on the Sites screen. Hiding them keeps everything saved; showing them again
 * brings them straight back.
 */
export interface AppSettings {
  showLibrary: boolean
}

const DEFAULTS: AppSettings = { showLibrary: true }
const file = (): string => join(app.getPath('userData'), 'app-settings.json')
let cache: AppSettings | null = null
let version = 0

export function getSettings(): AppSettings {
  if (!cache) cache = { ...DEFAULTS, ...(readJson<Partial<AppSettings>>(file()) ?? {}) }
  return cache
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  cache = { ...getSettings(), ...patch }
  writeAtomic(file(), JSON.stringify(cache))
  version++
  return cache
}

/** Changes whenever a setting changes (search results that depend on settings are worked out again). */
export function settingsVersion(): number {
  return version
}
