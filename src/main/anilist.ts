import { BrowserWindow, app, safeStorage } from 'electron'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getSeriesCached, sourceForHost } from './catalog'
import { AniListClient, flushQueue } from './anilistClient'
import {
  ANILIST_AUTHORIZE_URL,
  ANILIST_DEFAULT_CLIENT_ID,
  ANILIST_REDIRECT_URL,
  RateLimiter,
  anilistStatusForFinishedChapter,
  enqueueUpdate,
  mergeProgressForward,
  parseOAuthToken,
  progressToSync,
  rankAniListMatches,
  suggestBestMatch,
  type AniListMediaHit,
  type QueuedUpdate
} from './anilistLogic'
import { applyForwardProgress, getProgress } from './progress'
import { readJson, writeAtomic } from './safefile'
import { getSettings } from './settings'

export interface AniListLink {
  seriesUrl: string
  mediaId: number
  title: string
  siteUrl?: string
  cover?: string
  linkedAt: number
}

export interface AniListStatus {
  connected: boolean
  name?: string
  clientId: string
  hasClientId: boolean
}

export interface AniListMediaInfo {
  id: number
  title: string
  titles: { romaji?: string; english?: string; native?: string }
  format?: string
  status?: string
  chapters?: number
  siteUrl?: string
  cover?: string
}

export interface AniListImportResult {
  updated: number
  skipped: number
  failed: number
}

interface AuthFile {
  v: 1
  enc: boolean
  data: string
  name?: string
  userId?: number
  obtainedAt?: number
  expiresAt?: number
}

interface AuthState {
  token: string
  name?: string
  userId?: number
  obtainedAt: number
  expiresAt?: number
}

const limiter = new RateLimiter(90)
let authCache: AuthState | null | undefined
let linksCache: Record<string, AniListLink> | null = null
let queueCache: QueuedUpdate[] | null = null
let flushTimer: NodeJS.Timeout | undefined
let flushing = false
let oauthWin: BrowserWindow | null = null

function authPath(): string {
  return join(app.getPath('userData'), 'anilist-auth.json')
}

function linksPath(): string {
  return join(app.getPath('userData'), 'anilist-links.json')
}

function queuePath(): string {
  return join(app.getPath('userData'), 'anilist-queue.json')
}

export function anilistClientId(): string {
  const fromSettings = (getSettings().anilistClientId ?? '').trim()
  if (fromSettings) return fromSettings
  return (ANILIST_DEFAULT_CLIENT_ID || '').trim()
}

function displayTitle(hit: AniListMediaHit): string {
  return (
    hit.title.userPreferred ||
    hit.title.english ||
    hit.title.romaji ||
    hit.title.native ||
    `AniList #${hit.id}`
  )
}

export function toMediaInfo(hit: AniListMediaHit): AniListMediaInfo {
  return {
    id: hit.id,
    title: displayTitle(hit),
    titles: {
      romaji: hit.title.romaji ?? undefined,
      english: hit.title.english ?? undefined,
      native: hit.title.native ?? undefined
    },
    format: hit.format ?? undefined,
    status: hit.status ?? undefined,
    chapters: hit.chapters ?? undefined,
    siteUrl: hit.siteUrl ?? undefined,
    cover: hit.coverImage?.medium ?? undefined
  }
}

function readAuth(): AuthState | null {
  if (authCache !== undefined) return authCache
  const file = readJson<AuthFile>(authPath())
  if (!file?.data) {
    authCache = null
    return null
  }
  try {
    const raw = file.enc
      ? safeStorage.decryptString(Buffer.from(file.data, 'base64'))
      : file.data
    const parsed = JSON.parse(raw) as { token?: string }
    if (!parsed.token) {
      authCache = null
      return null
    }
    authCache = {
      token: parsed.token,
      name: file.name,
      userId: file.userId,
      obtainedAt: file.obtainedAt ?? 0,
      expiresAt: file.expiresAt
    }
    return authCache
  } catch {
    authCache = null
    return null
  }
}

function writeAuth(state: AuthState | null): void {
  authCache = state
  if (!state) {
    try {
      if (existsSync(authPath())) unlinkSync(authPath())
    } catch {
      writeAtomic(authPath(), JSON.stringify({ v: 1, enc: false, data: '' }))
    }
    return
  }
  const payload = JSON.stringify({ token: state.token })
  let enc = false
  let data = payload
  try {
    if (safeStorage.isEncryptionAvailable()) {
      data = safeStorage.encryptString(payload).toString('base64')
      enc = true
    }
  } catch {
    enc = false
    data = payload
  }
  const file: AuthFile = {
    v: 1,
    enc,
    data,
    name: state.name,
    userId: state.userId,
    obtainedAt: state.obtainedAt,
    expiresAt: state.expiresAt
  }
  writeAtomic(authPath(), JSON.stringify(file))
}

