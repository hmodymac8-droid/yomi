import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'

/*
 * Your data files are read and written only through here.
 *
 * Right after Yomi is installed or updated, Windows (its virus scan, for one) can hold a data file busy for a moment.
 * Reading it then used to fail, Yomi started with an empty catalog, and the next save wrote that empty catalog over
 * the real one. Now: a busy file is retried for a few seconds; a file that still can't be read is never written over
 * (so nothing is lost), and it is read again on the next use, so the real data comes back by itself.
 */

const unreadable = new Set<string>()

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Reads a JSON file. Missing file: null. A file that exists but can't be read or parsed is tried `tries` times
 * (400 ms apart); if it still fails, null is returned and the file is marked unreadable (see writeAtomic).
 */
export function readJson<T>(path: string, tries = 8): T | null {
  if (!existsSync(path)) {
    unreadable.delete(path)
    return null
  }
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const v = JSON.parse(readFileSync(path, 'utf8')) as T
      unreadable.delete(path)
      return v
    } catch (e) {
      last = e
      if (i < tries - 1) sleepSync(400)
    }
  }
  if (!unreadable.has(path)) {
    console.error('[data] could not read', path, last)
    // a copy of what is there now, in case the file itself is damaged (not just busy)
    try {
      copyFileSync(path, path.replace(/\.json$/, '') + '.unreadable-' + Date.now() + '.json')
    } catch {
      /* busy: nothing to copy now */
    }
  }
  unreadable.add(path)
  return null
}

/** True while a file exists on disk but couldn't be read: whatever is in memory instead must not replace it. */
export function isUnreadable(path: string): boolean {
  return unreadable.has(path)
}

/** Writes the whole file or nothing. Never writes over a file that couldn't be read (that would lose your data). */
export function writeAtomic(path: string, text: string): void {
  if (unreadable.has(path)) {
    console.error('[data] not saving over a file that could not be read:', path)
    return
  }
  const tmp = path + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}
