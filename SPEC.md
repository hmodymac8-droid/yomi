# Manga Reader: Product Spec

A personal Windows desktop app for reading manga, manhwa and manhua. You add any website yourself, the app builds one searchable catalog from all of them, and you read in the app's own clean reader or offline from downloads. Personal use only. The app is a polite client: rate limits, caching, and respect for robots.txt.

Status: in active development (Electron + React + TypeScript). This spec describes what is built, what is known to be limited, and what is planned.

---

## 1. Goals

1. **Add any site.** Paste a site address and the app works out how to read it. No coding.
2. **One catalog.** Titles from every site merged into one searchable, browsable grid.
3. **Own reader.** No ads or clutter. Vertical (webtoon) and paged modes, resume where you left off.
4. **Download chapters** for offline reading, and export them as CBZ.
5. **Follow series** and be told about new chapters.
6. **Fast and reliable.** Lists and chapters open quickly, failures are visible and retryable, and the app never hammers a site.

Non-goals: redistribution, accounts or sync, mobile, other operating systems (for now), bypassing bot protection or paywalls.

---

## 2. Platform and stack

- Windows desktop. Electron (main, preload, renderer), React, TypeScript, Vite.
- Electron's Chromium lets the app load JavaScript-heavy sites in hidden windows when plain requests are not enough.
- Data is stored as JSON files in the user data folder, with no database server.
- Main process owns all site access, storage, downloads and background work. The renderer only talks to it through a typed IPC bridge. Every IPC call returns `{ ok: true, data } | { ok: false, error }`.

---

## 3. Features

### 3.1 Sites (sources)

- **Add a site** by pasting its address. Detection order:
  1. Built-in adapters for known sites.
  2. Sitemap and `robots.txt` discovery.
  3. Page analysis: find the "all titles / browse" listing and its pagination (`probePagination` is run on every candidate list page).
  4. Search-as-list fallback, only if `robots.txt` allows it.
- **Sites screen**: lists every site with its title count and status, with refresh and remove.
- **Titles-only sites**: a site created only by adding a single title is hidden from the site chips, and its title is merged into the matching full site if one exists.
- **Known limits**: Swarm chapter table is empty; comix.to (403), mangadot.net (human check) and Toonz (Cloudflare) are blocked by protection.
- **Planned**: a point-and-click "teach-a-site" builder for stubborn sites (click title, chapter list and page images; the app records the selectors as a shareable JSON definition).

### 3.2 Catalog and main page

- Catalog (`catalog.json`) holds sources, series per source, scan state and the "Added by me" list. It is built progressively and kept up to date incrementally.
- **Main page**: cover grid with site chips, a search box (local, instant), and sort by site order or A to Z.
- **Shelves**: "All titles" and "Added by me (n)".
- **Added by me**: paste the address of one title and it is saved on this shelf. Buttons: "Add title" and "Add + download all". Each card has a remove button. Removing keeps downloaded chapters.
- **Merging**: the same title on several sites shows as one card with all sources.
- **Known limit**: some sites cap their public browse list (Projectsuki shows 307 titles). The rest is reachable only through search, which `robots.txt` disallows, so the app does not scan it.
- **Planned**: filter by type (manga, manhwa, manhua), genre and status; sort by latest or popular. This needs metadata the catalog does not store yet, to be read lazily, followed and in-progress titles first.

### 3.3 Series page

- Cover, title, description, chapter list with read/unread marks, continue-reading button, follow toggle, per-chapter and bulk download.
- Chapter lists are cached (`series-cache.json`) and refreshed on open. When a list is already saved it shows instantly while the fresh one loads.
- In offline mode the page shows only what is downloaded.

### 3.4 Reader

- Vertical scroll (webtoon) and paged modes, keyboard navigation, next and previous chapter, progress saved per chapter and per series.
- Page images come from the fastest method that works for the site: plain page, light render, or full hidden browser. The method is remembered per site.
- Numbered-image sites that expose only one page per screen: the app follows the numbering with quick HEAD checks (plain, padded and prefixed name variants) until the images end.
- Images load through a proxy that sends the correct Referer, since many CDNs block direct linking.
- **Planned**: right-to-left mode, double page, zoom and fit options, themes, preloading the next chapter.

### 3.5 Following and updates