function loadLinks(): Record<string, AniListLink> {
  if (!linksCache) linksCache = readJson<Record<string, AniListLink>>(linksPath()) ?? {}
  return linksCache
}

function saveLinks(): void {
  if (linksCache) writeAtomic(linksPath(), JSON.stringify(linksCache))
}

function loadQueue(): QueuedUpdate[] {
  if (!queueCache) queueCache = readJson<QueuedUpdate[]>(queuePath()) ?? []
  return queueCache
}

function saveQueue(): void {
  if (queueCache) writeAtomic(queuePath(), JSON.stringify(queueCache))
}

export function flushAniList(): void {
  saveQueue()
  saveLinks()
}

function getToken(): string | null {
  const a = readAuth()
  if (!a) return null
  if (a.expiresAt && a.expiresAt < Date.now()) {
    writeAuth(null)
    return null
  }
  return a.token
}

function api(): AniListClient {
  return new AniListClient({
    fetch: globalThis.fetch as unknown as import('./anilistClient').FetchLike,
    getToken,
    limiter
  })
}

export function anilistStatus(): AniListStatus {
  const clientId = anilistClientId()
  const a = readAuth()
  const connected = !!getToken()
  const status: AniListStatus = { connected, clientId, hasClientId: clientId.length > 0 }
  if (connected && a?.name) status.name = a.name
  return status
}

export function getAniListLink(seriesUrl: string): AniListLink | null {
  return loadLinks()[seriesUrl] ?? null
}

export function unlinkAniList(seriesUrl: string): void {
  const all = loadLinks()
  if (!all[seriesUrl]) return
  delete all[seriesUrl]
  saveLinks()
}

export function linkAniList(seriesUrl: string, media: AniListMediaInfo): AniListLink {
  const link: AniListLink = {
    seriesUrl,
    mediaId: media.id,
    title: media.title,
    siteUrl: media.siteUrl,
    cover: media.cover,
    linkedAt: Date.now()
  }
  loadLinks()[seriesUrl] = link
  saveLinks()
  return link
}

export async function searchAniList(
  title: string
): Promise<{ hits: AniListMediaInfo[]; suggested: AniListMediaInfo | null }> {
  const hits = await api().searchMedia(title.trim())
  const ranked = rankAniListMatches(title, hits)
  const suggested = suggestBestMatch(title, hits)
  return {
    hits: ranked.map((r) => toMediaInfo(r.media)),
    suggested: suggested ? toMediaInfo(suggested) : null
  }
}

function waitForToken(win: BrowserWindow): Promise<{ accessToken: string; expiresIn?: number }> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (token: { accessToken: string; expiresIn?: number } | null, error?: string): void => {
      if (done) return
      done = true
      win.webContents.removeListener('will-redirect', onUrl)
      win.webContents.removeListener('will-navigate', onUrl)
      win.webContents.removeListener('did-redirect-navigation', onDid)
      win.webContents.removeListener('did-navigate', onDid)
      win.webContents.removeListener('did-navigate-in-page', onDid)
      win.removeListener('closed', onClosed)
      if (token) resolve(token)
      else reject(new Error(error || 'AniList sign-in was cancelled'))
    }
    const consider = (url: string): void => {
      const parsed = parseOAuthToken(url)
      if (parsed?.accessToken) finish(parsed)
    }
    const onUrl = (e: Electron.Event, url: string): void => {
      const parsed = parseOAuthToken(url)
      if (parsed?.accessToken) {
        e.preventDefault()
        finish(parsed)
      }
    }
    const onDid = (_e: Electron.Event, url: string): void => consider(url)
    const onClosed = (): void => finish(null, 'AniList sign-in was cancelled')
    win.webContents.on('will-redirect', onUrl)
    win.webContents.on('will-navigate', onUrl)
    win.webContents.on('did-redirect-navigation', onDid)
    win.webContents.on('did-navigate', onDid)
    win.webContents.on('did-navigate-in-page', onDid)
    win.on('closed', onClosed)
    const poll = async (): Promise<void> => {
      while (!done && !win.isDestroyed()) {
        try {
          const href = (await win.webContents.executeJavaScript('location.href')) as string
          consider(href)
        } catch {
          /* window gone or not ready */
        }
        await new Promise((r) => setTimeout(r, 400))
      }
    }
    void poll()
  })
}

