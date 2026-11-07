# Manga Reader: where we stopped

A Windows desktop app (Electron + React + TypeScript) that reads manga/manhwa from many sites in one reader of your own.
Run it: open a terminal in this folder and run `npm run dev`. Check code: `npm run typecheck`, `npx electron-vite build`.

## What exists and works
- **Add any site** by pasting its URL. Detection: robots.txt -> sitemap (complete title list in seconds) -> list-page scan
  (pagination guessed) -> fallbacks. Sitemap sites start in ~1 s; others take 6-13 s (progress text is shown).
- **Catalog + search bar**, merged by title across sites, covers cached on disk, lazy title/cover filling for sitemap-only titles.
- **Series page**: chapter list read once, then saved; later only a quick "newest page" check (30 min), plus buttons
  *Check for new chapters* / *Reload full list*. Hover a cover to pre-load its list.
- **Reader**: webtoon + paged modes, next/prev chapter (pre-loaded), position + "read" marks saved, Continue reading row.
- **Downloads** (offline reading), **Following** screen (everything you follow), **new-chapter checker** (every 30 min,
  Windows notification, optional auto-download).
- **Site picker** (Browse top bar): tick which sites to search, "only" shortcut, remembered (localStorage `pickedSites`).
  Search over ~300k titles: page turns ~0 ms, searches 40-230 ms; title index warmed 4 s after launch.
- Safety nets: main-process errors are logged (not fatal), failed search keeps the grid, a crashing screen shows a reload button.
  NOT yet clicked through by hand: site picker, paging/scroll-to-next, Following screen.
- Speed work: plain-HTTP fast path verified against a real browser per site, spare hidden window, tracker blocking.
- "Verify you are human" pages (Cloudflare etc.): the app opens a normal window for you to pass it, never automates it.

