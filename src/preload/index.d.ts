import { ElectronAPI } from '@electron-toolkit/preload'

export interface GrabResult {
  url: string
  title: string
  pages: string[]
}

export type GrabResponse = { ok: true; data: GrabResult } | { ok: false; error: string }

/**
 * A site that is a JavaScript app reading its titles from a data feed (a JSON API). Yomi reads that feed directly:
 * the whole title list with genres in a few requests, chapter lists and chapter pages in one request each, with no
 * browser window. 'series-feed' = paged `series/` and `chapters/` lists (count / next / results).
 */
/** Where the app update stands: checking GitHub, up to date, downloading a newer Yomi, ready to install, failed. */
export type AppUpdateState =
  | { state: 'idle' | 'checking' | 'none' | 'dev'; current: string; checkedAt?: number }
  | { state: 'downloading'; current: string; version: string; percent: number; checkedAt?: number }
  | { state: 'ready'; current: string; version: string; checkedAt?: number }
  | { state: 'error'; current: string; error: string; checkedAt?: number }

export interface FeedApiDef {
  kind: 'series-feed'
  /** The feed's address, ending in a slash (for example https://appswat.com/v2/api/v2/). */
  base: string
}

export interface SourceDef {
  id: string
  name: string
  baseUrl: string
  /** List page URL with {n} replaced by the page number (1-based). */
  listTemplate: string
  /**
   * For sites that can only be listed through their search: one list per search term (a, b, c ...), all scanned and
   * merged. Each has {n} for the page number.
   */
  listTemplates?: string[]
  /** Regex source matching series page URLs. */
  seriesRe: string
  /** Regex source matching chapter page URLs. */
  chapterRe: string
  /** 0 means "no page scan" (the sitemap is the only source of titles). */
  maxPages: number
  /** The language the site is written in: 'ar' Arabic, 'en' English (found by reading its home page). */
  lang?: 'ar' | 'en' | 'other'
  /** Sitemap files that list every series; read first because it is complete and fast. */
  sitemaps?: string[]
  /** True once we have looked for a sitemap (so we don't look again on every launch). */
  sitemapChecked?: boolean
  /** The site was added from its sitemap alone (fast start); its list pages are still being worked out. */
  needsRefine?: boolean
  /** Made only to hold titles you added by address: never scanned, and not shown as a site. */
  titlesOnly?: boolean
  /** Came ready-made from the Yomi Library (your Yomi account), not added on this computer. */
  library?: boolean
  /** The site's data feed, when it has one (titles, chapters and pages are then read from it, not from web pages). */
  api?: FeedApiDef
  /**
   * Set when the site is taken out of rotation after a failed request. Missing means healthy. A background
   * probe clears it when the original address answers again, and rewrites baseUrl if the site has moved.
   */
  availability?: 'ok' | 'degraded' | 'down'
  availabilityAt?: number
  availabilityReason?: string
  /** The address this source used before the last automatic move. */
  previousBaseUrl?: string
  /** Set when this site came from an installed extension, not from Add a site or the built-in list. */
  extensionId?: string
  extensionVersion?: string
  /** Missing or true: the extension is in use. False: installed but turned off (catalog is kept). */
  extensionEnabled?: boolean
}

export interface SeriesEntry {
  sourceId: string
  url: string
  title: string
  cover: string
  /** The title was worked out from the URL (a sitemap has no titles); replaced by the real one later. */
  slugTitle?: boolean
}

export interface SearchHit {
  key: string
  title: string
  cover: string
  /** The cover as scanned (a small thumbnail), used if the full-size one fails to load. */
  coverFallback: string
  /** The title is a guess from the URL and/or there is no cover yet: the screen asks for the real ones. */
  needsInfo: boolean
  coverReferer: string
  entries: { sourceId: string; sourceName: string; url: string }[]
}

