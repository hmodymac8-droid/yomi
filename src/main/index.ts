import { app, dialog, shell, BrowserWindow, ipcMain, net, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { closeWarm, ensureSession, hiddenWindow, loadPage, probeLinks, refererHints, warmUp } from './grabber'
import { installImageProxy, registerImageScheme } from './imageProxy'
import {
  addSource,
  cancelCrawl,
  crawlSource,
  debugSaveCost,
  debugTrimSeries,
  enrichEntries,
  flushSeriesCache,
  getSeries,
  getSource,
  getSeriesCached,
  listSources,
  openSeries,
  prefetchSeries,
  setSeriesPartialEmitter,
  primeNetwork,
  removeSource,
  scanDue,
  search,
  sourcesWithChapterTitles
} from './catalog'
import { allHealth, dropHealth, flushHealth, healthOf, recordCheck, recordOpen } from './health'
import type { HealthStep } from '../preload/index.d'
import { grabChapterFast, prefetchChapter, settleVerifications } from './fastgrab'
import { flushModes } from './hostmode'
import { detectSource } from './sources'
import { flushProgress, getProgress, hideProgress, recentProgress, saveProgress } from './progress'
import type { CrawlProgress, DownloadRequest, FollowCategory, FollowMeta, ProgressPatch } from '../preload/index.d'
import {
  autoFollow,
  checkAll,
  debugForget,
  dismissNew,
  flushUpdates,
  getFollow,
  listFollows,
  setAutoDownload,
  setCategory,
  setFollow,
  startUpdateScheduler,
  updateStatus
} from './updates'
import {
  cancelDownload,
  enqueueDownloads,
  flushDownloads,
  getConcurrency,
  getDownload,
  listDownloads,
  removeDownload,
  removeDownloads,
  isPaused,
  setPaused,
  isOffline,
  setOffline,
  offlineSeries,
  exportCbz,
  resumeDownloads,
  setConcurrency,
  setDownloadEmitter
} from './downloads'

// A background task that fails must never take the app down or pop up an error box: log it and carry on.
process.on('uncaughtException', (e) => console.error('[uncaught]', e))
process.on('unhandledRejection', (e) => console.error('[unhandled rejection]', e))

// Dev/test runs (any MR_* variable) get their own throw-away data folder, so they never touch your catalog,
// reading progress or caches, and never fight a running copy of the app over the same files.
if (Object.keys(process.env).some((k) => k.startsWith('MR_'))) {
  // (MR_DATADIR lets several test runs go side by side, each with its own folder)
  app.setPath('userData', join(app.getPath('temp'), 'manga-reader-devtest' + (process.env['MR_DATADIR'] ?? '')))
}

registerImageScheme()

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  // The spare hidden window must not keep the app alive after you close the main window.
  mainWindow.on('closed', closeWarm)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const checking = new Map<string, Promise<void>>()

/**
 * Tests one site end to end like you would use it: its title list, a chapter list, a chapter's pages, one image.
 * Result is saved (site-health.json) and shown on the Sites screen.
 */
async function runSiteCheck(id: string): Promise<void> {
  const src = getSource(id)
  if (!src) return
  const steps: HealthStep[] = []
  const step = async (name: string, fn: () => Promise<{ status: HealthStep['status']; detail: string }>): Promise<boolean> => {
    const t = Date.now()
    try {
      const r = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('took longer than 60 s')), 60000))])
      steps.push({ name, status: r.status, detail: r.detail, ms: Date.now() - t })
      return r.status !== 'fail'
    } catch (e) {
      steps.push({ name, status: 'fail', detail: (e instanceof Error ? e.message : String(e)).slice(0, 140), ms: Date.now() - t })
      return false
    }
  }
  let hits: ReturnType<typeof search>['hits'] = []
  let chapters: { title: string; url: string }[] = []
  let seriesUrl = ''
  let pages: string[] = []
  let go = await step('Title list', async () => {
    hits = search('', [id], 'site', 0, 30).hits
    if (hits.length === 0) return { status: 'fail', detail: 'No titles saved for this site. Try "Re-scan titles".' }
    const total = listSources().find((x) => x.id === id)?.count ?? hits.length
    return { status: 'ok', detail: total.toLocaleString() + ' titles saved' }
  })
  if (go)
    go = await step('Chapter list', async () => {
      let bestIncomplete = false
      // up to 3 series: some are short or new, so judge by the best one
      for (const h of hits.slice(0, 3)) {
        try {
          const d = await getSeries(id, h.entries[0].url)
          if (d.chapters.length > chapters.length) {
            chapters = d.chapters
            seriesUrl = h.entries[0].url
            bestIncomplete = !!d.incomplete
          }
          if (chapters.length >= 8 && !bestIncomplete) break
        } catch {
          /* try the next one */
        }
      }
      if (chapters.length === 0) return { status: 'fail', detail: 'No chapters found on the 3 series tried' }
      if (bestIncomplete) return { status: 'warn', detail: chapters.length + ' chapters, but the list looks cut short or has gaps' }
      return { status: 'ok', detail: chapters.length + ' chapters on the best of up to 3 series' }
    })
  if (go)
    go = await step('Chapter pages', async () => {
      const g = await grabChapterFast(chapters[0].url)
      pages = g.pages
      if (pages.length === 0) return { status: 'fail', detail: 'The newest chapter gave no pages' }
      if (pages.length < 4) return { status: 'warn', detail: 'Only ' + pages.length + ' pages in the newest chapter (may be correct)' }
      return { status: 'ok', detail: pages.length + ' pages in the newest chapter' }
    })
  if (go)
    await step('Image', async () => {
      const ses = session.fromPartition('persist:sources')
      ensureSession()
      refererHints.set(pages[0], new URL(seriesUrl).origin + '/')
      try {
        const r = await ses.fetch(pages[0])
        const buf = await r.arrayBuffer()
        const type = (r.headers.get('content-type') ?? '').split(';')[0]
        if (!r.ok || !type.startsWith('image/') || buf.byteLength < 5000)
          return { status: 'fail', detail: 'First page did not download (HTTP ' + r.status + ', ' + (type || 'no type') + ')' }
        return { status: 'ok', detail: 'First page downloaded (' + Math.round(buf.byteLength / 1024) + ' KB)' }
      } finally {
        refererHints.delete(pages[0])
      }
    })
  const overall = steps.some((x) => x.status === 'fail') ? 'fail' : steps.some((x) => x.status === 'warn') ? 'warn' : 'ok'
  recordCheck(id, { at: Date.now(), overall, steps })
}

/**
 * A site added from its sitemap alone starts working right away. This finishes the job in the background: it works
 * out the site's list pages (for covers and titles), then restarts the scan with them.
 */
