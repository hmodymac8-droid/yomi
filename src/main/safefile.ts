import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'

/** Writes the whole file or nothing: a crash or a second reader never sees half a file. */
export function writeAtomic(path: string, text: string): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

/**
 * Reads a JSON file. If it exists but can't be read, a copy is kept next to it (name.broken-<time>.json) before the
 * app carries on, so whatever it saves next can never cost you the old data.
 */
export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (e) {
    try {
      copyFileSync(path, path.replace(/\.json$/, '') + '.broken-' + Date.now() + '.json')
    } catch {
      /* nothing more we can do */
    }
    console.error('[data] could not read', path, e)
    return null
  }
}
