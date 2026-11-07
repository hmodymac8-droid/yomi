import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'

/*
 * Updates come from the GitHub releases of hmodymac8-droid/yomi. The installed app checks at startup and every
 * few hours, downloads a newer version in the background, and tells the window it is ready. "Restart" installs it
 * now; otherwise it is installed the next time Yomi is closed. Nothing happens while developing.
 */
let ready: { version: string } | null = null

function tell(channel: string, data: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, data)
}

export function startAutoUpdates(): void {
  ipcMain.handle('update-status', () => ready)
  ipcMain.handle('update-install', () => {
    if (ready) electronUpdater.autoUpdater.quitAndInstall(false, true)
  })
  if (!app.isPackaged) return
  const updater = electronUpdater.autoUpdater
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('update-downloaded', (info) => {
    ready = { version: info.version }
    tell('update-ready', ready)
  })
  updater.on('error', (e) => console.error('[update]', e?.message ?? e))
  const check = (): void => void updater.checkForUpdates().catch(() => undefined)
  setTimeout(check, 15000)
  setInterval(check, 4 * 60 * 60 * 1000)
}