async function refineSource(id: string, emit: (p: CrawlProgress) => void): Promise<void> {
  try {
    const cur = getSource(id)
    if (!cur) return
    const full = await detectSource(cur.baseUrl) // the slower, complete detection
    // two scans of one site never run at once: let the sitemap import finish first
    while (listSources().find((s) => s.id === id)?.crawling) await new Promise((r) => setTimeout(r, 2000))
    addSource({ ...full, sitemaps: cur.sitemaps ?? full.sitemaps, needsRefine: false })
    if (full.maxPages > 0) void crawlSource(id, emit)
  } catch {
    // couldn't work out its list pages: the sitemap alone has to do
    const cur = getSource(id)
    if (cur) addSource({ ...cur, needsRefine: false })
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  installImageProxy()

  const emit = (p: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('crawl-progress', p)
  }
  const wrap = async <T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  ipcMain.handle('list-sources', () => listSources())
  ipcMain.handle('add-site', (_e, url: string) =>
    wrap(async () => {
      let u = url.trim()
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u
      new URL(u) // throws on garbage
      const def = await detectSource(
        u,
        (msg) => {
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send('detect-progress', msg)
        },
        { quick: true }
      )
      const info = addSource(def)
      void crawlSource(def.id, emit)
      if (def.needsRefine) void refineSource(def.id, emit)
      return info
    })
  )
  setDownloadEmitter((item) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('dl-progress', item)
  })
  ipcMain.handle('dl-enqueue', (_e, reqs: DownloadRequest[]) => enqueueDownloads(reqs))
  ipcMain.handle('dl-list', () => listDownloads())
  ipcMain.handle('dl-get', (_e, url: string) => getDownload(url))
  ipcMain.handle('dl-cancel', (_e, id: string) => cancelDownload(id))
  ipcMain.handle('dl-remove', (_e, id: string) => removeDownload(id))
  resumeDownloads()

  ipcMain.handle('progress-get', (_e, seriesUrl: string) => getProgress(seriesUrl))
  ipcMain.handle('progress-save', (_e, p: ProgressPatch) => {
    saveProgress(p)
    // reading a series follows it (so you hear about its new chapters)
    autoFollow({ seriesUrl: p.seriesUrl, sourceId: p.sourceId, title: p.title, cover: p.cover, coverReferer: p.coverReferer })
  })
  ipcMain.handle('follow-list', () => listFollows())
  ipcMain.handle('follow-get', (_e, url: string) => getFollow(url))
  ipcMain.handle('follow-set', (_e, meta: FollowMeta, following: boolean) => setFollow(meta, following))
  ipcMain.handle('follow-dismiss', (_e, url: string) => dismissNew(url))
  ipcMain.handle('follow-category', (_e, url: string, category: FollowCategory) => setCategory(url, category))
  ipcMain.handle('updates-check', () => checkAll(true))
  ipcMain.handle('updates-status', () => updateStatus())
  ipcMain.handle('updates-auto-download', (_e, on: boolean) => setAutoDownload(on))
  startUpdateScheduler()
  ipcMain.handle('progress-recent', (_e, limit: number) => recentProgress(limit))
  ipcMain.handle('progress-hide', (_e, seriesUrl: string) => hideProgress(seriesUrl))
  ipcMain.handle('remove-site', (_e, id: string) => {
    removeSource(id)
    dropHealth(id)
  })
  ipcMain.handle('site-health', () => allHealth())
  ipcMain.handle('site-check', async (_e, id: string) => {
    // one check per site at a time: a second click joins the first
    if (!checking.has(id)) checking.set(id, runSiteCheck(id).finally(() => checking.delete(id)))
    await checking.get(id)
    return healthOf(id)
  })
  ipcMain.handle('crawl', (_e, id: string) => void crawlSource(id, emit))
  ipcMain.handle('cancel-crawl', (_e, id: string) => cancelCrawl(id))
  ipcMain.handle('search', (_e, q: string, sourceIds: string[], sort: 'site' | 'az', offset: number, limit: number) =>
    search(q, sourceIds, sort, offset, limit)
  )
  // Nothing the screens wait for may hang forever: give up with a clear message instead.
  const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} took too long. Try again in a moment.`)), ms))
    ])
  ipcMain.handle('get-series', (_e, sourceId: string, url: string, mode?: 'auto' | 'check' | 'full') =>
    wrap(async () => {
      if (isOffline()) {
        const off = offlineSeries(url)
        if (off) return off
        throw new Error('Offline mode is on and nothing from this series is saved on this computer.')
      }
      try {
        const d = await withTimeout(openSeries(sourceId, url, mode), 60000, 'Loading the chapter list')
        recordOpen(sourceId, d.chapters.length === 0 ? 'failed' : d.incomplete ? 'incomplete' : 'ok', d.chapters.length === 0 ? 'No chapters found' : undefined)
        return d
      } catch (e) {
        recordOpen(sourceId, 'failed', e instanceof Error ? e.message : String(e))
        const off = offlineSeries(url) // the site can't be reached: show what is saved
        if (off) return off
        throw e
      }
    })
  )
  ipcMain.handle('get-series-cached', (_e, url: string) => getSeriesCached(url))
  ipcMain.handle('prefetch-series', (_e, sourceId: string, url: string) => void prefetchSeries(sourceId, url))
  setSeriesPartialEmitter((d) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('series-partial', d)
  })
  ipcMain.handle('enrich', (_e, urls: string[]) => enrichEntries(urls))
  ipcMain.handle('download-get-concurrency', () => getConcurrency())
  ipcMain.handle('download-set-concurrency', (_e, n: number) => setConcurrency(n))
  ipcMain.handle('download-remove-many', (_e, ids: string[]) => removeDownloads(ids))
  ipcMain.handle('download-get-paused', () => isPaused())
  ipcMain.handle('download-set-paused', (_e, on: boolean) => setPaused(!!on))
  ipcMain.handle('offline-get', () => isOffline())
  ipcMain.handle('offline-set', (_e, on: boolean) => setOffline(!!on))
  ipcMain.handle('download-export-cbz', async (_e, ids: string[]) => {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder for the .cbz files', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    const out = await exportCbz(ids, r.filePaths[0])
    void shell.openPath(r.filePaths[0])
    return out
  })
  ipcMain.handle('prefetch-chapter', (_e, url: string) => prefetchChapter(url))

  ipcMain.handle('grab-chapter', async (_e, url: string) => {
    try {
      return { ok: true as const, data: await withTimeout(grabChapterFast(url), 60000, 'Opening the chapter') }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  if (process.env['MR_PROBE']) {
    probeLinks(process.env['MR_PROBE'])
      .then((r) => console.log('PROBE_RESULT ' + JSON.stringify({ title: r.title, status: r.status, n: r.links.length, links: r.links.slice(0, 400) })))
      .catch((e) => console.log('PROBE_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_CRAWL=<site url>[,maxPages] detects the site, crawls a few pages, prints a summary.
  if (process.env['MR_CRAWL']) {
    const [site, max] = process.env['MR_CRAWL'].split(',')
    ;(async () => {
      warmUp() // like the real app, which keeps a spare window ready
      await new Promise((r) => setTimeout(r, 2500))
      const tDetect = Date.now()
      const def = await detectSource(site)
      console.log('DETECTED ' + JSON.stringify({ detectMs: Date.now() - tDetect, tpl: def.listTemplate, lists: def.listTemplates?.length ?? 1, maxPages: def.maxPages, sitemaps: def.sitemaps?.length ?? 0 }))
      def.maxPages = Number(max || 3)
      def.id = 'smoke-' + def.id
      addSource(def)
      let last = 0
      const t0 = Date.now()
      await crawlSource(def.id, (p) => (last = p.found))
      const crawlMs = Date.now() - t0
      const r = search('', [def.id], 'site', 0, 3)
      const sample = r.hits.map((h) => ({ t: h.title.slice(0, 40), c: h.cover.slice(-70), u: h.entries[0].url }))
      console.log('CRAWL_RESULT ' + JSON.stringify({ site: def.name, tpl: def.listTemplate, re: def.seriesRe, pages: def.maxPages, found: last, crawlMs, mode: process.env['MR_FORCE_MODE'] ?? 'auto', sample }))
      if (process.env['MR_CRAWL_ENRICH']) {
        // titles that came from a sitemap (URL-derived): fill in the real ones from the pages
        const all = search('', [def.id], 'az', 0, 5000).hits
        const slugOnes = all.filter((h) => !h.cover).slice(0, 4)
        const before = slugOnes.map((h) => h.title)
        const got = await enrichEntries(slugOnes.map((h) => h.entries[0].url))
        console.log('ENRICH ' + JSON.stringify({ asked: slugOnes.length, before, after: got.map((g) => ({ t: g.title, cover: g.cover.slice(-40) })) }))
      }
      if (process.env['MR_CRAWL_SERIES'] && r.hits[0]) {
        const seriesUrl = /^https?:/.test(process.env['MR_CRAWL_SERIES']) ? process.env['MR_CRAWL_SERIES'] : r.hits[0].entries[0].url
        const t1 = Date.now()
        setSeriesPartialEmitter((p) => console.log('PARTIAL ' + JSON.stringify({ atMs: Date.now() - t1, chapters: p.chapters.length })))
        const d = await getSeries(def.id, seriesUrl)
        const seriesMs = Date.now() - t1
        console.log('SERIES_RESULT ' + JSON.stringify({ seriesMs, title: d.title.slice(0, 40), n: d.chapters.length, order: d.chapters.map((c) => c.title.replace(/chapter\s*/i, '')).slice(0, 30).join(','), alts: d.chapters.filter((c) => c.alts).length }))
      }
      removeSource(def.id)
    })()
      .catch((e) => console.log('CRAWL_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_FTEST=<image url>,<referer> tries several ways of fetching an image.
  if (process.env['MR_FTEST']) {
    ;(async () => {
      const [img, ref] = process.env['MR_FTEST']!.split(',')
      const ses = session.fromPartition('persist:sources')
      const tryIt = async (name: string, fn: () => Promise<Response>): Promise<void> => {
        try {
          const r = await fn()
          const b = await r.arrayBuffer()
          console.log('FTEST ' + name + ' -> ' + r.status + ' ' + r.headers.get('content-type') + ' ' + b.byteLength)
        } catch (e) {
          console.log('FTEST ' + name + ' -> ERR ' + (e instanceof Error ? e.message : String(e)))
        }
      }
      await tryIt('plain', () => ses.fetch(img))
      await tryIt('referer-header', () => ses.fetch(img, { headers: { Referer: ref } }))
      await tryIt('referer+origin', () => ses.fetch(img, { headers: { Referer: ref, Origin: new URL(ref).origin } }))
      await tryIt('referrer-option', () => ses.fetch(img, { referrer: ref, referrerPolicy: 'unsafe-url' }))
      await tryIt('net.fetch+session', () => net.fetch(img, { headers: { Referer: ref }, session: ses } as RequestInit))
    })().finally(() => app.quit())
    return
  }

  // Dev helper: MR_DLPAR=<n>,<url>,<url>... sets "download n chapters at once", queues all the chapters together and
  // prints how long until every one is done (and the most that ran at the same time).
  if (process.env['MR_DLPAR']) {
    ;(async () => {
      const [n, ...urls] = process.env['MR_DLPAR']!.split(',')
      setConcurrency(Number(n))
      const origin = new URL(urls[0]).origin + '/'
      const t0 = Date.now()
      enqueueDownloads(
        urls.map((u, i) => ({ chapterUrl: u, chapterTitle: 'par' + i, seriesUrl: origin + 'x', seriesTitle: 'par', sourceId: 't', referer: origin }))
      )
      let peak = 0
      for (;;) {
        const list = listDownloads().filter((i) => urls.includes(i.id))
        peak = Math.max(peak, list.filter((i) => i.status === 'downloading').length)
        if (list.every((i) => i.status === 'done' || i.status === 'error') || Date.now() - t0 > 280000) {
          console.log('DLPAR ' + JSON.stringify({ limit: Number(n), chapters: urls.length, secs: Math.round((Date.now() - t0) / 100) / 10, peak, done: list.filter((i) => i.status === 'done').length, errors: list.filter((i) => i.status === 'error').map((i) => i.error) }))
          break
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      const tr = Date.now()
      let ticks = 0
      const iv = setInterval(() => ticks++, 10) // counts how often the app got to run while the delete was going on
      await removeDownloads(urls)
      clearInterval(iv)
      console.log('DLDEL ' + JSON.stringify({ ms: Date.now() - tr, ticks, left: listDownloads().filter((i) => urls.includes(i.id)).length }))
      // downloading the same chapter again after deleting it must work
      enqueueDownloads([{ chapterUrl: urls[0], chapterTitle: 'again', seriesUrl: origin + 'x', seriesTitle: 'par', sourceId: 't', referer: origin }])
      for (let k = 0; k < 150; k++) {
        const it = listDownloads().find((i) => i.id === urls[0])
        if (it && (it.status === 'done' || it.status === 'error')) break
        await new Promise((r) => setTimeout(r, 200))
      }
      console.log('DLAGAIN ' + listDownloads().find((i) => i.id === urls[0])?.status)
      await removeDownloads([urls[0]])
    })()
      .catch((e) => console.log('DLPAR_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_DLTEST=<chapter url>,<chapter url>… downloads each, verifies files on disk, then deletes them.
  if (process.env['MR_DLTEST']) {
    ;(async () => {
      const { statSync } = await import('fs')
      const { join } = await import('path')
      const { downloadsRoot } = await import('./downloads')
      for (const url of process.env['MR_DLTEST']!.split(',')) {
        const origin = new URL(url).origin + '/'
        enqueueDownloads([{ chapterUrl: url, chapterTitle: 'test', seriesUrl: origin + 'x', seriesTitle: 'test', sourceId: 't', referer: origin }])
        let it = listDownloads().find((i) => i.id === url)!
        const t0 = Date.now()
        while (it.status === 'queued' || it.status === 'downloading') {
          if (Date.now() - t0 > 240000) break
          await new Promise((r) => setTimeout(r, 1000))
          it = listDownloads().find((i) => i.id === url)!
        }
        let onDisk = 0
        let bytes = 0
        for (const f of it.files) {
          try {
            bytes += statSync(join(downloadsRoot(), it.dir, f)).size
            onDisk++
          } catch {
            /* missing */
          }
        }
        console.log('DLTEST ' + JSON.stringify({ url: url.slice(-50), status: it.status, error: it.error, pages: it.total, files: it.files.length, onDisk, kb: Math.round(bytes / 1024), first: it.files[0], viaGet: !!getDownload(url) }))
        // The reader loads pages through the mr-img:// scheme: check local serving, the traversal guard and the remote proxy.
        const probe = async (label: string, u: string): Promise<void> => {
          try {
            const r = await net.fetch(u)
            const b = await r.arrayBuffer()
            console.log('SERVE ' + label + ' -> ' + r.status + ' ' + (r.headers.get('content-type') ?? '') + ' ' + b.byteLength)
          } catch (e) {
            console.log('SERVE ' + label + ' -> ERR ' + (e instanceof Error ? e.message : String(e)))
          }
        }
        if (it.files[0]) {
          await probe('local', `mr-img://local/?f=${encodeURIComponent(it.dir + '/' + it.files[0])}`)
          await probe('traversal', `mr-img://local/?f=${encodeURIComponent('../downloads.json')}`)
        }
        if (url.includes('mangafreak')) {
          const img = 'https://images.mangafreak.me/mangas/one_piece/one_piece_1198/one_piece_1198_1.jpg'
          await probe('remote-proxy', `mr-img://img/?u=${encodeURIComponent(img)}&r=${encodeURIComponent(origin)}`)
        }
        removeDownload(url)
      }
    })()
      .catch((e) => console.log('DLTEST_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_PTEST=1 exercises the progress store (save, mark read, reload from disk).
  if (process.env['MR_PTEST']) {
    const base = { seriesUrl: 'test://series', sourceId: 't', title: 'T', cover: '', coverReferer: '', chapterUrl: 'test://c2', chapterTitle: 'Chapter 2', pos: 0.4 }
    saveProgress({ ...base, chapterUrl: 'test://c1', chapterTitle: 'Chapter 1', pos: 1, markRead: 'test://c1' })
    saveProgress(base)
    flushProgress()
    const got = getProgress('test://series')
    const ok = got && got.chapterUrl === 'test://c2' && got.pos === 0.4 && got.read.length === 1 && got.read[0] === 'test://c1'
    console.log('PTEST ' + (ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(got) + ' recent=' + recentProgress(5).length)
    app.quit()
    return
  }

  // Dev helper: MR_DUMP=<url> prints the page's visible text, button labels and network JSON calls.
  if (process.env['MR_DUMP']) {
    ;(async () => {
      const win = hiddenWindow()
      const calls: string[] = []
      win.webContents.session.webRequest.onCompleted((d) => {
        if (/api|json|graphql|chapter/i.test(d.url) && !/\.(png|jpe?g|webp|css|js|woff2?)(\?|$)/i.test(d.url)) calls.push(d.statusCode + ' ' + d.method + ' ' + d.url)
      })
      await loadPage(win, process.env['MR_DUMP']!)
      await new Promise((r) => setTimeout(r, 5000))
      const info = await win.webContents.executeJavaScript(`({
        text: document.body.innerText.slice(0, 2500),
        buttons: [...document.querySelectorAll('button, [role=tab], select, [role=button]')].map(b => (b.textContent||'').trim().slice(0,40)).filter(Boolean).slice(0, 40),
        chapterLinks: document.querySelectorAll('a[href*="chapter-detail"]').length
      })`)
      console.log('DUMP_RESULT ' + JSON.stringify({ info, calls: calls.slice(0, 30) }))
      win.destroy()
    })()
      .catch((e) => console.log('DUMP_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_UPDTEST=<site url>,<series url> simulates a new chapter appearing and runs the update check.
  if (process.env['MR_UPDTEST']) {
    ;(async () => {
      const [site, seriesUrl] = process.env['MR_UPDTEST']!.split(',')
      const def = await detectSource(site)
      def.id = 'smoke-upd'
      addSource(def)
      const meta = { seriesUrl, sourceId: def.id, title: 'Test series', cover: '', coverReferer: site }
      const log = (k: string, v: unknown): void => console.log('UPD ' + k + ' ' + JSON.stringify(v))
      setAutoDownload(false) // don't download anything during the test
      setFollow(meta, true) // no cached list yet, so the first check only records a baseline
      await checkAll(true)
      log('after-baseline', { unread: getFollow(seriesUrl)?.unread })
      debugForget(seriesUrl, 2) // pretend the newest 2 chapters were never seen
      await checkAll(true)
      const f = getFollow(seriesUrl)
      log('after-forget', { unread: f?.unread, titles: f?.unreadChapters.map((c) => c.title) })
      await checkAll(true) // nothing changed: must not announce them twice
      log('repeat-check', { unread: getFollow(seriesUrl)?.unread })
      dismissNew(seriesUrl)
      log('after-dismiss', { unread: getFollow(seriesUrl)?.unread })
      setFollow(meta, false)
      log('after-unfollow', { following: listFollows().some((x) => x.seriesUrl === seriesUrl) })
      removeSource(def.id)
    })()
      .catch((e) => console.log('UPD_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_SEARCHBENCH=1 times loading the catalog and a set of searches (use MR_DATADIR=bench with a copy of
  // the real catalog.json in %TEMP%\manga-reader-devtestbench).
  if (process.env['MR_SEARCHBENCH']) {
    ;(async () => {
      const t0 = Date.now()
      const sources = listSources()
      const loadMs = Date.now() - t0
      console.log('BENCH_LOAD ' + JSON.stringify({ loadMs, sources: sources.length, ...debugSaveCost() }))
      const all: string[] = []
      const time = (label: string, q: string, ids: string[], sort: 'site' | 'az', offset: number): void => {
        const t = Date.now()
        const r = search(q, ids, sort, offset, 60)
        console.log('BENCH_SEARCH ' + JSON.stringify({ label, ms: Date.now() - t, total: r.total, returned: r.hits.length }))
      }
      time('all sites, empty query, page 1', '', all, 'site', 0)
      time('all sites, empty query, page 50', '', all, 'site', 3000)
      time('all sites, A-Z, page 1', '', all, 'az', 0)
      time('all sites, "a" (1 letter)', 'a', all, 'site', 0)
      time('all sites, "one piece"', 'one piece', all, 'site', 0)
      time('all sites, "zzzzq" (no match)', 'zzzzq', all, 'site', 0)
      time('one site, empty query', '', [sources[0].id], 'site', 0)
      time('2 sites, "love"', 'love', sources.slice(0, 2).map((s) => s.id), 'site', 0)
      time('all sites, empty query, page 1 AGAIN', '', all, 'site', 0)
    })()
      .catch((e) => console.log('BENCH_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_ANCH=<series url> loads the page, scrolls it, and reports which links look like chapters.
  if (process.env['MR_ANCH']) {
    ;(async () => {
      const w = hiddenWindow({ light: !process.env['MR_ANCH_FULL'] })
      w.webContents.on('console-message', (_e, level, m) => { if (process.env['MR_ANCH_CLICK'] && level >= 2) console.log('ANCH_CONSOLE ' + m.slice(0, 200)) })
      await loadPage(w, process.env['MR_ANCH']!)
      const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await sleepMs(2500)
      const probe = `(() => {
        const as = [...document.querySelectorAll('a[href]')];
        const txt = (a) => (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ');
        const chap = as.filter((a) => /^(chapter|chap\\.?|ch\\.?|episode|ep\\.?)\\s*\\d/i.test(txt(a)));
        const slug = location.pathname.split('/').filter(Boolean).pop() || '';
        return { total: as.length, byText: chap.length, sample: chap.slice(0, 3).map((a) => txt(a).slice(0, 30) + ' -> ' + a.getAttribute('href')), underSlug: as.filter((a) => a.href.includes(slug) && /chapter/i.test(a.href)).length, height: document.documentElement.scrollHeight };
      })()`
      const before = await w.webContents.executeJavaScript(probe)
      // which elements scroll on their own (a chapter list inside a scrollable box)? what do the buttons say?
      const boxes = await w.webContents.executeJavaScript(`[...document.querySelectorAll('div,ul,section')].filter((e) => e.scrollHeight > e.clientHeight + 40 && ['auto','scroll'].includes(getComputedStyle(e).overflowY) && e.querySelectorAll('a[href]').length > 10).slice(0, 4).map((e) => e.tagName + '.' + String(e.className).slice(0, 40) + ' links=' + e.querySelectorAll('a[href]').length + ' h=' + e.scrollHeight)`)
      const btns = await w.webContents.executeJavaScript(`[...document.querySelectorAll('button,[role=button]')].map((b) => (b.textContent || '').trim().slice(0, 24)).filter(Boolean).slice(0, 25).join(' | ')`)
      console.log('ANCH_BOXES ' + JSON.stringify({ boxes, btns }))
      const nets: string[] = []
      w.webContents.session.webRequest.onCompleted((d) => {
        if (/\/api\//.test(d.url)) nets.push(d.statusCode + ' ' + d.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 90))
      })
      if (process.env['MR_ANCH_CLICK']) {
        // press the "load more" button and list every request the page makes in response
        const all: string[] = []
        w.webContents.session.webRequest.onCompleted((d) => all.push(d.statusCode + ' ' + d.method + ' ' + d.url.slice(0, 110)))
        w.webContents.session.webRequest.onErrorOccurred((d) => all.push('ERR ' + d.error + ' ' + d.url.slice(0, 110)))
        const msg = await w.webContents.executeJavaScript(`(async () => { window.__l = []; const of = window.fetch; window.fetch = function () { window.__l.push('fetch ' + arguments[0]); return of.apply(this, arguments).then((r) => { window.__l.push('->' + r.status + ' ' + r.url); r.clone().text().then((t) => window.__l.push('BODY ' + t.slice(0, 300))); return r }, (e) => { window.__l.push('ERR ' + e); throw e }) }; window.addEventListener('error', (e) => window.__l.push('jserr ' + e.message)); [...document.querySelectorAll('[role=tab],button')].filter((x) => /^chapters?\b/i.test(x.textContent.trim())).forEach((x) => x.click()); await new Promise((r) => setTimeout(r, 800)); const bs = [...document.querySelectorAll('button')].filter((x) => /load more/i.test(x.textContent)); window.__l.push('buttons=' + bs.length + ' sizes=' + bs.map((x) => x.getBoundingClientRect().width).join(',')); const b = bs.find((x) => x.getBoundingClientRect().width > 0) || bs[0]; const n0 = document.querySelectorAll('a[href]').length; if (!b) return 'no button'; b.click(); await new Promise((r) => setTimeout(r, 3000)); const bb = document.querySelector('.detail-load-chapters'); window.__l.push('items2=' + document.querySelectorAll('.chapter-item').length + ' ' + (document.querySelector('.loaded-count')||{}).innerText); window.__l.push('react=' + (bb ? Object.keys(bb).filter((k) => k.startsWith('__react')).join(',') : 'nobtn') + ' scripts=' + [...document.scripts].filter((x) => x.src.includes('_next')).length + ' next=' + typeof window.next + ' ua=' + navigator.userAgent); return 'items=' + document.querySelectorAll('.chapter-item').length + ' links ' + n0 + ' -> ' + document.querySelectorAll('a[href]').length + ' LOG ' + window.__l.join(' ; ') + ' busy=' + document.querySelector('#detail-chapter-list')?.getAttribute('aria-busy') })()`)
        {
          const r = await w.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /load more/i.test(x.textContent)); if (!b) return null; b.scrollIntoView({block:'center'}); const q = b.getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2), vis: document.visibilityState, hasFocus: document.hasFocus() } })()`)
          if (r) {
            w.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y })
            w.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
            w.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 })
            await new Promise((res) => setTimeout(res, 2500))
            console.log('ANCH_REAL ' + JSON.stringify(r) + ' chapters now ' + (await w.webContents.executeJavaScript(`document.querySelectorAll('a[href*=chapter]').length`)))
          }
        }
        console.log('ANCH_CLICK ' + msg + ' ' + JSON.stringify(all))
      }
      await w.webContents.executeJavaScript(`[...document.querySelectorAll('div,ul,section')].filter((e) => e.scrollHeight > e.clientHeight + 40 && ['auto','scroll'].includes(getComputedStyle(e).overflowY)).forEach((e) => { e.scrollTop = e.scrollHeight })`)
      await sleepMs(1800)
      console.log('ANCH_NET_AFTER_INNER_SCROLL ' + JSON.stringify(nets))
      for (let i = 0; i < 12; i++) {
        await w.webContents.executeJavaScript('window.scrollBy(0, 900)')
        await sleepMs(350)
      }
      await sleepMs(1000)
      const after = await w.webContents.executeJavaScript(probe)
      console.log('ANCH ' + JSON.stringify({ before, afterScroll: after }))
      w.destroy()
    })()
      .catch((e) => console.log('ANCH_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_SITEPIPE=<json file of {name,url}> runs the WHOLE chain on each site, one at a time:
  // detect -> title list -> chapter list -> chapter pages -> first page image. One line per site.
  if (process.env['MR_SITEPIPE']) {
    ;(async () => {
      process.env['MR_NOHUMAN'] = '1'
      const { readFileSync } = await import('fs')
      warmUp()
      await new Promise((r) => setTimeout(r, 2500))
      const list = JSON.parse(readFileSync(process.env['MR_SITEPIPE']!, 'utf8').replace(/^﻿/, '')) as { name: string; url: string }[]
      for (const it of list) {
        const o: Record<string, unknown> = { name: it.name, url: it.url }
        const t0 = Date.now()
        const lap = (k: string): void => {
          o[k] = Date.now() - t0
        }
        const run = async (): Promise<void> => {
          const def = await detectSource(it.url)
          lap('detectMs')
          o.listTemplate = def.maxPages > 1 ? 'paged' : def.maxPages === 1 ? 'single page' : 'none'
          o.sitemap = def.sitemaps?.length ?? 0
          def.id = 'pipe-test'
          if (def.sitemaps && def.sitemaps.length > 1) def.sitemaps = def.sitemaps.slice(0, 1) // keep the test light
          def.maxPages = Math.min(def.maxPages, 2)
          addSource(def)
          await crawlSource(def.id, () => undefined)
          const hits = search('', [def.id], 'site', 0, 60).hits
          o.titles = hits.length
          o.withCovers = hits.filter((h) => h.cover).length
          lap('listMs')
          if (hits.length === 0) throw new Error('no titles found')
          // Read up to 6 titles and keep the one with the most chapters. A site only counts as fully working if that
          // list is substantial (8+) and does not look cut short (e.g. 2 chapters when the newest is Chapter 66).
          let chapters: { title: string; url: string }[] = []
          let seriesUrl = ''
          let incomplete = false
          let tried = 0
          for (const h of process.env['MR_PIPESERIES'] ? ([{ entries: [{ url: process.env['MR_PIPESERIES'] }] }] as typeof hits) : hits.slice(0, 6)) {
            try {
              const d = await getSeries(def.id, h.entries[0].url)
              tried++
              if (process.env['MR_PIPEDEBUG']) console.log('PIPETRY', h.entries[0].url, d.chapters.length, !!d.incomplete, d.chapters.slice(0, 3).map((c) => c.title).join(' / '), '...', d.chapters.slice(-3).map((c) => c.title).join(' / '))
              if (d.chapters.length > chapters.length) {
                chapters = d.chapters
                seriesUrl = h.entries[0].url
                incomplete = !!d.incomplete
              }
              if (chapters.length >= 8 && !incomplete) break
            } catch (e) {
              o.seriesError = (e instanceof Error ? e.message : String(e)).slice(0, 80)
            }
          }
          o.chapters = chapters.length
          o.incomplete = incomplete
          o.seriesTried = tried
          lap('chaptersMs')
          if (chapters.length === 0) throw new Error('no chapters found')
          const g = await grabChapterFast(chapters[0].url)
          if (process.env['MR_PIPEDEBUG']) console.log('PIPECH', chapters[0].url, g.pages.length, g.pages.slice(0, 2).join(' '), g.pages.slice(-2).join(' '))
          o.pages = g.pages.length
          lap('pagesMs')
          if (g.pages.length === 0) throw new Error('no pages found in the newest chapter')
          const ses = session.fromPartition('persist:sources')
          ensureSession()
          refererHints.set(g.pages[0], new URL(seriesUrl).origin + '/')
          const r = await ses.fetch(g.pages[0])
          const buf = await r.arrayBuffer()
          refererHints.delete(g.pages[0])
          o.imageStatus = r.status
          o.imageKb = Math.round(buf.byteLength / 1024)
          o.imageType = (r.headers.get('content-type') ?? '').split(';')[0]
          lap('imageMs')
          const imageOk = r.ok && String(o.imageType).startsWith('image/') && buf.byteLength > 5000
          const solid = chapters.length >= 8 && !incomplete && g.pages.length >= 4 && g.pages.length <= 80
          o.result = !imageOk ? 'IMAGE-FAILED' : solid ? 'WORKS' : 'CHECK' // CHECK: passes, but the numbers look thin or odd
        }
        try {
          await Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 100 s')), 100000))])
        } catch (e) {
          o.result = 'FAILED'
          o.error = (e instanceof Error ? e.message : String(e)).slice(0, 110)
        }
        try {
          removeSource('pipe-test')
        } catch {
          /* nothing to remove */
        }
        console.log('PIPE ' + JSON.stringify(o))
        if (process.env['MR_PIPEOUT']) {
          const { appendFileSync } = await import('fs')
          appendFileSync(process.env['MR_PIPEOUT'], 'PIPE ' + JSON.stringify(o) + '\n') // written at once, not at the end
        }
      }
    })()
      .catch((e) => console.log('PIPE_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_SITECHECK=<json file of {name,url}> runs the cheap checks on each site (loads? human check? robots?
  // sitemap?) and prints one line per site.
  if (process.env['MR_SITECHECK']) {
    ;(async () => {
      const { readFileSync } = await import('fs')
      const { fetchHtml } = await import('./http')
      const { robotsAllows } = await import('./robots')
      const { discoverSitemap } = await import('./sitemap')
      const list = JSON.parse(readFileSync(process.env['MR_SITECHECK']!, 'utf8').replace(/^﻿/, '')) as { name: string; url: string }[]
      const queue = [...list]
      const worker = async (): Promise<void> => {
        for (;;) {
          const it = queue.shift()
          if (!it) return
          const t0 = Date.now()
          const o: Record<string, unknown> = { name: it.name, url: it.url }
          try {
            const r = await fetchHtml(it.url, 12000)
            o.status = r.status
            o.bytes = r.html.length
            o.challenge = /just a moment|security verification|attention required|cf-browser-verification|enable javascript and cookies|ddos-guard|checking your browser|verify you are human/i.test(r.html.slice(0, 4000))
            o.title = (r.html.match(/<title>([^<]*)/i)?.[1] ?? '').trim().slice(0, 50)
            const origin = new URL(r.finalUrl).origin
            o.final = origin
            o.robotsOk = await robotsAllows(origin + '/')
            const plan = o.challenge ? null : await discoverSitemap(origin).catch(() => null)
            o.sitemapFiles = plan ? plan.files.length : 0
          } catch (e) {
            o.error = (e instanceof Error ? e.message : String(e)).slice(0, 70)
          }
          o.ms = Date.now() - t0
          console.log('SC1 ' + JSON.stringify(o))
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
    })()
      .catch((e) => console.log('SC1_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_MOELIST=<everythingmoe section url> reads each entry page and prints the real site address.
  if (process.env['MR_MOELIST']) {
    ;(async () => {
      warmUp()
      await new Promise((r) => setTimeout(r, 2500))
      const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      const first = hiddenWindow()
      await loadPage(first, process.env['MR_MOELIST']!)
      await sleepMs(4000)
      const items: string[] = await first.webContents.executeJavaScript(
        `[...new Set([...document.querySelectorAll('a[href^="/s/"]')].map(a => a.getAttribute('href')))]`
      )
      first.destroy()
      console.log('MOE_COUNT ' + items.length)
      const queue = [...items]
      const skip = /(discord|twitter|x\.com|reddit|github|patreon|ko-fi|facebook|instagram|youtube|telegram|everythingmoe|t\.me)/i
      const worker = async (): Promise<void> => {
        const w = hiddenWindow()
        try {
          for (;;) {
            const path = queue.shift()
            if (!path) return
            try {
              await loadPage(w, 'https://everythingmoe.com' + path, 20000)
              await sleepMs(1500)
              const r: { title: string; links: string[] } = await w.webContents.executeJavaScript(
                `({ title: document.title, links: [...document.querySelectorAll('a[href^="http"]')].map(a => a.href) })`
              )
              const links = [...new Set(r.links.filter((l) => !skip.test(new URL(l).hostname)))]
              console.log('MOE ' + JSON.stringify({ slug: path.replace('/s/', ''), title: r.title.replace(/\s*[-|].*$/, ''), url: links[0] ?? '', more: links.slice(1, 3) }))
            } catch (e) {
              console.log('MOE ' + JSON.stringify({ slug: path, error: e instanceof Error ? e.message : String(e) }))
            }
            await sleepMs(400)
          }
        } finally {
          if (!w.isDestroyed()) w.destroy()
        }
      }
      await Promise.all([worker(), worker()])
    })()
      .catch((e) => console.log('MOE_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_HEALTHTEST=<site url> adds the site, runs the Sites "Re-check" on it and prints the result.
  if (process.env['MR_HEALTHTEST']) {
    void (async () => {
      warmUp()
      await new Promise((r) => setTimeout(r, 2500))
      const def = await detectSource(process.env['MR_HEALTHTEST']!)
      def.id = 'health-test'
      if (def.sitemaps && def.sitemaps.length > 1) def.sitemaps = def.sitemaps.slice(0, 1)
      def.maxPages = Math.min(def.maxPages, 2)
      addSource(def)
      await crawlSource(def.id, () => undefined)
      await runSiteCheck(def.id)
      console.log('HEALTH ' + JSON.stringify(healthOf(def.id)))
    })()
      .catch((e) => console.log('HEALTH_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }
  // Dev helper: MR_OPENTEST=<site>,<series url> checks that a series is read once and then only checked for new chapters.
  if (process.env['MR_OPENTEST']) {
    ;(async () => {
      warmUp()
      await new Promise((r) => setTimeout(r, 2500))
      const [site, seriesUrl] = process.env['MR_OPENTEST']!.split(',')
      const def = await detectSource(site)
      def.id = 'smoke-open'
      addSource(def)
      const step = async (label: string, mode: 'auto' | 'check' | 'full'): Promise<void> => {
        const t = Date.now()
        const d = await openSeries(def.id, seriesUrl, mode)
        console.log('OPEN ' + JSON.stringify({ step: label, mode, ms: Date.now() - t, chapters: d.chapters.length, newest: d.chapters[0]?.title }))
      }
      await step('1 first time ever (full read)', 'auto')
      await step('2 open again right away', 'auto')
      await step('3 "Check for new chapters" button', 'check')
      debugTrimSeries(seriesUrl, 2) // pretend 2 new chapters came out since the list was saved
      await step('4 reopen after a long time (2 chapters missing)', 'auto')
      await step('5 open again right away', 'auto')
      await step('6 "Reload full list" button', 'full')
      removeSource(def.id)
    })()
      .catch((e) => console.log('OPEN_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_BENCH=<chapter url>|<referer>;... opens chapters one after another in one running app and
  // times each: the page list, then the first page image (what you wait for before you see anything).
  if (process.env['MR_BENCH']) {
    ;(async () => {
      warmUp()
      primeNetwork()
      await new Promise((r) => setTimeout(r, 3000))
      const { fetchHtml } = await import('./http')
      for (const item of process.env['MR_BENCH']!.split(';')) {
        const [url, ref] = item.split('|')
        const t0 = Date.now()
        const g = await grabChapterFast(url)
        const tList = Date.now() - t0
        let tImg = -1
        let bytes = 0
        if (g.pages[0]) {
          const t1 = Date.now()
          const ses = session.fromPartition('persist:sources')
          ensureSession()
          refererHints.set(g.pages[0], ref)
          const r = await ses.fetch(g.pages[0])
          bytes = (await r.arrayBuffer()).byteLength
          refererHints.delete(g.pages[0])
          tImg = Date.now() - t1
        }
        console.log('BENCH ' + JSON.stringify({ chapter: url.slice(-45), pages: g.pages.length, pageListMs: tList, firstImageMs: tImg, kb: Math.round(bytes / 1024) }))
      }
      void fetchHtml
    })()
      .catch((e) => console.log('BENCH_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_QUICK=<site url> times the quick start (what "Add site" waits for), then the background refine.
  if (process.env['MR_QUICK']) {
    ;(async () => {
      warmUp()
      await new Promise((r) => setTimeout(r, 2500))
      const t0 = Date.now()
      const q = await detectSource(process.env['MR_QUICK']!, undefined, { quick: true })
      console.log('QUICK ' + JSON.stringify({ addSiteWaitMs: Date.now() - t0, sitemaps: q.sitemaps?.length ?? 0, maxPages: q.maxPages, needsRefine: !!q.needsRefine }))
      const t1 = Date.now()
      const full = await detectSource(process.env['MR_QUICK']!)
      console.log('REFINED ' + JSON.stringify({ backgroundMs: Date.now() - t1, tpl: full.listTemplate, maxPages: full.maxPages }))
    })()
      .catch((e) => console.log('QUICK_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_VISAPI=<url>,<show 1|0> loads a page in a visible or hidden window and lists its data requests.
  if (process.env['MR_VISAPI']) {
    ;(async () => {
      const [url, show] = process.env['MR_VISAPI']!.split(',')
      ensureSession()
      const calls: string[] = []
      session.fromPartition('persist:sources').webRequest.onCompleted((d) => {
        if (/\/api\//.test(d.url)) calls.push(d.statusCode + ' ' + d.url.replace(/^https:\/\/[^/]+/, '').slice(0, 110))
      })
      const w = new BrowserWindow({ width: 1000, height: 760, show: show === '1', webPreferences: { partition: 'persist:sources' } })
      await w.loadURL(url).catch(() => undefined)
      await new Promise((r) => setTimeout(r, 7000))
      const vis = await w.webContents.executeJavaScript('document.visibilityState + " hidden=" + document.hidden').catch(() => '?')
      console.log('VISAPI ' + JSON.stringify({ show, visibility: vis, calls }))
      w.destroy()
    })()
      .catch((e) => console.log('VISAPI_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_VISIBLE=<url> opens a normal visible window on the site and reports whether its check clears.
  if (process.env['MR_VISIBLE']) {
    ;(async () => {
      ensureSession()
      const w = new BrowserWindow({ width: 900, height: 700, show: true, webPreferences: { partition: 'persist:sources' } })
      await w.loadURL(process.env['MR_VISIBLE']!).catch(() => undefined)
      let last = ''
      for (let i = 0; i < 40 && !w.isDestroyed(); i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const t = await w.webContents.executeJavaScript('document.title + " | " + (document.body ? document.body.innerText.slice(0, 80).replace(/\\s+/g, " ") : "")').catch(() => '')
        if (t !== last) console.log('VISIBLE t=' + (i + 1) + 's ' + t)
        last = t
        if (!/just a moment|security verification|checking your browser/i.test(t)) break
      }
      console.log('VISIBLE_DONE title=' + (w.isDestroyed() ? 'window closed' : await w.webContents.executeJavaScript('document.title')))
      if (!w.isDestroyed()) w.destroy()
    })()
      .catch((e) => console.log('VISIBLE_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_ROBOTS=<url>,<url>... prints whether robots.txt allows each one.
  if (process.env['MR_ROBOTS']) {
    ;(async () => {
      const { robotsAllows } = await import('./robots')
      for (const u of process.env['MR_ROBOTS']!.split(',')) console.log('ROBOTS ' + (await robotsAllows(u) ? 'allowed ' : 'BLOCKED ') + u)
    })()
      .catch((e) => console.log('ROBOTS_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_DISCOVER=<site url> runs the sitemap discovery and prints the plan.
  if (process.env['MR_DISCOVER']) {
    ;(async () => {
      const { discoverSitemap } = await import('./sitemap')
      const t0 = Date.now()
      const plan = await discoverSitemap(process.env['MR_DISCOVER']!)
      console.log('DISCOVER ' + JSON.stringify({ ms: Date.now() - t0, plan: plan && { files: plan.files.length, firstFile: plan.files[0], lastFile: plan.files[plan.files.length - 1], re: plan.seriesRe, sample: plan.sample } }))
    })()
      .catch((e) => console.log('DISCOVER_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_META=<url> shows the title/cover a plain-HTTP fetch of the page gives (no browser).
  if (process.env['MR_META']) {
    ;(async () => {
      const { fetchHtml } = await import('./http')
      const cheerio = await import('cheerio')
      const t0 = Date.now()
      const r = await fetchHtml(process.env['MR_META']!, 20000)
      const $ = cheerio.load(r.html)
      const m = (p: string): string => $(`meta[property="${p}"]`).attr('content') ?? ''
      console.log('META ' + JSON.stringify({ status: r.status, ms: Date.now() - t0, ogTitle: m('og:title'), ogImage: m('og:image'), title: $('title').text().trim().slice(0, 80), h1: $('h1').first().text().trim().slice(0, 60) }))
    })()
      .catch((e) => console.log('META_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_SITEMAP=<url> summarises a sitemap file (kind, how many entries, a few examples).
  if (process.env['MR_SITEMAP']) {
    ;(async () => {
      const { fetchHtml } = await import('./http')
      const cheerio = await import('cheerio')
      const r = await fetchHtml(process.env['MR_SITEMAP']!, 30000)
      const $ = cheerio.load(r.html, { xmlMode: true })
      const kind = $('sitemapindex').length ? 'index' : $('urlset').length ? 'urlset' : 'unknown'
      const locs = $(kind === 'index' ? 'sitemap > loc' : 'url > loc').map((_, e) => $(e).text().trim()).get()
      const first = $(kind === 'index' ? 'sitemap' : 'url').first()
      console.log('SITEMAP ' + JSON.stringify({ status: r.status, kind, entries: locs.length, bytes: r.html.length, sample: locs.slice(0, 4), lastSample: locs.slice(-2), firstEntryXml: (first.toString() || r.html.slice(0, 300)).replace(/\s+/g, ' ').slice(0, 500) }))
    })()
      .catch((e) => console.log('SITEMAP_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_IMGTEST=<page url>,<image url> loads the image from inside the real page (browser context).
  if (process.env['MR_IMGTEST']) {
    ;(async () => {
      const [page, img] = process.env['MR_IMGTEST']!.split(',')
      const win = hiddenWindow()
      try {
        await loadPage(win, page)
        await new Promise((r) => setTimeout(r, 2000))
        const out = await win.webContents.executeJavaScript(
          `new Promise((res) => { const i = new Image(); i.onload = () => res('LOADED ' + i.naturalWidth + 'x' + i.naturalHeight); i.onerror = () => res('ERROR'); setTimeout(() => res('TIMEOUT'), 15000); i.src = ${JSON.stringify(img)}; })`
        )
        console.log('IMGTEST ' + out + ' title=' + (await win.webContents.executeJavaScript('document.title')))
      } finally {
        if (!win.isDestroyed()) win.destroy()
      }
    })()
      .catch((e) => console.log('IMGTEST_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_BODY=<url>,<referer> prints the status, key headers and start of the body.
  if (process.env['MR_BODY']) {
    ;(async () => {
      const [u, ref] = process.env['MR_BODY']!.split(',')
      const ses = session.fromPartition('persist:sources')
      ensureSession()
      if (ref) refererHints.set(u, ref)
      const r = await ses.fetch(u)
      const t = await r.text()
      const h: Record<string, string> = {}
      r.headers.forEach((v, k) => {
        if (/^(server|cf-|content-type|retry-after|x-|cache-control|www-authenticate)/i.test(k)) h[k] = v.slice(0, 80)
      })
      console.log('BODY ' + JSON.stringify({ status: r.status, h, body: t.replace(/\s+/g, ' ').slice(0, 500) }))
    })()
      .catch((e) => console.log('BODY_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_STATIC=<chapter url> shows what plain-HTTP parsing finds on a chapter page.
  if (process.env['MR_STATIC']) {
    ;(async () => {
      const { fetchHtml } = await import('./http')
      const { parseChapterImages } = await import('./staticParse')
      const r = await fetchHtml(process.env['MR_STATIC']!)
      const p = parseChapterImages(r.html, process.env['MR_STATIC']!)
      console.log('STATIC ' + JSON.stringify({ status: r.status, n: p.pages.length, pages: p.pages.map((u) => u.slice(-60)) }))
    })()
      .catch((e) => console.log('STATIC_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  // Dev helper: MR_SMOKE=<chapter url> prints the pages the grabber finds, then exits.
  if (process.env['MR_SMOKE']) {
    warmUp() // like the real app, which keeps a spare window ready
    await new Promise((r) => setTimeout(r, 2500))
    const t0 = Date.now()
    grabChapterFast(process.env['MR_SMOKE'])
      .then(async (r) => {
        console.log('SMOKE_RESULT ' + JSON.stringify({ ms: Date.now() - t0, mode: process.env['MR_FORCE_MODE'] ?? 'auto', count: r.pages.length, first: r.pages[0] }))
        await settleVerifications() // let the first-time site check finish and be saved
        const { fetchHtml } = await import('./http')
        const t1 = Date.now()
        await fetchHtml(process.env['MR_SMOKE']!)
        const t2 = Date.now()
        await fetchHtml(process.env['MR_SMOKE']!)
        console.log('STEADY ' + JSON.stringify({ secondRequestMs: t2 - t1, thirdRequestMs: Date.now() - t2 }))
      })
      .catch((e) => console.log('SMOKE_ERROR ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => app.quit())
    return
  }

  createWindow()
  warmUp()
  primeNetwork()
  // Keep every site's title list complete and fresh without being asked: one site at a time, resuming unfinished scans
  // and refreshing finished ones twice a day. Starts a little after launch so the app is responsive first.
  const autoScan = async (): Promise<void> => {
    try {
      for (const s of listSources()) {
        if (!scanDue(s.id)) continue
        console.log('AUTOSCAN', s.name)
        await crawlSource(s.id, emit)
        await new Promise((r) => setTimeout(r, 5000)) // a pause between sites
      }
    } catch (e) {
      console.log('AUTOSCAN failed', e instanceof Error ? e.message : String(e))
    }
  }
  if (!process.env['MR_NOAUTOSCAN']) {
    setTimeout(() => {
      void autoScan()
      setInterval(() => void autoScan(), 30 * 60 * 1000)
    }, process.env['MR_AUTOSCAN_FAST'] ? 3000 : 25000)
  }
  // Sites saved with chapter links as titles (older detection) are rebuilt from scratch in the background.
  setTimeout(async () => {
    for (const id of sourcesWithChapterTitles()) {
      try {
        const old = getSource(id)
        if (!old) continue
        console.log('HEAL rebuilding', id, old.baseUrl)
        const def = await detectSource(old.baseUrl)
        removeSource(id)
        def.id = id
        addSource(def)
        void crawlSource(id, emit)
      } catch (e) {
        console.log('HEAL failed', id, e instanceof Error ? e.message : String(e))
      }
    }
  }, 3000)
  // Build the title index in the background while the app is idle, so the first search you type is quick.
  setTimeout(() => {
    try {
      search('', [], 'site', 0, 1)
    } catch {
      /* it is only a warm-up */
    }
  }, 4000)

  // Sites added by an older version: look once for a sitemap, and for a better way to list the site than just
  // its home page (100 titles). If either turns up, start a scan that uses it.
  setTimeout(async () => {
    for (const s of listSources()) {
      if (s.needsRefine && !s.crawling) {
        // the app was closed before this site's list pages were worked out: finish that now
        void refineSource(s.id, (p) => {
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send('crawl-progress', p)
        })
        continue
      }
      const homeOnly = s.maxPages <= 1 && !s.sitemaps?.length
      if (s.crawling || (s.sitemapChecked && !homeOnly)) continue
      try {
        const def = await detectSource(s.baseUrl)
        const gotSitemap = !!def.sitemaps?.length && !s.sitemaps?.length
        const gotList = def.maxPages > 1 && s.maxPages <= 1
        addSource(def)
        if (gotSitemap || gotList) {
          void crawlSource(def.id, (p) => {
            for (const w of BrowserWindow.getAllWindows()) w.webContents.send('crawl-progress', p)
          })
        }
      } catch {
        /* leave it as it is */
      }
    }
  }, 8000)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('before-quit', () => {
  flushProgress()
  flushDownloads()
  flushSeriesCache()
  flushModes()
  flushHealth()
  flushUpdates()
})

app.on('window-all-closed', () => {
  // Dev smoke modes run with hidden windows only; they call app.quit() themselves when done.
  if (process.env['MR_CRAWL'] || process.env['MR_SMOKE'] || process.env['MR_PROBE'] || process.env['MR_DUMP'] || process.env['MR_DLTEST'] || process.env['MR_DLPAR'] || process.env['MR_FTEST'] || process.env['MR_STATIC'] || process.env['MR_BODY'] || process.env['MR_IMGTEST'] || process.env['MR_UPDTEST'] || process.env['MR_SITEMAP'] || process.env['MR_META'] || process.env['MR_DISCOVER'] || process.env['MR_ROBOTS'] || process.env['MR_VISIBLE'] || process.env['MR_QUICK'] || process.env['MR_BENCH'] || process.env['MR_VISAPI'] || process.env['MR_OPENTEST'] || process.env['MR_MOELIST'] || process.env['MR_SITECHECK'] || process.env['MR_SITEPIPE'] || process.env['MR_HEALTHTEST'] || process.env['MR_ANCH'] || process.env['MR_SEARCHBENCH']) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