## Data (your PC)
`%APPDATA%\manga-reader\`: catalog.json, progress.json, updates.json, series-cache.json, hostmode.json, downloads/, imgcache/.
Dev test runs use `%TEMP%\manga-reader-devtest*` instead (never your data).

## Dev test helpers (set an `MR_...` variable, run `npx electron .` after `npx electron-vite build`)
MR_CRAWL=`site,pages` (+MR_CRAWL_SERIES=`1|url`), MR_SMOKE=`chapter url`, MR_DISCOVER, MR_SITECHECK=`json`, MR_SITEPIPE=`json`
(whole chain per site; MR_DATADIR / MR_PIPEOUT let several run side by side), MR_ANCH=`series url`, MR_BENCH, MR_OPENTEST,
MR_QUICK, MR_UPDTEST, MR_DLTEST, MR_MOELIST=`everythingmoe section url`. MR_NOHUMAN=1 stops them opening windows.
Results of the big site survey are in `docs/site-tests/` (sc1 = cheap checks, out0-3 = whole chain).

## STATUS OF THE EARLIER PROBLEMS (updated)
- **Chapter lists too short**: fixed for Manganato.gg (box that scrolls by itself loads the next 50), Weeb Central
  (chapters recognised by their text, not only their address), WebtoonClub ("Show all N chapters" button). Also: wait for
  the page's data requests (`waitXhrIdle`), reject fast-path answers that look cut short (`looksIncomplete`), banner +
  *Reload full list* in the series screen, saved lists and learned verdicts reset (versions bumped), consistent names
  ("Chapter N"). Verified by scripted tests, not by clicking.
- **Stale rows when switching site**: cause was a "load more" request overtaking the new-list request. Fixed with a
  generation counter in `Browse.tsx` (typechecked, not tried in the window).
- **Mangapill only 38 titles**: fixed. Detection now falls back to the site's search (one search per letter, merged;
  `SourceDef.listTemplates`). Short test: 3,589 titles from 3 pages per letter. A full scan takes several minutes.
- **Site test made strict** (MR_SITEPIPE): WORKS = best of 6 titles has 8+ chapters, not cut short, 4-80 pages, real image.
  Results: `docs/site-tests/strict0-3.txt` (31 sites): 13 WORKS, 16 CHECK, 2 FAILED.

## OPEN PROBLEMS NOW
1. **Chapter lists cut short**: FIXED for TopManhua (935), JustManga (144), MangaK, XComic (72), Mangapill. Causes:
   (a) scripted `.click()` is ignored by many sites -> now a real mouse click is sent to the window (`clickMarked`,
   with click-through for ad overlays); (b) the page states its chapter count (`DECLARED_TOTAL`) -> keep trying and
   mark incomplete if short; (c) slices with their own address (`?chapter_page=2`) -> `queryPaging`; (d) aggregator
   pages with a list per source (`/source/xyz`) -> follow the biggest source; (e) addresses like
   `vol-2-chapter-16-title` and titles "Vol.N Chapter M" -> `underBase`. Mangapill's "CHECK" is only the test's odd
   134-page pick (a real chapter has 14 pages). Debug helpers: MR_PAGERDEBUG=1, MR_ANCH_CLICK=1 with MR_ANCH.
   New: **Continue reading** cards have a hover x that removes them (read marks kept).
2. **Odd page counts** (chapter page list may include non-page images): Manganato.gg 453, Manhuaus 238, mangageko 102,
   FreeManhwa 112, PandaToons 92, Weeb Central 141; Nyx/Toonz/Projectsuki only 3 pages. Compare with the real chapter.
3. comix.to refuses chapter lists (HTTP 403) from this connection; titles work. mangadot.net needs a human check the
   app's browser can't pass. Fropi timed out (100 s) in the strict test; Swarm's image download failed.
4. The Spirit Suppressing Museum (Manganato.gg) lists 79 chapters for a newest chapter of 66: check for stray entries.
## Not built yet
Point-and-click "teach it this site" builder, genre/type filters, CBZ export, settings screen, clicking through the
Following screen by hand (built, never opened). Everything above was verified with scripted tests, not by using the window.

## Added later: sites that number chapters by address only (mangasid.com, mangadar.com)
- Chapter links like `/reader/<slug>/138` (no "chapter" word, Arabic link text) were not recognised -> 0 chapters.
  Now: `slugNum` rule in `parseSeries` and `seriesScript` (link ending in `<series-slug>/<number>`), Arabic "فصل" in `byText`,
  and chapter addresses are also picked out of data inside the page (JSON script tags).
- List detection counted such chapter links as series on home pages (`isChapterGroup` now also rejects `…/slug/<number>`).
- First-time static-vs-browser check: plain HTTP wins when it finds clearly more chapters than the browser view.
- Series cache version 5. Debug: MR_PIPEDEBUG=1 prints per-series chapter counts. Sites added before this fix must be
  removed and added again (their catalog holds chapter links as titles).
- Chapter lists split by plain pager links (`…/series/ABC?page=2`, olympustaff.com): the browser path now walks those
  addresses (`queryPaging` with no declared total) and the static path defers to it. MR_PIPESERIES=<series url> tests one series.
- Self-checking lists: `looksIncomplete` also flags holes in the numbering (21..60 then 0); when a full read still looks
  incomplete, `browserSeries` tries plain-address paging (`queryPaging`) before giving up. Known open: MangaK series
  often come back with a constant 11 chapters flagged incomplete (same before this change; not a regression).
  Next for this idea: capture the page's own JSON data requests and use a chapter array from them.
- **Sites screen** (Browse top bar > Sites): per site a status dot (Working / Needs a look / Broken), title count, your last 20
  series opens (fine / cut short / failed), and Re-check (title list, chapter list, chapter pages, one image; saved in
  site-health.json), Re-scan titles, Re-check all. Code: `src/main/health.ts`, `runSiteCheck` in index.ts, `Sites.tsx`.
  Dev test: MR_HEALTHTEST=<site url> (use a fresh MR_DATADIR per site). Screen itself never clicked by hand.
- MangaK (constant 11 chapters) FIXED: the page's own JSON data requests are repeated and read (`HARVEST_DATA`), embedded
  data with root-relative chapter addresses is parsed, `DECLARED_TOTAL` ignores years ("Released 2025 Chapters 96")
  and prefers the most trusted pattern. Olympustaff: a link back to the series page ("latest: Chapter 204" banner) is no
  longer a chapter, and a paging style that returns page 1 again no longer counts as a new slice. Cache version 7.
- **Automatic title scans**: 25 s after launch and every 30 min, `autoScan` (index.ts) scans each site that is due, one at
  a time (`scanDue` in catalog.ts): unfinished scans retry after 30 min and resume where they stopped; finished ones
  refresh every 12 h for new titles. Dev: MR_AUTOSCAN_FAST=1 (1 s waits), MR_NOAUTOSCAN=1 (off). Tested by script only.
- Order of work agreed with the user: self-checking lists (done), Sites screen (done), MangaK (done), auto scans (done),
  then reading features, library, downloads (CBZ/queue), preload followed series, Arabic display, settings,
  teach-a-site builder, and the INSTALLER LAST (user said so).
- **Reader upgrades**: settings remembered (localStorage `reader.*`): mode, fit, direction (Left→Right / Right→Left), background
  (Dark/Black/Sepia), page width zoom (− / +). Paged mode: click left/right third to turn (direction aware), preloads the
  next 3 pages + previous one, arrows/Space/PageUp/PageDown. Shortcuts: M mode, F fit, D direction, +/- zoom, Esc back.
  Written and typechecked, never tried in the window.
- Reader top bar floats and auto-hides (hides 2.2 s after it shows, at once when scrolling down; shows when the mouse
  is within 60 px of the top). Ctrl + mouse wheel / pinch changes page size (width fit: page width; height fit: page height).
- **Library shelves**: Following has tabs (All / Reading / Plan to read / Finished / Dropped) with counts, a title search,
  "New chapters only", and a per-card shelf picker. Finished and Dropped series are not checked for updates. Data:
  `FollowRecord.category` in updates.json, IPC `follow-category`. A site that lists one title twice now shows once in
  "Read from". Typechecked and built, never clicked by hand.
- Browse: the site chips row folds away (button '▸ 11 sites', remembered; collapsed by default, auto-open when no sites).
- **Downloads selection**: drag a box over rows (auto-scrolls near the top/bottom edge), click toggles a row, Shift range,
  Ctrl keeps earlier picks, click a series name to select its whole series, Ctrl+A, Delete key, Esc. Buttons: Select all,
  Delete selected, Delete all (each with a confirm). Bulk IPC `download-remove-many`. Drag, auto-scroll and delete were
  tested in a temporary mock page in the browser pane (removed afterwards); not tried with real downloads.
- **Parallel downloads**: Downloads screen has "Download at the same time: 1-8 chapters" (default 3, saved in
  download-settings.json). `pump` in downloads.ts starts queued chapters until the limit is reached. Dev test:
  MR_DLPAR=<n>,<url>,<url>... (12 olympustaff chapters: 14.6 s at 1, 9.5 s at 6).
- Bulk delete no longer freezes the app: `removeDownloads` (downloads.ts) updates the saved list once and removes folders
  in the background (async, 4 at a time); the screen drops the rows in one step. Also fixed: a deleted chapter could not
  be downloaded again (a leftover "cancelled" flag). Test: MR_DLPAR prints DLDEL / DLAGAIN.
## Open-problem review (after the 'fix what you can' pass)
- Odd page counts (Manganato.gg 453/104, PandaToons 92): NOT a bug. The pages are one folder numbered 0..N in order,
  i.e. long webtoon chapters. Nyx/Projectsuki "3 pages": the newest chapter was locked and the list held only site icons
  (apple-touch-icon). FIXED: `NOT_PAGE` in staticParse.ts now drops icons/logos/favicons wherever they sit in the file
  name, so a locked chapter shows "no pages" instead of icons.
- Toonz: its "series" were menu pages (/manga/top-rated, /browse...). FIXED: `isNavUrl` (catalog.ts) keeps menu pages out
  of catalogs and prunes them on load. Toonz is behind Cloudflare (403 to plain HTTP) so it now honestly fails: no titles.
- Spirit Suppressing Museum 79 vs 66: NOT a bug (half chapters such as 1.5, 2.5 count as chapters).
- Fropi: works now (50 chapters, 11 pages); the earlier timeout was temporary.
- Swarm: chapter table stays empty (even in a normal browser pane); only a few "latest" chapters are found. OPEN.
- Still blocked by the sites: comix.to (403 for chapter lists), mangadot.net (human check).
- Debug aids: MR_PIPEDEBUG prints PIPETRY (per series) and PIPECH (newest chapter + pages).
