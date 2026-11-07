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

## OPEN PROBLEMS (most important first)
1. **Chapter lists are incomplete on many sites** (e.g. Manganato.gg showed 2 chapters, Weeb Central 1, WebtoonClub 16 of 43).
   Causes found: (a) the fast path was trusted although it read a half-loaded page, and both paths agreed on the wrong
   answer; (b) chapters found only by address ("chapter-12"), missing sites with opaque addresses; (c) not waiting for the
   page's own data requests; (d) bad lists were saved. **Fixes were just written but NOT tested**: text-based chapter
   detection, `waitXhrIdle`, `looksIncomplete` (rejects the fast result, flags `SeriesDetail.incomplete`), saved lists and
   learned `|series` verdicts reset (version bump), "Start Reading" buttons excluded, titles cleaned.
   TODO: rebuild, test Manganato.gg `/manga/the-spirit-suppressing-museum` (should list ~66), Weeb Central, WebtoonClub;
   add a warning banner in `Series.tsx` when `detail.incomplete` is true (not written yet).
2. **Grid shows stale rows when switching the site filter** (first two rows stay from the previous site). Not investigated.
   Suspects: `Browse.tsx` hits state (append vs reset race in `runSearch`, the enrichment patch `setHits(prev => ...)`), or
   the "site order" cover-first sort in `catalog.ts search()`. Reproduce first.
3. **The "smooth sites" list I gave was too generous**: the whole-chain test accepted any site with >=1 chapter. Tighten
   MR_SITEPIPE (best of 6 titles must have >=8 chapters and not `looksIncomplete`) and re-run on the 28 that passed.
4. **Mangapill lists only its home page (38 titles).** Its only full list is search: `/search?q=a&page=N` (~30 pages per
   query, empty query shows nothing). Plan: one search per letter, merged. DONE: `SourceDef.listTemplates` and the scanner
   loops over them (`crawlSource`). NOT DONE: detection in `sources.ts` (capture the search form in SNAPSHOT/`Analysis`,
   try `?q=a`, `probePagination`, build 26 templates, `maxPages` ~120). Other "home page only" sites: Lua Comic, MangaTaro, Projectsuki.
5. comix.to refuses chapter lists (HTTP 403) from this connection; titles still work. Wait and retry.
6. mangadot.net is behind a human check the app's browser can't pass.

## Not built yet
Point-and-click "teach it this site" builder, genre/type filters, CBZ export, settings screen, clicking through the
Following screen by hand (built, never opened). Everything above was verified with scripted tests, not by using the window.
