import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { copyFile, mkdir, readdir, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'

/** Problems reading or writing data files go to data-log.txt next to them. */
export let lastLogError = ''
export let lastReadError = ''
export function dataLog(path: string, m: string): void {
  const line = new Date().toISOString() + ' ' + m
  try {
    appendFileSync(join(dirname(path), 'data-log.txt'), line + '\n')
  } catch (e) {
    lastLogError = String((e as Error)?.message ?? e)
  }
  // a copy in the temp folder too: if the data folder's log can't be written, this one says so
  try {
    appendFileSync(join(tmpdir(), 'yomi-log.txt'), line + ' | ' + dirname(path) + (lastLogError ? ' | LOGERR ' + lastLogError : '') + '\n')
  } catch {
    /* no log */
  }
}

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
    // gone entirely (deleted, or a drive that wasn't there yet): the newest backup brings it back
    const b = readBackup<T>(path)
    if (b) {
      dataLog(path, 'file was missing: restored from backup ' + b.from)
      return b.value
    }
    return null
  }
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const v = JSON.parse(readFileSync(path, 'utf8')) as T
      unreadable.delete(path)
      backupSoon(path)
      return v
    } catch (e) {
      last = e
      lastReadError = String((e as Error)?.message ?? e)
      if (i < tries - 1) sleepSync(400)
    }
  }
  if (!unreadable.has(path)) {
    console.error('[data] could not read', path, last)
    let size = -1
    try {
      size = statSync(path).size
    } catch {
      /* gone */
    }
    dataLog(path, 'could not read ' + path + ' (' + size + ' bytes): ' + String((last as Error)?.message ?? last))
    // a copy of what is there now, in case the file itself is damaged (not just busy)
    let kept = false
    try {
      copyFileSync(path, path.replace(/\.json$/, '') + '.unreadable-' + Date.now() + '.json')
      kept = true
    } catch {
      /* busy: nothing to copy now */
    }
    // The file can be read but is broken (cut off, garbled): the newest backup replaces it. A file that is only busy
    // is never replaced (its newer data would be lost), and neither is a damaged one whose copy couldn't be kept.
    if (kept && last instanceof SyntaxError) {
      const b = readBackup<T>(path)
      if (b) {
        dataLog(path, 'file was damaged: restored from backup ' + b.from)
        unreadable.delete(path)
        return b.value
      }
    }
  }
  unreadable.add(path)
  return null
}

/*
 * Backups: once a day (about a minute after a file was read fine), each data file is copied to the "backups" folder
 * next to it, and the last few copies are kept. They are used when the file goes missing or is found damaged.
 */
const backedUp = new Set<string>()
const backupDir = (path: string): string => join(dirname(path), 'backups')
const stem = (path: string): string => basename(path).replace(/\.json$/, '')
const KEEP_BACKUPS = 3
const day = (): string => new Date().toISOString().slice(0, 10)

function backupSoon(path: string): void {
  if (backedUp.has(path) || !path.endsWith('.json')) return
  backedUp.add(path)
  setTimeout(() => {
    void (async () => {
      try {
        const size = (await stat(path)).size
        if (size < 8) return // nothing worth keeping
        await mkdir(backupDir(path), { recursive: true })
        const target = join(backupDir(path), stem(path) + '-' + day() + '.json')
        if (!existsSync(target)) {
          await copyFile(path, target + '.part')
          await rename(target + '.part', target)
        }
        const mine = (await readdir(backupDir(path))).filter((n) => n.startsWith(stem(path) + '-') && n.endsWith('.json')).sort()
        for (const n of mine.slice(0, Math.max(0, mine.length - KEEP_BACKUPS))) await unlink(join(backupDir(path), n)).catch(() => undefined)
      } catch (e) {
        dataLog(path, 'backup failed: ' + String((e as Error)?.message ?? e))
      }
    })()
  }, 60_000).unref?.()
}

/** The newest backup of a file that can be read, with the name it was read from. */
function readBackup<T>(path: string): { value: T; from: string } | null {
  try {
    const dir = backupDir(path)
    if (!existsSync(dir)) return null
    const names = readdirSync(dir)
      .filter((n) => n.startsWith(stem(path) + '-') && n.endsWith('.json'))
      .sort()
      .reverse()
    for (const n of names) {
      try {
        return { value: JSON.parse(readFileSync(join(dir, n), 'utf8')) as T, from: n }
      } catch {
        /* this one is damaged too: try the one before */
      }
    }
  } catch {
    /* no backups */
  }
  return null
}

/** For the catalog: the newest backup if the file in use holds nothing (an empty file can look fine and still be wrong). */
export function backupIfEmpty<T>(path: string, current: T, empty: (v: T) => boolean): T {
  if (!empty(current)) return current
  const b = readBackup<T>(path)
  if (b && !empty(b.value)) {
    dataLog(path, 'file held nothing: restored from backup ' + b.from)
    return b.value
  }
  return current
}

/** True while a file exists on disk but couldn't be read: whatever is in memory instead must not replace it. */
export function isUnreadable(path: string): boolean {
  return unreadable.has(path)
}

/**
 * Like writeAtomic, but the disk work happens in the background, so a big file (the catalog is ~80 MB) doesn't freeze
 * the app while it is written. Two writes of the same file never overlap: the newer one waits for the older one.
 */
const pending = new Map<string, Promise<void>>()
// Every write of a file gets the next number; a background write that finds a newer one already done leaves it alone.
const writeSeq = new Map<string, number>()
const nextSeq = (path: string): number => {
  const n = (writeSeq.get(path) ?? 0) + 1
  writeSeq.set(path, n)
  return n
}
export function writeAtomicAsync(path: string, text: string): Promise<void> {
  if (unreadable.has(path)) {
    console.error('[data] not saving over a file that could not be read:', path)
    return Promise.resolve()
  }
  const seq = nextSeq(path)
  const prev = pending.get(path) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      if (writeSeq.get(path) !== seq) return // a newer write already happened
      const tmp = path + '.tmp-bg'
      await writeFile(tmp, text)
      if (writeSeq.get(path) !== seq) return
      await rename(tmp, path)
    })
  pending.set(path, next)
  void next.finally(() => pending.get(path) === next && pending.delete(path)).catch(() => undefined)
  return next
}

/** Writes the whole file or nothing. Never writes over a file that couldn't be read (that would lose your data). */
export function writeAtomic(path: string, text: string): void {
  if (unreadable.has(path)) {
    console.error('[data] not saving over a file that could not be read:', path)
    return
  }
  nextSeq(path)
  const tmp = path + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}
