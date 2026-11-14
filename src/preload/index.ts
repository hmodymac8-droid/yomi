import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const isMini = process.argv.includes('--yomi-mini')

// Custom APIs for renderer
const api = {
  prefetchSeries: (sourceId: string, url: string) =>
    ipcRenderer.invoke('prefetch-series', sourceId, url),
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
  followSet: (meta: unknown, following: boolean) =>
    ipcRenderer.invoke('follow-set', meta, following),
  followCategory: (seriesUrl: string, category: string) =>
    ipcRenderer.invoke('follow-category', seriesUrl, category),
  followDismiss: (seriesUrl: string) => ipcRenderer.invoke('follow-dismiss', seriesUrl),
  followAutoDownload: (seriesUrl: string, on: boolean | undefined) =>
    ipcRenderer.invoke('follow-autodl', seriesUrl, on),
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
  windowControl: (action: 'minimize' | 'maximize' | 'close') =>
    ipcRenderer.send('window-control', action),
  genreStatus: () => ipcRenderer.invoke('genre-status'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  onUpdateReady: (cb: (u: { version: string }) => void) => {
    const h = (_e: unknown, u: { version: string }): void => cb(u)
    ipcRenderer.on('update-ready', h)
    return () => ipcRenderer.removeListener('update-ready', h)
  },
  appUpdateState: () => ipcRenderer.invoke('app-update-state'),
  appUpdateCheck: () => ipcRenderer.invoke('app-update-check'),
  onAppUpdateState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('app-update-state', h)
    return () => ipcRenderer.removeListener('app-update-state', h)
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
  sourceState: (id: string) => ipcRenderer.invoke('source-state', id),
  sourceFailed: (id: string, message: string) => ipcRenderer.invoke('source-failed', id, message),
  fallbackSites: (title: string, excludeIds: string[]) =>
    ipcRenderer.invoke('fallback-sites', title, excludeIds),
  statsTime: (ms: number) => ipcRenderer.invoke('stats-time', ms),
  statsGet: () => ipcRenderer.invoke('stats-get'),
  mihonImport: () => ipcRenderer.invoke('mihon-import'),
  onMihonProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown): void => cb(p)
    ipcRenderer.on('mihon-progress', h)
    return () => ipcRenderer.removeListener('mihon-progress', h)
  },
  recsSimilar: (title: string, seriesUrl?: string) => ipcRenderer.invoke('recs-similar', title, seriesUrl),
  recsBecause: () => ipcRenderer.invoke('recs-because'),
  fillGaps: (title: string, sourceId: string, chapters: unknown[]) =>
    ipcRenderer.invoke('fill-gaps', title, sourceId, chapters),
  pinSite: (title: string, sourceId: string) => ipcRenderer.invoke('pin-site', title, sourceId),
  pinnedSite: (title: string) => ipcRenderer.invoke('pinned-site', title),
  listSources: () => ipcRenderer.invoke('list-sources'),
  clientLog: (m: string) => ipcRenderer.send('client-log', m),
  catalogDiagnose: () => ipcRenderer.invoke('catalog-diagnose') as Promise<string>,
  restartApp: () => ipcRenderer.invoke('restart-app') as Promise<boolean>,
  catalogTrouble: () => ipcRenderer.invoke('catalog-trouble') as Promise<boolean>,
  addSite: (url: string) => ipcRenderer.invoke('add-site', url),
  removeSite: (id: string) => ipcRenderer.invoke('remove-site', id),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings-set', patch),
  pageBytes: (src: string) => ipcRenderer.invoke('page-bytes', src),
  crawl: (id: string) => ipcRenderer.invoke('crawl', id),
  cancelCrawl: (id: string) => ipcRenderer.invoke('cancel-crawl', id),
  search: (
    q: string,
    sourceIds: string[],
    sort: string,
    offset: number,
    limit: number,
    kind?: string,
    genre?: string
  ) => ipcRenderer.invoke('search', q, sourceIds, sort, offset, limit, kind, genre),
  getSeries: (sourceId: string, url: string, mode?: string) =>
    ipcRenderer.invoke('get-series', sourceId, url, mode),
  onProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown): void => cb(p)
    ipcRenderer.on('crawl-progress', h)
    return () => ipcRenderer.removeListener('crawl-progress', h)
  },
  anilistStatus: () => ipcRenderer.invoke('anilist-status'),
  anilistSetClientId: (id: string) => ipcRenderer.invoke('anilist-set-client-id', id),
  anilistConnect: () => ipcRenderer.invoke('anilist-connect'),
  anilistDisconnect: () => ipcRenderer.invoke('anilist-disconnect'),
  anilistSearch: (title: string) => ipcRenderer.invoke('anilist-search', title),
  anilistLink: (seriesUrl: string, media: unknown) => ipcRenderer.invoke('anilist-link', seriesUrl, media),
  anilistUnlink: (seriesUrl: string) => ipcRenderer.invoke('anilist-unlink', seriesUrl),
  anilistLinkFor: (seriesUrl: string) => ipcRenderer.invoke('anilist-link-for', seriesUrl),
  anilistImport: () => ipcRenderer.invoke('anilist-import'),
  extensionsOverview: () => ipcRenderer.invoke('extensions-overview'),
  extensionsAddRepo: (url: string) => ipcRenderer.invoke('extensions-add-repo', url),
  extensionsRemoveRepo: (url: string) => ipcRenderer.invoke('extensions-remove-repo', url),
  extensionsInstall: (url: string, sha256: string) =>
    ipcRenderer.invoke('extensions-install', url, sha256),
  extensionsRemove: (id: string) => ipcRenderer.invoke('extensions-remove', id),
  extensionsSetEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('extensions-set-enabled', id, enabled),
  isMini,
  miniOpen: (session: unknown) => ipcRenderer.invoke('mini-open', session),
  miniUpdate: (session: unknown) => ipcRenderer.invoke('mini-update', session),
  miniClose: () => ipcRenderer.invoke('mini-close'),
  miniGet: () => ipcRenderer.invoke('mini-get'),
  miniIs: () => ipcRenderer.invoke('mini-is'),
  miniFocus: () => ipcRenderer.invoke('mini-focus'),
  miniReturn: () => ipcRenderer.invoke('mini-return'),
  miniSetPinned: (on: boolean) => ipcRenderer.invoke('mini-pin', on),
  onMiniSession: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('mini-session', h)
    return () => ipcRenderer.removeListener('mini-session', h)
  },
  onMiniOpened: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('mini-opened', h)
    return () => ipcRenderer.removeListener('mini-opened', h)
  },
  onMiniClosed: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('mini-closed', h)
    return () => ipcRenderer.removeListener('mini-closed', h)
  },
  onMiniReturn: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('mini-return', h)
    return () => ipcRenderer.removeListener('mini-return', h)
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
