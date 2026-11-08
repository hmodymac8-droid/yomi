import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  prefetchSeries: (sourceId: string, url: string) => ipcRenderer.invoke('prefetch-series', sourceId, url),
  onSeriesPartial: (cb: (d: unknown) => void) => {
    const h = (_e: unknown, d: unknown): void => cb(d)
    ipcRenderer.on('series-partial', h)
    return () => ipcRenderer.removeListener('series-partial', h)
  },
  onDetect: (cb: (msg: string) => void) => {
    const h = (_e: unknown, m: string): void => cb(m)
    ipcRenderer.on('detect-progress', h)
    return () => ipcRenderer.removeListener('detect-progress', h)
  },
  enrich: (urls: string[]) => ipcRenderer.invoke('enrich', urls),
  followList: () => ipcRenderer.invoke('follow-list'),
  followGet: (seriesUrl: string) => ipcRenderer.invoke('follow-get', seriesUrl),
  followSet: (meta: unknown, following: boolean) => ipcRenderer.invoke('follow-set', meta, following),
  followCategory: (seriesUrl: string, category: string) => ipcRenderer.invoke('follow-category', seriesUrl, category),
  followDismiss: (seriesUrl: string) => ipcRenderer.invoke('follow-dismiss', seriesUrl),
  updatesCheck: () => ipcRenderer.invoke('updates-check'),
  updatesStatus: () => ipcRenderer.invoke('updates-status'),
  updatesSetAutoDownload: (on: boolean) => ipcRenderer.invoke('updates-auto-download', on),
  onUpdates: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('updates-changed', h)
    return () => ipcRenderer.removeListener('updates-changed', h)
  },
  getSeriesCached: (url: string) => ipcRenderer.invoke('get-series-cached', url),
  prefetchChapter: (url: string) => ipcRenderer.invoke('prefetch-chapter', url),
  downloadEnqueue: (reqs: unknown) => ipcRenderer.invoke('dl-enqueue', reqs),
  downloadList: () => ipcRenderer.invoke('dl-list'),
  downloadGet: (chapterUrl: string) => ipcRenderer.invoke('dl-get', chapterUrl),
  downloadCancel: (id: string) => ipcRenderer.invoke('dl-cancel', id),
  downloadGetConcurrency: () => ipcRenderer.invoke('download-get-concurrency'),
  downloadSetConcurrency: (n: number) => ipcRenderer.invoke('download-set-concurrency', n),
  downloadRemoveMany: (ids: string[]) => ipcRenderer.invoke('download-remove-many', ids),
  titleAdd: (url: string) => ipcRenderer.invoke('title-add', url),
  windowControl: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('window-control', action),
  genreStatus: () => ipcRenderer.invoke('genre-status'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  onUpdateReady: (cb: (u: { version: string }) => void) => {
    const h = (_e: unknown, u: { version: string }): void => cb(u)
    ipcRenderer.on('update-ready', h)
    return () => ipcRenderer.removeListener('update-ready', h)
  },
  genreScanNow: (id: string) => ipcRenderer.invoke('genre-scan-now', id),
  genreJobs: () => ipcRenderer.invoke('genre-jobs'),
  titleList: () => ipcRenderer.invoke('title-list'),
  titleRemove: (url: string) => ipcRenderer.invoke('title-remove', url),
  titleImport: (list: unknown[]) => ipcRenderer.invoke('title-import', list),
  downloadGetPaused: () => ipcRenderer.invoke('download-get-paused'),
  downloadSetPaused: (on: boolean) => ipcRenderer.invoke('download-set-paused', on),
  offlineGet: () => ipcRenderer.invoke('offline-get'),
  offlineSet: (on: boolean) => ipcRenderer.invoke('offline-set', on),
  downloadExportCbz: (ids: string[]) => ipcRenderer.invoke('download-export-cbz', ids),
  downloadRemove: (id: string) => ipcRenderer.invoke('dl-remove', id),
  onDownload: (cb: (i: unknown) => void) => {
    const h = (_e: unknown, i: unknown): void => cb(i)
    ipcRenderer.on('dl-progress', h)
    return () => ipcRenderer.removeListener('dl-progress', h)
  },
  progressGet: (seriesUrl: string) => ipcRenderer.invoke('progress-get', seriesUrl),
  progressSave: (p: unknown) => ipcRenderer.invoke('progress-save', p),
  progressRecent: (limit: number) => ipcRenderer.invoke('progress-recent', limit),
  siteHealth: () => ipcRenderer.invoke('site-health'),
  siteCheck: (id) => ipcRenderer.invoke('site-check', id),
  progressHide: (seriesUrl: string) => ipcRenderer.invoke('progress-hide', seriesUrl),
  grabChapter: (url: string) => ipcRenderer.invoke('grab-chapter', url),
  listSources: () => ipcRenderer.invoke('list-sources'),
  addSite: (url: string) => ipcRenderer.invoke('add-site', url),
  removeSite: (id: string) => ipcRenderer.invoke('remove-site', id),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings-set', patch),
  crawl: (id: string) => ipcRenderer.invoke('crawl', id),
  cancelCrawl: (id: string) => ipcRenderer.invoke('cancel-crawl', id),
  search: (q: string, sourceIds: string[], sort: string, offset: number, limit: number, kind?: string, genre?: string) =>
    ipcRenderer.invoke('search', q, sourceIds, sort, offset, limit, kind, genre),
  getSeries: (sourceId: string, url: string, mode?: string) => ipcRenderer.invoke('get-series', sourceId, url, mode),
  onProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown): void => cb(p)
    ipcRenderer.on('crawl-progress', h)
    return () => ipcRenderer.removeListener('crawl-progress', h)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