export async function connectAniList(parent?: BrowserWindow | null): Promise<AniListStatus> {
  const clientId = anilistClientId()
  if (!clientId) throw new Error('Add an AniList client ID in Settings first')
  if (oauthWin && !oauthWin.isDestroyed()) {
    oauthWin.focus()
    throw new Error('AniList sign-in is already open')
  }
  const url =
    `${ANILIST_AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token&redirect_uri=${encodeURIComponent(ANILIST_REDIRECT_URL)}`
  const win = new BrowserWindow({
    width: 520,
    height: 740,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: !!parent && !parent.isDestroyed(),
    show: true,
    autoHideMenuBar: true,
    title: 'Connect AniList',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:anilist'
    }
  })
  oauthWin = win
  win.removeMenu()
  try {
    const tokenP = waitForToken(win)
    await win.loadURL(url)
    const access = await tokenP
    writeAuth({
      token: access.accessToken,
      obtainedAt: Date.now(),
      expiresAt: access.expiresIn ? Date.now() + access.expiresIn * 1000 : undefined
    })
    try {
      const viewer = await api().getViewer()
      const cur = readAuth()
      if (cur && viewer) writeAuth({ ...cur, name: viewer.name, userId: viewer.id })
    } catch {
      /* token is still stored; the name can be filled in later */
    }
    return anilistStatus()
  } finally {
    if (!win.isDestroyed()) win.close()
    if (oauthWin === win) oauthWin = null
  }
}

export function disconnectAniList(): AniListStatus {
  if (oauthWin && !oauthWin.isDestroyed()) oauthWin.close()
  oauthWin = null
  writeAuth(null)
  return anilistStatus()
}

export function scheduleAniListFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void processAniListQueue()
  }, 400)
}

export async function processAniListQueue(): Promise<void> {
  if (flushing) return
  if (!getToken()) return
  const queue = loadQueue()
  if (queue.length === 0) return
  flushing = true
  try {
    const result = await flushQueue(queue, api())
    queueCache = result.queue
    saveQueue()
  } catch {
    /* retried later */
  } finally {
    flushing = false
  }
}

export function startAniListWorker(): void {
  void processAniListQueue()
  setInterval(() => void processAniListQueue(), 60_000)
}

export function onChapterFinished(p: {
  seriesUrl: string
  chapterUrl: string
  chapterTitle: string
}): void {
  if (!getToken()) return
  const link = getAniListLink(p.seriesUrl)
  if (!link) return
  const detail = getSeriesCached(p.seriesUrl)
  const chapters = detail?.chapters ?? []
  const progress = progressToSync(p.chapterTitle, chapters, p.chapterUrl)
  if (progress === null || progress < 0) return
  const status = anilistStatusForFinishedChapter({
    chapterUrl: p.chapterUrl,
    chapters,
    seriesStatus: detail?.status
  })
  queueCache = enqueueUpdate(loadQueue(), {
    mediaId: link.mediaId,
    progress,
    status,
    seriesUrl: p.seriesUrl
  })
  saveQueue()
  scheduleAniListFlush()
}

export async function importProgressFromAniList(): Promise<AniListImportResult> {
  if (!getToken()) throw new Error('Not connected to AniList')
  const links = Object.values(loadLinks())
  const result: AniListImportResult = { updated: 0, skipped: 0, failed: 0 }
  for (const link of links) {
    try {
      const remote = await api().getMediaProgress(link.mediaId)
      const remoteProgress = remote?.progress ?? 0
      const detail = getSeriesCached(link.seriesUrl)
      const chapters = detail?.chapters ?? []
      const local = getProgress(link.seriesUrl)
      const merged = mergeProgressForward({
        chapters,
        readUrls: local?.read ?? [],
        currentUrl: local?.chapterUrl,
        currentPos: local?.pos,
        remoteProgress
      })
      if (!merged.movedForward) {
        result.skipped++
        continue
      }
      const currentChapter = merged.currentUrl
        ? chapters.find((c) => c.url === merged.currentUrl)
        : undefined
      const changed = applyForwardProgress(
        link.seriesUrl,
        merged.addedRead,
        merged.currentUrl
          ? {
              chapterUrl: merged.currentUrl,
              chapterTitle: currentChapter?.title ?? local?.chapterTitle ?? '',
              pos: merged.currentPos ?? 0
            }
          : undefined,
        local
          ? undefined
          : {
              sourceId: sourceForHost(link.seriesUrl)?.id ?? '',
              title: detail?.title ?? link.title,
              cover: detail?.cover ?? link.cover ?? '',
              coverReferer: detail?.url ?? link.seriesUrl
            }
      )
      if (changed) result.updated++
      else result.skipped++
    } catch {
      result.failed++
    }
  }
  return result
}