- Follow a series to track it. Shelves for reading, finished and dropped.
- `checkAll` looks for new chapters in followed series and marks them with a "new" count.
- **Chapter-list pre-load**: a polite background task reads the full chapter list of followed and in-progress series that have no saved list. Starts 2 minutes after launch, repeats every 2 hours, one series at a time with 3-second pauses, at most 12 per run, with a 6-hour backoff on failure. Skipped with `MR_NOPRELOAD`.

### 3.6 Downloads

- Queue with configurable concurrency, per-chapter state (queued, running, done, failed), retry, and delete.
- **Pause and Resume** all downloads (a paused item goes back to queued).
- **Offline mode**: no site requests at all; series pages show downloaded content only.
- **Export as CBZ** for selected chapters or all. Store-only ZIP with CRC32, written by the app itself.
- Settings (`concurrency`, `paused`, `offline`) persist in `download-settings.json`.

### 3.7 Arabic and RTL text (planned)

- Tidy display of Arabic titles and chapter names: correct direction, alignment, font and sorting.

### 3.8 Settings (planned)

- Reader defaults, download folder and concurrency, update interval, data export and import, cache clearing.

---

## 4. Architecture

| Area | File(s) | Role |
|---|---|---|
| Main entry, IPC | `src/main/index.ts` | Window, all `ipcMain.handle` routes, dev harnesses |
| Catalog | `src/main/catalog.ts` | Store, merge, search, series cache, add-by-address, added list |
| Site detection | `src/main/sources.ts` | `detectSource`, sitemap, listing analysis, pagination |
| Page grabbing | `src/main/fastgrab.ts`, `grabber.ts` | Chapter page lists, three fetch modes, numbered-image extension |
| Downloads | `src/main/downloads.ts` | Scheduler, pause, offline, CBZ writer |
| Background work | `src/main/updates.ts` | `checkAll`, `preloadLists`, scheduler |
| Bridge | `src/preload/index.ts`, `index.d.ts` | Typed API exposed to the renderer |
| UI | `src/renderer/src/` | `App.tsx`, `Browse`, `Series`, `Reader`, `Downloads`, `Sites` |

Principles:
- All network access lives in the main process, rate limited and cached.
- Failures never crash a view: errors are returned as data and shown with a retry.
- Background tasks are sequential, paused during heavy foreground work, and back off on errors.

---

## 5. Data

Stored under the user data folder:

- `catalog.json`: `sources`, `series` (per source), `scan`, `scanAt`, `added`.
- `series-cache.json`: saved chapter lists per series.
- `download-settings.json`: concurrency, paused, offline.
- Library data: follows, shelves, reading progress.
- Downloaded chapters as image folders, exportable to CBZ.

Dev test runs use a throw-away folder in `%TEMP%` (`manga-reader-devtest<MR_DATADIR>`), so tests never touch real data.

---

## 6. Behavior and quality rules

- **Polite**: sequential background scans, pauses between requests, `robots.txt` respected, no override of disallowed search scanning.
- **Resilient**: every site method has a fallback; a site that fails is skipped, backed off, and reported.
- **Honest UI**: loading, empty, offline and error states are always shown; no silent failures.
- **Private**: no accounts, no telemetry; everything stays on the machine.

---

## 7. Roadmap

Done: universal reader and detection, catalog, library and following, downloads with pause/offline/CBZ, add-by-address and "Added by me", titles-only merge, numbered-image chapter fix, chapter-list pre-load.

Next, in order:
1. Arabic title and chapter display tidy-up.
2. Genre, type and status filters, and latest/popular sorting (lazy metadata enrichment).
3. Settings screen.
4. Point-and-click site builder.
5. Open problems: Swarm chapter list; protected sites (comix.to, mangadot.net, Toonz).
6. **Windows installer, last** (electron-builder).

---

## 8. Acceptance checks

- Paste a new site address: titles appear in the catalog without any configuration.
- Search a title: instant results, merged across sites.
- Open a series that was pre-loaded: chapters show immediately.
- Read a chapter on a numbered-image site: every page loads, in order.
- Queue downloads, pause, resume, restart the app: state persists and resumes.
- Turn on offline mode: only downloaded chapters open, with no network requests.
- Export chapters to CBZ: the files open in a standard comic reader.
- Add a single title by address: it appears under "Added by me", survives restart, and can be removed.
