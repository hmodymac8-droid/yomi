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
