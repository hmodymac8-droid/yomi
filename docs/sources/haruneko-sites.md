# Sites from HaruNeko

Survey of the site connectors in [HaruNeko](https://github.com/manga-download/haruneko) (Unlicense, public domain), the maintained successor of HakuNeko. Taken 2026-11-17 from 790 connectors; 220 are English or Arabic and are listed below. "Check" is the HTTP answer to a plain request from a desktop browser user agent.

**Batch 1 (sections 1–2), 2026-11-17:** 28 of 39 work and are in the app's Popular sites list ([x]). [-] = not added, with the reason after the row. Fixes this needed in Yomi: robots.txt Crawl-delay grouping, chapter pages whose canonical is the home page (Rizz), Arabic "read first / last" buttons, recipes for Fastest Manga and MangaOwl.

**Full test of batch 1, 2026-11-17 (commits 2c09417, baf91c3, b7cad11):** every [x] site was run end to end with `MR_SITEPIPE`: import the list, open a series, read a chapter's pages, see new chapters on a followed series (`newChapters === 2` after forgetting the newest two), and find new titles on a rescan (the list is newest-first or the site has a sitemap).

- **23 of 28 pass.** ManhwaNex shows few chapters per series and S2Manga has 96-page chapters; both are fine.
- **Image problems on the site's side, not in Yomi:**
  - 3asq and ZinManga: some older series have missing images on the site itself.
  - Top Manhua: the image server answers with error 526.
- **Fixed 2026-11-20:** Scythe Scans and Lagoon Scans.
  - Cause: Electron runs none of Yomi's reading scripts in a page until the page has fully loaded, and these sites take 8-15 s to finish loading files they don't need (Lagoon's series pages are ready after 0.7 s). Series, list, genre and chapter pages now get a few seconds after they are ready, then their leftovers are stopped (`loadPageSettled`, `settleLoading` in `grabber.ts`). Lagoon's test went from 139 s to about 56 s, and a series page from 10-15 s to under 4 s.
  - Lagoon still shows CHECK: the site itself keeps only the newest few chapters of each series.
  - Short chapter lists try the six "page 2" address styles at once instead of one after another.
- **Retest of all 28, 2026-11-20:** 19 WORKS (Violet after its fix below), 3 CHECK that are fine (Lagoon, MangaRead, ManhwaNex), 3 site-side image problems as before, and 3 sites that had trouble on their side that day (below).
  - AquaManga now shows a Cloudflare "verify you are human" check. It needs one human check in the app; the automatic test can't pass it.
  - S2Manga did not answer at all during the test (plain requests time out too).
  - Gourmet Scans started refusing all requests partway through the testing (probably rate limiting). Still open: the plain-page path decodes its protected chapters (17 pages from a saved copy of chapter 9), but the browser path, which the site's own script decodes, is not checked yet against the new early stop.
  - Violet Scans' newest chapter is sold. A site read through the browser never looked for the lock box, so it reported "no pages": it now checks the plain page for one.
  - The test tool gave every site the same id, so titles left over from the site before (or the last run) were tested in another site's name. Each site now gets its own id and only its own titles.
  - Login/Register button pictures are no longer taken for pages.
- **Fixes this needed in Yomi:**
  - A series' "chapter 2" link was taken for the list's page 2. Saved sites (3asq, olympustaff) are repaired on startup.
  - Sold and members-only chapters are reported as such.
  - Madara's protected chapter lists are decrypted.
  - Chapter pages come from the reader area first; stickers, icons and plugin art are skipped.
  - Madara chapter rows with odd addresses are now counted.
  - `debugForget` forgets chapter addresses too.

### To do

1. [x] Scythe Scans: works (see above).
2. [x] Lagoon Scans: works within the time limit (see above).
3. [ ] Gourmet Scans, once it answers again: clear `gourmetsupremacy.com|chapter` from the test `hostmode.json`, then `MR_CHTEST` must give about 17 pages for both `http` and `light`. If `light` gets none, the early stop cuts off the site's decoding script. Also recheck S2Manga.
4. [x] Section 3: the 20 sites behind Cloudflare (those needing a person to pass the check were dropped, 2026-11-21).
5. [ ] Section 4: the 89 sites on other engines or custom code (25 added 2026-11-21; see the notes there).
6. [ ] Section 5: the 5 adult sites.
7. [ ] Section 6: the 67 sites that didn't answer.
8. [ ] Recheck the [-] "list not found yet" sites (e.g. Armageddon) now that the page-2 fix is in.
9. [ ] Survey other languages (`haruneko-connectors.json`).

Every new site must pass the full `MR_SITEPIPE` run, new chapters and new titles included, not just the first import.

Work through the sections in order. Tick a site once it is added to Yomi and tested, or strike it out if it does not work.

## 1. Template sites, no special code (32)

Madara / MangaStream sites that HaruNeko reads with its standard template. Yomi should read these as they are. Start here.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [-] | EN | AquaManga | https://aquareader.org | Madara | 200 |
| [-] | EN | Armageddon | https://www.silentquill.net | MangaStream | 200 | list not found yet |
| [x] | EN | Eva Scans | https://evascans.net | MangaStream | 200 |
| [x] | EN | GD Scans | https://gdscans.com | Madara | 200 |
| [x] | EN | Gourmet Scans | https://gourmetsupremacy.com | Madara | 200 |
| [-] | EN | Hades Scans | https://hadesscans.com | MangaStream | 200 | under maintenance |
| [x] | EN | KingOfShojo | https://kingofshojo.com | MangaStream | 200 |
| [-] | AR | Kol Novel (ملوك الروايات) | https://kolnovel.com | MangaStream | 200 | novels (text chapters) |
| [-] | EN | KSGroupScans | https://ksgroupscans.com | Madara | 200 | robots.txt blocks all tools |
| [x] | EN | Lagoon Scans | https://lagoonscans.com | MangaStream | 200 |
| [-] | EN | LHTranslation | https://lhtranslation.net | Madara | 200 | robots.txt blocks all tools |
| [x] | EN | Madara Scans | https://madarascans.net/ | Madara | 200 |
| [x] | EN | Manga Eclipse | https://mangaeclipse.com | Madara | 200 |
| [x] | AR | 3asq (مانجا العاشق) | https://3asq.online | Madara | 200 |
| [x] | EN | MangaOwl.io | https://mangaowl.io | Madara | 200 |
| [x] | EN | MangaRead | https://www.mangaread.org | Madara | 200 |
| [x] | EN | MangaReaderSite | https://mangareader.site | MangaStream | 200 |
| [x] | EN | Mangasushi | https://mangasushi.org | Madara | 200 |
| [x] | EN | ManhwaNex | https://manhwanex.com | Madara | 200 |
| [x] | EN | Rackus | https://rackusreads.com | MangaStream | 200 |
| [-] | EN | ReadKomik | https://novelstreams.com | MangaStream | 200 | novels (text chapters) |
| [x] | EN | Rizz Comics | https://rizzfables.com | MangaStream | 200 |
| [x] | EN | Rokari Comics | https://rokaricomics.com | MangaStream | 200 |
| [x] | EN | S2Manga | https://s2read.com | Madara | 200 |
| [x] | EN | Scythe Scans | https://scythescans.com | MangaStream | 200 |
| [x] | EN | Tarot Scans | https://www.tarotscans.com | Madara | 200 |
| [x] | EN | ThunderScans | https://en-thunderscans.com | MangaStream | 200 |
| [x] | EN | Top ManhuaNET | https://topmanhua.net | Madara | 200 |
| [x] | EN | Tritinia Scans | https://tritinia.org | Madara | 200 |
| [x] | EN | Violet Scans | https://violetmanga.com | MangaStream | 200 |
| [x] | EN | Yaksha Comics | https://yakshacomics.com | Madara | 200 |
| [x] | EN | ZinManga | https://mangazin.org | Madara | 200 |

## 2. Template sites with a tweak (7)

Standard template plus some site-specific code in HaruNeko. Try in Yomi; port the tweak only if it fails.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [x] | EN | Asura Scans | https://asurascans.com | MangaStream (custom code) | 200 |
| [x] | AR | Fastest Manga | https://www.fastestmanga.com | Madara (custom code) | 200 |
| [-] | AR | مانجا ليك (Mangalek) | https://mangalik.net | Madara (custom code) | 200 | mirror of link-manga.net |
| [-] | AR | MangaLink | https://link-manga.net | Madara (custom code) | 200 | Cloudflare check needs a person; mirror of mangalik / sparkmanga / starzmanga, list one |
| [-] | AR | مانجا سبارك (MangaSpark) | https://sparkmanga.net | Madara (custom code) | 200 | mirror of link-manga.net |
| [-] | AR | مانجا ستارز (Mangastarz) | https://starzmanga.net/ | Madara (custom code) | 200 | mirror of link-manga.net |
| [-] | EN | ZinManga(.net) | https://www.zinmanga.net | Madara (custom code) | 200 | 96k titles; series page times out |

## 3. Behind Cloudflare (20)

A plain request got a Cloudflare challenge. Yomi's hidden browser window may still get through.

**2026-11-21:** MangaSwat and Stellar Saber no longer have the check, and both pass the full test (now in the site list).
- MangaSwat is read through its data feed (appswat.com). The test now counts a data feed as finding new titles: it is read in full on every rescan.
- Stellar Saber encrypts every page picture (AES-GCM; the site's own script decrypts it in the page, so a browser only sees `blob:` pictures). Yomi asks for the chapter's key like HaruNeko does (`flavor_cdn_get_key`), carries it after '#' on each page address, and decrypts after fetching: `src/main/sealed.ts`, used by the image server, downloads and the site check.
- The test now also loads the first page through the reader's image server (`readerImage`).
- The other 17 still show Cloudflare's "Just a moment" page to a plain request. Loaded in Yomi's hidden browser, 4 of them get through by themselves:
  - ManhwaTop (already built in) and Mgread pass the full test.
  - Batcave passes after three fixes:
    - its own check page (`/_c?t=…&u=<page>`) is waited out, not cut off (`waitPastCheckPage`);
    - chapters come from the page's `__DATA__` (`/reader/<news_id>/<id>`, `newsDataChapters`);
    - pages come from `__DATA__.images`, cut to its `pages` count like the site's reader does.
  - Webnovel Comics: not added. It is mainly a novel site; the comics found had 0-1 chapters, with the rest locked in its app.
- The remaining 13 (Bokugen, BrainRotComics, Dragon Tea, Kagane, Kissmanga, MagusManga, Manhua Us, Mist Scans, RageScans, Raven Scans, Read Comics Online, Shqqaa, XoManga) need a person to pass the check once, in the app's visible window. The automatic test can't do that.
- **2026-11-21, dropped: sites that need a person to pass a check.** The user decided sites that only work after
  someone passes a "verify you are human" check by hand are not wanted. Marked [-]: AquaManga (also taken out of the
  directory), Bokugen, BrainRotComics, Dragon Tea, Kagane, Kissmanga, MagusManga, Manhua Us, Mist Scans, RageScans,
  Raven Scans, Shqqaa and XoManga. (Dragon Tea gets past the check by itself now, but its pictures are refused.)
  Read Comics Online is left open: no check, but no chapters found yet.
- **The check window itself was broken (fixed 2026-11-21).** Yomi gave its pages a Chrome name per session; the
  background workers Cloudflare starts kept the old name, so the check saw two browsers, gave its pass and refused it,
  reloading forever with no box to click. The name is now set once for the whole app (`chromeName` in grabber.ts).
  A plain Electron window and the fixed Yomi both pass Dragon Tea, Kissmanga and AquaManga by themselves in a
  visible window; Raven shows a normal checkbox. `MR_HUMANLOOK=<url>,<folder>` (with `MR_HUMANPLAIN=1` for a session
  without Yomi's hooks) records what the check window shows.
- `MR_HTMLDUMP=<url>,<file>` saves a page as the hidden browser sees it (for sites that refuse plain requests).
- Full test of all 33 sites in the list, 2026-11-21: 24 WORKS, 3 CHECK as before (Lagoon, MangaRead, ManhwaNex), 3 site-side image problems as before (3asq, ZinManga, Top Manhua). AquaManga needs its human check, and Gourmet still doesn't answer. S2Manga is back and works.
  - KingOfShojo's newest chapter is a single picture, and the browser filled the gap with ad banners (pubadx.one). Ad-network pictures are never taken as pages now, and pubadx.one is blocked.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [x] | EN | Batcave | https://batcave.biz | custom (custom code) | 403 |
| [-] | EN | Bokugen Translation | https://bokugents.com | MangaStream | 403 |
| [-] | EN | BrainRotComics | https://brainrotcomics.com | Madara | 403 |
| [-] | EN | Dragon Tea Scans | https://dragontea.ink | Madara | 403 |
| [-] | EN | Kagane | https://kagane.moe | custom (custom code) | 403 |
| [-] | EN | Kissmanga | https://kissmanga.in | Madara | 403 |
| [-] | EN | MagusManga | https://magustoon.org | VTheme | 403 |
| [x] | AR | MangaSwat | https://meshmanga.com | custom (custom code) | 200 |
| [-] | EN | Manhua Us | https://manhuaus.com | Madara | 403 |
| [x] | EN | ManhwaTop | https://manhwatop.com | Madara | 403 (already built in) |
| [x] | EN | Mgread | https://mgread.io | InitManga | 403 |
| [-] | EN | Mist Scans | https://mistscans.org | custom (custom code) | 403 |
| [-] | EN | RageScans | https://ragescans.com | MangaStream | 403 |
| [-] | EN | Raven Scans | https://ravenscans.org | MangaStream | 403 |
| [ ] | EN | Read Comics Online | https://readcomicsonline.ru | custom | 403 |
| [-] | AR | موقع شقاع (Shqqaa) | https://www.shqqaa.com | custom | 403 |
| [x] | AR | Stellar Saber | https://stellarsaber.pro | custom (custom code) | 200 |
| [ ] | EN | Top Manhua | https://manhuatop.org | custom (custom code) | 403 |
| [-] | EN | Webnovel Comics | https://www.webnovel.com | custom (custom code) | 403 |
| [-] | EN | XoManga | https://xomanga.site | custom (custom code) | 403 |

## 4. Other engines and custom sites (89)

Online, but built on another engine or fully custom. Each needs checking; some need code ported from HaruNeko.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [ ] | EN | AllManga | https://mkissa.to | custom (custom code) | 200 |
| [ ] | EN | Arc-Relight | https://arc-relight.com | custom | 200 |
| [ ] | EN | Asmodeus Scans | https://asmotoon.com | custom (custom code) | 200 |
| [x] | EN | Asura Toons | https://www.asuratoons.info | custom | 200 |
| [ ] | EN | Atsumaru | https://atsu.moe | Grouple (custom code) | 200 |
| [ ] | AR | ازورا مانجا (AZORA MANGA / WORLD) | https://azorafly.com | VTheme | 200 |
| [ ] | EN | ComicHub Free | https://comichubfree.com | custom (custom code) | 200 |
| [ ] | EN | Comick (.live) | https://comick.live | custom (custom code) | 200 |
| [-] | EN | Comikey | https://comikey.com | custom (custom code) | 200 |
| [ ] | EN | Comix | https://comix.to | custom (custom code) | 200 |
| [-] | EN | CoolMic | https://coolmic.me | custom (custom code) | 200 |
| [ ] | EN | DeathTollScans | https://reader.deathtollscans.net | FoolSlide | 200 |
| [ ] | AR | Dilar | https://dilar.tube | custom (custom code) | 200 |
| [x] | EN | Diva Scans | https://divascans.org | NovelDexTheme | 200 |
| [x] | EN | Drake Scans | https://drakecomic.net | NovelDexTheme | 200 |
| [x] | EN | Elf Toon | https://elftoon.net | NovelDexTheme | 200 |
| [x] | EN | Eris Scans | https://erisscans.com | KeyoApp | 200 |
| [x] | EN | Flame Comics | https://flamecomics.xyz | custom (custom code) | 200 |
| [x] | EN | GenzToon | https://genztoons.org | KeyoApp | 200 |
| [x] | EN | GodaComic | https://manhuascans.org | GodaBase (custom code) | 200 |
| [ ] | EN | Hachirumi | https://hachirumi.com | Guya | 200 |
| [-] | EN | Hijala Scans | https://en-hijala.com | VTheme | 200 |
| [ ] | EN | Hive Scans | https://hivetoons.org | VTheme | 200 |
| [ ] | EN | HNI-Scantrad | https://hni-scantrad.net | PizzaReader | 200 |
| [-] | EN | HolonoMetria | https://holoearth.com | custom (custom code) | 200 |
| [-] | EN | Kayn Scan | https://kaynscans.com | NovelDexTheme | 200 |
| [x] | EN | Lua Scans | https://luacomic.org | HeanCMS | 200 |
| [ ] | EN | Magical Translators | https://mahoushoujobu.com | Guya | 200 |
| [-] | EN | MangaBat | https://www.mangabats.com | MangaNel | 200 |
| [ ] | EN | MangaCloud | https://mangacloud.org | custom (custom code) | 200 |
| [x] | EN | MangaDemon | https://demonicscans.org | custom | 200 |
| [ ] | EN | MangaFire | https://mangafire.to | custom (custom code) | 200 |
| [-] | EN | MangaFox | https://fanfox.net | DM5 (custom code) | 200 |
| [-] | EN | MangaFoxFun | https://mangafox.fun | MangaHubBase | 200 |
| [-] | EN | MangaFreak | https://ww3.mangafreak.me | custom (custom code) | 200 (already built in) |
| [ ] | EN | MangaGeko | https://www.mgeko.cc | custom (custom code) | 200 |
| [-] | EN | MangaHere | https://www.mangahere.cc | DM5 (custom code) | 200 |
| [-] | EN | MangaHereFun | https://mangahere.onl | MangaHubBase | 200 |
| [-] | EN | MangaKakalot | https://www.kakamanga.com | MangaNel | 200 |
| [-] | EN | MangaKakalotFun | https://mangakakalot.fun | MangaHubBase | 200 |
| [ ] | EN | MangaKatana | https://mangakatana.com | custom | 200 |
| [x] | EN | MangaKio | https://mangak.io | MangakBase | 200 |
| [x] | EN | Manganato | https://www.manganato.gg | MangaNel | 200 |
| [-] | EN | MangaOnlineFun | https://mangaonline.fun | MangaHubBase | 200 |
| [ ] | AR | Manga Origin | https://mangaoriginread.blogspot.com | ZeistManga | 200 |
| [ ] | EN | MangaPill | https://mangapill.com | custom (custom code) | 200 |
| [ ] | AR | MangaTales | https://mangatales.com | custom (custom code) | 200 |
| [ ] | EN | MangaTaro | https://mangataro.org | MangaPeakBase | 200 |
| [x] | AR | MangaTek | https://mangatek.com | custom | 200 |
| [ ] | AR | MangaTime | https://mangatime.org | custom (custom code) | 200 |
| [-] | AR | MangaToon (Arabic) | https://ar.mangatoon.mobi | MangaToonBase | 200 |
| [-] | EN | MangaToon (English) | https://mangatoon.mobi | MangaToonBase | 200 |
| [ ] | EN | MangaTown | https://www.mangatown.com | custom (custom code) | 200 |
| [-] | EN | MangaUp (Global) | https://global.manga-up.com | custom (custom code) | 200 |
| [x] | EN | Mangayi | https://mangayi.com | custom (custom code) | 200 |
| [x] | EN | Manhua Buddy | https://manhuabuddy.com | custom | 200 |
| [x] | EN | ManhuaPlus | https://manhuaplus.org | Liliana | 200 |
| [-] | EN | Monochrome Scans | https://manga.d34d.one | custom (custom code) | 200 |
| [-] | EN | MyAnimeList (Manga) | https://myanimelist.net | custom (custom code) | 200 |
| [x] | EN | MyMangaList | https://www5.mymangalist.org | custom (custom code) | 200 |
| [ ] | EN | NihonKuni | https://nihonkuni.com | FlatManga (custom code) | 200 |
| [ ] | EN | Novel Cool (English) | https://www.novelcool.com | NiaddBase | 200 |
| [ ] | EN | Nyx Scans | https://nyxscans.com | VTheme | 200 |
| [ ] | EN | Philia Scans | https://philiascans.org | custom (custom code) | 200 |
| [x] | EN | Project Suki | https://projectsuki.com | custom (custom code) | 200 |
| [ ] | EN | Punk Records | https://punkrecordz.com | custom (custom code) | 200 |
| [x] | EN | Qi Scans | https://qimanga.com | EzMangaBase | 200 |
| [ ] | EN | RenaScans | https://renascans.net | custom (custom code) | 200 |
| [ ] | EN | Rinko Comics | https://rinkocomics.com | custom (custom code) | 200 |
| [ ] | EN | Rithar Scans | https://ritharscans.com | KeyoApp | 200 |
| [ ] | EN | Rolia Scan | https://roliascan.com | MangaPeakBase | 200 |
| [x] | EN | SeinagiFansub (EN) | https://reader.seinagi.org.es | FoolSlide | 200 |
| [-] | EN | SetsuScans | https://manga.saytsu.com | custom (custom code) | 200 |
| [-] | EN | StoneScape | https://stonescape.sayki.fr | custom (custom code) | 200 |
| [-] | EN | Tapas | https://tapas.io | custom (custom code) | 200 |
| [-] | EN | TappyToon | https://www.tappytoon.com | custom (custom code) | 200 |
| [-] | EN | Tapread | https://www.tapread.com | custom (custom code) | 200 |
| [x] | EN | TCB Scans | https://tcbonepiecechapters.com | custom | 200 |
| [-] | AR | Team X | https://olympustaff.com | custom | 200 |
| [x] | EN | Timeless Toons | https://timelesstoons.org | KeyoApp | 200 |
| [-] | EN | Toptoon (Global) | https://global.toptoon.com | custom (custom code) | 200 |
| [x] | EN | Valir Scans | https://valirscans.org | NovelDexTheme | 200 |
| [-] | EN | Viz - Shonen Jump | https://www.viz.com | custom (custom code) | 200 |
| [ ] | EN | Vortex Scans | https://vortexscans.org | VTheme (custom code) | 200 |
| [-] | EN | Voyce | https://www.voyce.me | custom (custom code) | 200 |
| [x] | EN | VyManga | https://mangavyvy.com | custom (custom code) | 200 |
| [ ] | EN | WebDex Scans | https://webdexscans.com | custom (custom code) | 200 |
| [x] | EN | WeebCentral | https://weebcentral.com | custom (custom code) | 200 |
| [ ] | EN | XoxoComics | https://xoxocomic.com | custom (custom code) | 200 |

**Batch 2 (section 4), 2026-11-21:** 76 free sites tested end to end with `MR_SITEPIPE`; 25 work and are in the
app's directory ([x]), after these fixes in Yomi: page lists the site hands out on request (ManhuaPlus, WeebCentral),
KeyoApp and NovelDex pages read from the page itself, early-access and redacted chapters reported as locked,
svg/icon/thumbnail/avatar pictures never taken for pages, picture requests marked same-origin like a browser (Drake),
chapter ids in addresses no longer taken for numbers (Flame, GodaComic), and update checks that read the whole list
when a site shows its oldest chapters first (Drake, Valir). The 11 official paid stores were left out.

Not in yet ([-]):
- Comikey: official paid store.
- CoolMic: official paid store.
- Hijala Scans: page count changes between reads (13, then 2): not reliable yet.
- HolonoMetria: official site.
- Kayn Scan: pages are encrypted and cut into tiles that only its own script puts together.
- MangaBat: same site and catalogue as Manganato (same pictures), so only Manganato is listed.
- MangaFox: DM5 packed reader script: needs its own reader.
- MangaFoxFun: MangaHub API copy: needs a key handshake and decrypting each page list.
- MangaFreak: already built in.
- MangaHere: DM5 packed reader script: needs its own reader.
- MangaHereFun: MangaHub API copy (as MangaFoxFun).
- MangaKakalot: moved to katamanga.com; same catalogue as Manganato, and its chapter list comes in pieces.
- MangaKakalotFun: MangaHub API copy (as MangaFoxFun).
- MangaOnlineFun: MangaHub API copy (as MangaFoxFun).
- MangaToon (Arabic): signed API and scrambled picture bytes: needs its own reader.
- MangaToon (English): signed API and scrambled picture bytes: needs its own reader.
- MangaUp (Global): official paid app.
- Monochrome Scans: the browser sees only some pages (5, 6 … 93, 94); needs its API.
- MyAnimeList (Manga): official paid store.
- SetsuScans: Cloudflare blocks its picture folder for anything but its own pages.
- StoneScape: an app that loads everything from its API: needs its own reader.
- Tapas: official paid store.
- TappyToon: official paid store.
- Tapread: official paid store.
- Team X: already in Yomi (olympustaff).
- Toptoon (Global): official paid store.
- Viz - Shonen Jump: official paid store.
- Voyce: official paid store.

Still to look at ([ ]): AllManga, Arc-Relight, Atsumaru (profile pictures taken for pages), ComicHub Free, Comick, Comix
(Cloudflare), DeathTollScans, Dilar, VTheme sites that find only 1-2 pages (AZORA, Nyx, Vortex), Hachirumi and Magical
Translators (Guya API), Hive Scans, HNI-Scantrad, MangaCloud, MangaFire and MangaGeko (time out), MangaKatana (image
server 502), MangaPill (search-based list), MangaTales, MangaTaro and Rolia Scan (one chapter per series),
MangaTime, Manga Origin (Blogger), NihonKuni, Novel Cool, Philia Scans, Punk Records, RenaScans, Rinko Comics,
Rithar Scans, Asmodeus Scans, WebDex Scans, XoxoComics.

## 5. Adult (18+) (5)

Online, rated adult by HaruNeko. Skipped unless wanted.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [ ] | EN | ComicLand | https://comicland.org | custom (custom code) | 200 |
| [ ] | EN | Desire Scans | https://desirescans.com | NovelDexTheme | 200 |
| [ ] | EN | Hiperdex | https://hiperdex.tv | HiperManga | 200 |
| [ ] | EN | Toondex | https://toondex.xyz | MangaStream | 200 |
| [ ] | EN | Yuri Online | https://yuri-online.com | Madara | 200 |

## 6. No answer (67)

Offline, parked, or refusing a plain request. Recheck later in Yomi before giving up.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [ ] | EN | AllPornComic | https://allporncomic.com | Madara | ENOTFOUND |
| [ ] | AR | ArabsHentai | https://arabshentai.com | custom (custom code) | ENOTFOUND |
| [ ] | AR | ArabToons | https://arabtoons.net | custom (custom code) | ECONNRESET |
| [ ] | EN | Arena Scan | https://arenascan.com | MangaStream | ECONNRESET |
| [ ] | EN | Cocomic | https://cocomic.co | Madara | ENOTFOUND |
| [ ] | EN | Comick Fanmade | https://comickfan.com | custom (custom code) | AbortError |
| [ ] | EN | Comics Valley | https://comicsvalley.com | Madara | ECONNRESET |
| [ ] | EN | Comikey (Archive) | https://cdn.comikey-cloud.workers.dev | custom (custom code) | 530 |
| [ ] | EN | Cultured Works | https://culturedworks.com | MangaStream | 526 |
| [ ] | EN | Danke fürs Lesen | https://danke.moe | Guya | ECONNRESET |
| [ ] | EN | Decadence | https://reader.decadencescans.com | Madara | ENOTFOUND |
| [ ] | EN | Doujins | https://doujins.com | custom | ECONNRESET |
| [ ] | EN | Dynasty Reader | https://dynasty-scans.com | custom (custom code) | ECONNRESET |
| [ ] | EN | 8 MUSES | https://comics.8muses.com | custom | ENOTFOUND |
| [ ] | EN | 8 MUSES XXX | https://8muses.xxx | custom | ECONNRESET |
| [ ] | EN | EZManga | https://ezmanga.org | EzMangaBase | 403 |
| [ ] | EN | GedeComix | https://gedecomix.com | Madara | ENOTFOUND |
| [ ] | EN | HDPornComics | https://hdporncomics.com | custom (custom code) | ENOTFOUND |
| [ ] | EN | Hentai18 | https://hentai18.net | custom | ENOTFOUND |
| [ ] | EN | Hentai20 | https://hentai20.io | MangaStream | ENOTFOUND |
| [ ] | EN | Hentai2R | https://hentai2read.com | custom | ENOTFOUND |
| [ ] | EN | HentaiFox | https://hentaifox.com | custom | ENOTFOUND |
| [ ] | EN | HentaiHere | https://hentaihere.com | custom | ECONNRESET |
| [ ] | EN | HentaiNexus | https://hentainexus.com | custom (custom code) | ECONNRESET |
| [ ] | EN | HentaiRead | https://hentairead.com | custom | ENOTFOUND |
| [ ] | EN | HentaiXYuri | https://hentaixyuri.com | Madara | ECONNRESET |
| [ ] | EN | LewdManhwa | https://lewdmanhwa.com | custom (custom code) | ECONNRESET |
| [ ] | EN | Lily Manga | https://lilymanga.net | Madara | ENOTFOUND |
| [ ] | EN | MadaraDex | https://madaradex.org | Madara (custom code) | ENOTFOUND |
| [ ] | EN | MangaDistrict | https://mangadistrict.com | Madara | ENOTFOUND |
| [ ] | EN | Manga18.club | https://manga18.club | custom | ENOTFOUND |
| [ ] | EN | MangaGG | https://mangagg.com | Madara | ENOTFOUND |
| [ ] | EN | MangaGo | https://www.mangago.me | custom (custom code) | ENOTFOUND |
| [ ] | EN | MangaHub | https://mangahub.io | MangaHubBase | ENOTFOUND |
| [ ] | AR | ProChan | https://prochan.net | custom (custom code) | ENOTFOUND |
| [ ] | EN | Mangatellers | https://reader.mangatellers.gr | FoolSlide | 500 |
| [ ] | EN | MangaZizi | https://mangazizi.com | Madara | ENOTFOUND |
| [ ] | AR | HentaiLek | https://hentailek.com | custom | ECONNRESET |
| [ ] | EN | ManhuaHot | https://manhuahot.com | Madara | ENOTFOUND |
| [ ] | EN | Manhwa 18 (.com) | https://manhwa18.com | FlatManga | ECONNRESET |
| [ ] | EN | Manhwa 18 (.cc) | https://manhwa18.cc | custom | ENOTFOUND |
| [ ] | EN | ManhwaBuddy | https://manhwabuddy.com | custom | ECONNRESET |
| [ ] | EN | ManhwaClub | https://manhwaclub.net | Madara | ECONNRESET |
| [ ] | EN | Manhwa 18 (.net) | https://manhwa18.net | custom (custom code) | ENOTFOUND |
| [ ] | EN | ManhwaRead | https://manhwaread.com | custom | ENOTFOUND |
| [ ] | EN | Milftoon Comics | https://milftoon.xxx | Madara | ENOTFOUND |
| [ ] | EN | MyHentaiGallery | https://myhentaigallery.com | custom | ECONNRESET |
| [ ] | EN | MyReadingManga | https://myreadingmanga.info | custom (custom code) | ENOTFOUND |
| [ ] | EN | NHentaiCom | https://nhentai.com | custom (custom code) | ENOTFOUND |
| [ ] | EN | Niadd (English) | https://www.niadd.com | NiaddBase | ECONNRESET |
| [ ] | AR | مدونة نيجي (Niji Translations) | https://niji-translations.com | Madara | ECONNRESET |
| [ ] | EN | OmegaScans | https://omegascans.org | HeanCMS | ECONNRESET |
| [ ] | AR | مانجا اون لاين (On-Manga) | https://www.onma.top | MangaReaderCMS | 403 |
| [ ] | EN | PixHentai | https://pixhentai.com | custom | ECONNRESET |
| [ ] | EN | Pururin | https://pururin.me | custom | ENOTFOUND |
| [ ] | EN | Scans.GG | https://scans.gg | custom (custom code) | TypeError |
| [ ] | EN | TempleScan | https://templetoons.com | custom | ECONNRESET |
| [ ] | EN | TheBlank | https://theblank.net | Madara | ECONNRESET |
| [ ] | EN | ToonGod | https://www.toongod.org | Madara | ENOTFOUND |
| [ ] | EN | Toonhey | https://toonhey.com | custom | ENOTFOUND |
| [ ] | EN | Toonily | https://toonily.com | Madara (custom code) | ENOTFOUND |
| [ ] | EN | ToonTop | https://toontop.io | MangakBase | ENOTFOUND |
| [ ] | EN | WebComicsApp (English) | https://www.webcomicsapp.com | WebComicsAppBase | ECONNRESET |
| [ ] | EN | WebtoonScan | https://webtoonscan.com | Madara | EAI_AGAIN |
| [ ] | EN | XlecX | https://xlecx.one | custom | ENOTFOUND |
| [ ] | EN | XManhwa | https://www.manhwaden.com | Madara | ENOTFOUND |
| [ ] | EN | YaoiScan | https://yaoiscan.com | Madara | ENOTFOUND |

## Other languages (not surveyed yet; all 790 connectors are in haruneko-connectors.json)

Japanese: 97, Turkish: 85, Spanish: 71, Portuguese: 55, Indonesian: 53, Chinese: 39, Multilingual: 36, French: 35, Thai: 25, Russian: 21, Vietnamese: 20, Italian: 16, Korean: 12, German: 7
