import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdateState } from '../preload/index.d'

/*
 * Updates come from the GitHub releases of hmodymac8-droid/yomi. The installed app checks at startup and every
 * few hours (or when "Check for updates" is pressed in Settings), downloads a newer version in the background,
 * and tells the window it is ready. "Restart" installs it now; otherwise it is installed the next time Yomi is
 * closed. Nothing is checked while developing.
 */
let ready: { version: string } | null = null
let status: AppUpdateState = { state: 'idle', current: app.getVersion() }
let checking: Promise<void> | null = null

function tell(channel: string, data: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, data)
}

function set(next: AppUpdateState): void {
  status = { ...next, checkedAt: next.checkedAt ?? status.checkedAt }
  tell('app-update-state', status)
}

/** Short, readable reason for a failed check (the raw message can be a whole HTTP dump). */
function reason(e: unknown): string {
  const m = String((e as Error)?.message ?? e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|net::/i.test(m)) return 'No connection to GitHub.'
  if (/\b(403|429)\b/.test(m)) return 'GitHub is busy right now. Try again in a few minutes.'
  if (/\b404\b/.test(m)) return 'No published release found.'
  return m.split('\n')[0].slice(0, 160)
}

export function startAutoUpdates(): void {
  ipcMain.handle('update-status', () => ready)
  ipcMain.handle('update-install', () => {
    if (ready) electronUpdater.autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.handle('app-update-state', () => status)
  ipcMain.handle('app-update-check', async () => {
    await check()
    return status
  })
  if (!app.isPackaged) {
    status = { state: 'dev', current: app.getVersion() }
    return
  }
  const updater = electronUpdater.autoUpdater
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => {
    if (!ready && status.state !== 'downloading') set({ state: 'checking', current: app.getVersion() })
  })
  updater.on('update-not-available', () =>
    set({ state: 'none', current: app.getVersion(), checkedAt: Date.now() })
  )
  updater.on('update-available', (info) =>
    set({ state: 'downloading', current: app.getVersion(), version: info.version, percent: 0, checkedAt: Date.now() })
  )
  updater.on('download-progress', (p) => {
    if (status.state === 'downloading')
      set({ ...status, percent: Math.max(0, Math.min(100, Math.round(p.percent))) })
  })
  updater.on('update-downloaded', (info) => {
    ready = { version: info.version }
    set({ state: 'ready', current: app.getVersion(), version: info.version })
    tell('update-ready', ready)
  })
  updater.on('error', (e) => {
    console.error('[update]', e?.message ?? e)
    if (!ready) set({ state: 'error', current: app.getVersion(), error: reason(e), checkedAt: Date.now() })
  })
  setTimeout(() => void check(), 15000)
  setInterval(() => void check(), 4 * 60 * 60 * 1000)
}

/** One check at a time; a check while a download is running or an update is waiting changes nothing. */
function check(): Promise<void> {
  if (!app.isPackaged || ready || status.state === 'downloading') return Promise.resolve()
  if (!checking) {
    checking = electronUpdater.autoUpdater
      .checkForUpdates()
      .then(() => undefined)
      .catch((e) => {
        if (!ready) set({ state: 'error', current: app.getVersion(), error: reason(e), checkedAt: Date.now() })
      })
      .finally(() => {
        checking = null
      })
  }
  return checking
}