export interface SearchResult {
  total: number
  hits: SearchHit[]
  /** How many of all matching titles are known to be each type (for the filter tabs). */
  counts?: { manga: number; manhwa: number; manhua: number }
  /** Genres among the matching titles (as far as their pages said), most common first. */
  genres?: { name: string; count: number }[]
  /** How many of the matching titles have no known genres yet. */
  noGenre?: number
}

export interface SeriesDetail {
  url: string
  title: string
  cover: string
  description: string
  /** What the series page says about itself, when it says it (read from the page, never guessed). */
  type?: 'manga' | 'manhwa' | 'manhua'
  genres?: string[]
  status?: 'ongoing' | 'completed' | 'hiatus' | 'cancelled'
  /** `alts` are other links to the same chapter (other providers), tried if the main one fails. */
  /** `fill` / `fillName`: a chapter this site lacks, read from another of your sites. */
  chapters: { title: string; url: string; alts?: string[]; fill?: string; fillName?: string }[]
  /** The list looks too short for the newest chapter number (e.g. 2 chapters but the latest is Chapter 66). */
  incomplete?: boolean
  /** While a long list is still loading (partial updates only): how many chapters the page says it has. */
  expected?: number
}

export interface CrawlProgress {
  sourceId: string
  pages: number
  found: number
  done: boolean
  error?: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** One site's background genre reading, as the progress panel shows it. */
export interface GenreJob {
  id: string
  name: string
  state: 'waiting' | 'running' | 'done' | 'paused' | 'skipped'
  phase: string
  done: number
  total: number
  /** milliseconds left at the pace so far (null: not known yet) */
  etaMs: number | null
  tagged: number
  titles: number
  note?: string
  /** what is being read right now ("Action, page 120") */
  detail?: string
}

export interface SourceInfo extends SourceDef {
  count: number
  crawling: boolean
  /** A Yomi Library site while "Show the Yomi Library" is off: kept, but left out of Discover and search. */
  hidden: boolean
}

export interface AppSettings {
  /** Show the sites that came ready-made from the Yomi Library. */
  showLibrary: boolean
  /** Public AniList OAuth client id (not a secret). Empty until you paste one in Settings. */
  anilistClientId?: string
  /** Optional extension repo index URLs. Empty until you add one in Settings. */
  extensionRepos?: string[]
}

export interface InstalledExtension {
  id: string
  name: string
  version: string
  lang: 'ar' | 'en' | 'other'
  description?: string
  file: string
  kind: 'json' | 'js'
  sha256: string
  enabled: boolean
  sourceId: string
  baseUrl: string
  error?: string
}

export interface AvailableExtension {
  id: string
  name: string
  version: string
  lang: string
  url: string
  sha256: string
  repoUrl: string
  repoName?: string
  installedVersion?: string
  updateAvailable: boolean
}

export interface ExtensionsOverview {
  dir: string
  repos: string[]
  installed: InstalledExtension[]
  available: AvailableExtension[]
  errors: string[]
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

export interface AniListLink {
  seriesUrl: string
  mediaId: number
  title: string
  siteUrl?: string
  cover?: string
  linkedAt: number
}

export interface AniListImportResult {
  updated: number
  skipped: number
  failed: number
}

export interface HealthStep {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  ms: number
}

export interface HealthCheck {
  at: number
  overall: 'ok' | 'warn' | 'fail'
  steps: HealthStep[]
}

/** How a site is doing: outcome of the last 20 series opens, the last "Re-check", and a short outage history. */
export interface SiteHealth {
  sourceId: string
  ok: number
  incomplete: number
  failed: number
  lastAt: number
  lastError?: string
  check?: HealthCheck
  /** Taken out of rotation until a probe or a successful read puts it back. Missing means healthy. */
  availability?: 'ok' | 'degraded' | 'down'
  failedAt?: number
  reason?: string
  history?: { at: number; availability: 'ok' | 'degraded' | 'down'; reason: string; kind: string }[]
  /** When the background probe will try the original address again. */
  nextProbeAt?: number
  /** How long the last successful re-check took. Lower is faster. */
  speedMs?: number
}

export interface ProgressRecord {
  seriesUrl: string
  sourceId: string
  title: string
  cover: string
  coverReferer: string
  /** The chapter you were last reading, and how far through it (0..1). */
  chapterUrl: string
  chapterTitle: string
  pos: number
  /** URLs of chapters you finished. */
  read: string[]
  updatedAt: number
  /** Removed from "Continue reading" (the read marks are kept; reading again brings it back). */
  hidden?: boolean
}

export type ProgressPatch = Omit<ProgressRecord, 'read' | 'updatedAt'> & { markRead?: string }

export interface DownloadRequest {
  chapterUrl: string
  alts?: string[]
  chapterTitle: string
  seriesUrl: string
  seriesTitle: string
  sourceId: string
  referer: string
}

export interface DownloadItem {
  /** The chapter URL. */
  id: string
  seriesUrl: string
  seriesTitle: string
  sourceId: string
  referer: string
  chapterTitle: string
  /** Chapter link plus the other providers' links, tried in order. */
  urls: string[]
  /** Folder name under the downloads directory. */
  dir: string
  status: 'queued' | 'downloading' | 'done' | 'error' | 'removed'
  done: number
  total: number
  /** Saved file names, in page order (set when done). */
  files: string[]
  bytes: number
  error?: string
  /** A short note when the chapter was fetched from another site. */
  notice?: string
  queuedAt: number
}

export interface FollowMeta {
  seriesUrl: string
  sourceId: string
  title: string
  cover: string
  coverReferer: string
}

export interface NewChapter {
  title: string
  url: string
  alts?: string[]
  /** When the app noticed it. */
  at: number
}

export type FollowCategory = 'reading' | 'plan' | 'finished' | 'dropped'

export interface FollowRecord extends FollowMeta {
  following: boolean
  /** Your shelf for this series. Missing means Reading. Finished and Dropped are not checked for new chapters. */
  category?: FollowCategory
  /** Identities of every chapter seen so far; anything else that shows up is "new". */
  known: string[]
  newChapters: NewChapter[]
  lastChecked: number
  /** Download new chapters of this series by itself. Missing: the Settings switch decides. */
  autoDownload?: boolean
}

export interface FollowInfo extends Omit<FollowRecord, 'known'> {
  /** New chapters you haven't read yet. */
  unread: number
  unreadChapters: NewChapter[]
}

export interface UpdateStatus {
  checking: boolean
  lastChecked: number
  autoDownload: boolean
  following: number
}

export interface EnrichedEntry {
  url: string
  title: string
  cover: string
}

export interface MangaApi {
  /** Start reading a series' chapter list in the background (hovering its cover). */
  prefetchSeries: (sourceId: string, url: string) => Promise<void>
  /** The chapters found so far while a long chapter list is still being read. */
  onSeriesPartial: (cb: (d: SeriesDetail) => void) => () => void
  /** What the site detection is doing right now (shown while a site is being added). */
  onDetect: (cb: (msg: string) => void) => () => void
  /** Fills in the real title / cover for series that only have a URL-derived title. Returns what it found. */
  enrich: (urls: string[]) => Promise<EnrichedEntry[]>
  followList: () => Promise<FollowInfo[]>
  followGet: (seriesUrl: string) => Promise<FollowInfo | null>
  followSet: (meta: FollowMeta, following: boolean) => Promise<void>
  followDismiss: (seriesUrl: string) => Promise<void>
  followCategory: (seriesUrl: string, category: FollowCategory) => Promise<void>
  followAutoDownload: (seriesUrl: string, on: boolean | undefined) => Promise<void>
  updatesCheck: () => Promise<void>
  updatesStatus: () => Promise<UpdateStatus>
  updatesSetAutoDownload: (on: boolean) => Promise<void>
  onUpdates: (cb: (s: UpdateStatus) => void) => () => void
  /** Last known chapter list for a series (instant), or null. */
  getSeriesCached: (url: string) => Promise<SeriesDetail | null>
  /** Warms the page-list cache for a chapter; resolves with its first page URLs. */
  prefetchChapter: (url: string) => Promise<string[]>
  downloadEnqueue: (reqs: DownloadRequest[]) => Promise<void>
  downloadList: () => Promise<DownloadItem[]>
  downloadGet: (chapterUrl: string) => Promise<DownloadItem | null>
  downloadCancel: (id: string) => Promise<void>
  downloadRemove: (id: string) => Promise<void>
  /** Deletes several downloads (their files too) at once. */
  downloadRemoveMany: (ids: string[]) => Promise<void>
  titleAdd: (url: string) => Promise<
    Result<{
      sourceId: string
      sourceName: string
      url: string
      title: string
      cover: string
      chapters: number
      siteIsNew: boolean
      already: boolean
    }>
  >
  titleList: () => Promise<
    {
      sourceId: string
      sourceName: string
      url: string
      title: string
      cover: string
      chapters: number
    }[]
  >
  titleRemove: (url: string) => Promise<void>
  titleImport: (
    list: {
      sourceId: string
      sourceName: string
      url: string
      title: string
      cover: string
      chapters: number
    }[]
  ) => Promise<void>
  windowControl: (action: 'minimize' | 'maximize' | 'close') => void
  /** How far the genre scan of each site has got. */
  genreStatus: () => Promise<{
    sites: Record<
      string,
      { at: number; genres: number; titles: number; note?: string; running?: boolean }
    >
    progress: Record<string, string>
  }>
  genreScanNow: (id: string) => Promise<boolean>
  /** The background genre reading, one entry per site (for the progress panel). */
  genreJobs: () => Promise<GenreJob[]>
  /** A newer Yomi downloaded from GitHub and waiting to be installed (null when there is none). */
  updateStatus: () => Promise<{ version: string } | null>
  /** Restarts Yomi into the downloaded update. */
  updateInstall: () => Promise<void>
  onUpdateReady: (cb: (u: { version: string }) => void) => () => void
  /** Where the app update stands (for Settings → Updates). */
  appUpdateState: () => Promise<AppUpdateState>
  /** Looks for a newer Yomi on GitHub now (it downloads by itself when there is one). */
  appUpdateCheck: () => Promise<AppUpdateState>
  onAppUpdateState: (cb: (s: AppUpdateState) => void) => () => void
  downloadGetPaused: () => Promise<boolean>
  downloadSetPaused: (on: boolean) => Promise<boolean>
  offlineGet: () => Promise<boolean>
  offlineSet: (on: boolean) => Promise<boolean>
  downloadExportCbz: (ids: string[]) => Promise<{ written: number; skipped: number } | null>
  /** How many chapters download at the same time (1 to 8). */
  downloadGetConcurrency: () => Promise<number>
  downloadSetConcurrency: (n: number) => Promise<number>
  onDownload: (cb: (i: DownloadItem) => void) => () => void
  progressGet: (seriesUrl: string) => Promise<ProgressRecord | null>
  progressSave: (p: ProgressPatch) => Promise<void>
  progressRecent: (limit: number) => Promise<ProgressRecord[]>
  progressHide: (seriesUrl: string) => Promise<void>
  grabChapter: (url: string) => Promise<GrabResponse>
  /** Whether a source is in rotation, and the address a probe is watching. */
  sourceState: (id: string) => Promise<{
    availability: 'ok' | 'degraded' | 'down'
    name: string
    baseUrl: string
    reason?: string
  }>
  /** A failed read. Network errors, 5xx, timeouts, browser checks and domain moves take the source out. */
  sourceFailed: (
    id: string,
    message: string
  ) => Promise<{ kind: string; availability: 'ok' | 'degraded' | 'down'; outOfRotation: boolean }>
  /** Up to 5 other sites with this title: your pin, then last read, then the fastest healthy site. */
  fallbackSites: (
    title: string,
    excludeIds: string[]
  ) => Promise<{ sourceId: string; sourceName: string; url: string }[]>
  /** Asks for a Mihon / Tachiyomi backup file and imports its library (null when no file was chosen). */
  mihonImport: () => Promise<{
    total: number
    followed: number
    alreadyFollowed: number
    withProgress: number
    chaptersMarked: number
    notFound: string[]
  } | null>
  onMihonProgress: (cb: (p: { done: number; total: number; title: string }) => void) => () => void
  /** AniList's recommendations for a title, kept to the titles on your sites. */
  recsSimilar: (title: string, seriesUrl?: string) => Promise<SearchHit[]>
  /** "Because you read X" rows, from the series you read most recently. */
  recsBecause: () => Promise<{ title: string; hits: SearchHit[] }[]>
  /** Chapters this list lacks (holes, or newer ones) that your other sites have for the same title. */
  fillGaps: (
    title: string,
    sourceId: string,
    chapters: SeriesDetail['chapters']
  ) => Promise<SeriesDetail['chapters']>
  /** Remember which site you chose with "Read from". A repair does not change this. */
  pinSite: (title: string, sourceId: string) => Promise<void>
  pinnedSite: (title: string) => Promise<string | null>
  listSources: () => Promise<SourceInfo[]>
  /** True while the library could not be read from disk (it is tried again by itself). */
  catalogTrouble: () => Promise<boolean>
  restartApp: () => Promise<boolean>
  catalogDiagnose: () => Promise<string>
  /** A line from the screen into data-log.txt. */
  clientLog: (m: string) => void
  siteHealth: () => Promise<SiteHealth[]>
  /** Tests one site end to end (titles, chapter list, chapter pages, an image). */
  siteCheck: (id: string) => Promise<SiteHealth>
  addSite: (url: string) => Promise<Result<SourceInfo>>
  removeSite: (id: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  /** The bytes of a page picture shown in the reader (for cutting off white borders). */
  pageBytes: (src: string) => Promise<{ type: string; data: Uint8Array } | null>
  crawl: (id: string) => Promise<void>
  cancelCrawl: (id: string) => Promise<void>
  /** `sourceIds`: the sites to search; an empty list searches all of them. */
  search: (
    q: string,
    sourceIds: string[],
    sort: 'site' | 'az' | 'za' | 'sites' | 'genre',
    offset: number,
    limit: number,
    kind?: 'manga' | 'manhwa' | 'manhua',
    genre?: string
  ) => Promise<SearchResult>
  /** auto: saved list (a quick look at the newest chapters if it is old); check: that look now; full: read everything again. */
  getSeries: (
    sourceId: string,
    url: string,
    mode?: 'auto' | 'check' | 'full'
  ) => Promise<Result<SeriesDetail>>
  onProgress: (cb: (p: CrawlProgress) => void) => () => void
  /** AniList tracking (opt-in). Does nothing until you connect an account in Settings. */
  anilistStatus: () => Promise<AniListStatus>
  anilistSetClientId: (id: string) => Promise<AniListStatus>
  anilistConnect: () => Promise<AniListStatus>
  anilistDisconnect: () => Promise<AniListStatus>
  anilistSearch: (title: string) => Promise<{ hits: AniListMediaInfo[]; suggested: AniListMediaInfo | null }>
  anilistLink: (seriesUrl: string, media: AniListMediaInfo) => Promise<AniListLink>
  anilistUnlink: (seriesUrl: string) => Promise<void>
  anilistLinkFor: (seriesUrl: string) => Promise<AniListLink | null>
  anilistImport: () => Promise<AniListImportResult>
  extensionsOverview: () => Promise<ExtensionsOverview>
  extensionsAddRepo: (url: string) => Promise<{ ok: true; repos: string[] } | { ok: false; error: string }>
  extensionsRemoveRepo: (url: string) => Promise<string[]>
  extensionsInstall: (url: string, sha256: string) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  extensionsRemove: (id: string) => Promise<void>
  extensionsSetEnabled: (id: string, enabled: boolean) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: MangaApi
  }
}
