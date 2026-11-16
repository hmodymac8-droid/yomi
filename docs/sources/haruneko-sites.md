# Sites from HaruNeko

Survey of the site connectors in [HaruNeko](https://github.com/manga-download/haruneko) (Unlicense, public domain), the maintained successor of HakuNeko. Taken 2026-11-17 from 790 connectors; 220 are English or Arabic and are listed below. "Check" is the HTTP answer to a plain request from a desktop browser user agent.

**Batch 1 (sections 1–2), 2026-11-17:** 28 of 39 work and are in the app's Popular sites list ([x]). [-] = not added, with the reason after the row. Fixes this needed in Yomi: robots.txt Crawl-delay grouping, chapter pages whose canonical is the home page (Rizz), Arabic "read first / last" buttons, recipes for Fastest Manga and MangaOwl.

Work through the sections in order. Tick a site once it is added to Yomi and tested, or strike it out if it does not work.

## 1. Template sites, no special code (32)

Madara / MangaStream sites that HaruNeko reads with its standard template. Yomi should read these as they are. Start here.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [x] | EN | AquaManga | https://aquareader.org | Madara | 200 |
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

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [ ] | EN | Batcave | https://batcave.biz | custom (custom code) | 403 |
| [ ] | EN | Bokugen Translation | https://bokugents.com | MangaStream | 403 |
| [ ] | EN | BrainRotComics | https://brainrotcomics.com | Madara | 403 |
| [ ] | EN | Dragon Tea Scans | https://dragontea.ink | Madara | 403 |
| [ ] | EN | Kagane | https://kagane.moe | custom (custom code) | 403 |
| [ ] | EN | Kissmanga | https://kissmanga.in | Madara | 403 |
| [ ] | EN | MagusManga | https://magustoon.org | VTheme | 403 |
| [ ] | AR | MangaSwat | https://meshmanga.com | custom (custom code) | 403 |
| [ ] | EN | Manhua Us | https://manhuaus.com | Madara | 403 |
| [ ] | EN | ManhwaTop | https://manhwatop.com | Madara | 403 (already built in) |
| [ ] | EN | Mgread | https://mgread.io | InitManga | 403 |
| [ ] | EN | Mist Scans | https://mistscans.org | custom (custom code) | 403 |
| [ ] | EN | RageScans | https://ragescans.com | MangaStream | 403 |
| [ ] | EN | Raven Scans | https://ravenscans.org | MangaStream | 403 |
| [ ] | EN | Read Comics Online | https://readcomicsonline.ru | custom | 403 |
| [ ] | AR | موقع شقاع (Shqqaa) | https://www.shqqaa.com | custom | 403 |
| [ ] | AR | Stellar Saber | https://stellarsaber.pro | custom (custom code) | 403 |
| [ ] | EN | Top Manhua | https://manhuatop.org | custom (custom code) | 403 |
| [ ] | EN | Webnovel Comics | https://www.webnovel.com | custom (custom code) | 403 |
| [ ] | EN | XoManga | https://xomanga.site | custom (custom code) | 403 |

## 4. Other engines and custom sites (89)

Online, but built on another engine or fully custom. Each needs checking; some need code ported from HaruNeko.

| Done | Lang | Site | Address | Engine | Check |
|---|---|---|---|---|---|
| [ ] | EN | AllManga | https://mkissa.to | custom (custom code) | 200 |
| [ ] | EN | Arc-Relight | https://arc-relight.com | custom | 200 |
| [ ] | EN | Asmodeus Scans | https://asmotoon.com | custom (custom code) | 200 |
| [ ] | EN | Asura Toons | https://www.asuratoons.info | custom | 200 |
| [ ] | EN | Atsumaru | https://atsu.moe | Grouple (custom code) | 200 |
| [ ] | AR | ازورا مانجا (AZORA MANGA / WORLD) | https://azorafly.com | VTheme | 200 |
| [ ] | EN | ComicHub Free | https://comichubfree.com | custom (custom code) | 200 |
| [ ] | EN | Comick (.live) | https://comick.live | custom (custom code) | 200 |
| [ ] | EN | Comikey | https://comikey.com | custom (custom code) | 200 |
| [ ] | EN | Comix | https://comix.to | custom (custom code) | 200 |
| [ ] | EN | CoolMic | https://coolmic.me | custom (custom code) | 200 |
| [ ] | EN | DeathTollScans | https://reader.deathtollscans.net | FoolSlide | 200 |
| [ ] | AR | Dilar | https://dilar.tube | custom (custom code) | 200 |
| [ ] | EN | Diva Scans | https://divascans.org | NovelDexTheme | 200 |
| [ ] | EN | Drake Scans | https://drakecomic.net | NovelDexTheme | 200 |
| [ ] | EN | Elf Toon | https://elftoon.net | NovelDexTheme | 200 |
| [ ] | EN | Eris Scans | https://erisscans.com | KeyoApp | 200 |
| [ ] | EN | Flame Comics | https://flamecomics.xyz | custom (custom code) | 200 |
| [ ] | EN | GenzToon | https://genztoons.org | KeyoApp | 200 |
| [ ] | EN | GodaComic | https://manhuascans.org | GodaBase (custom code) | 200 |
| [ ] | EN | Hachirumi | https://hachirumi.com | Guya | 200 |
| [ ] | EN | Hijala Scans | https://en-hijala.com | VTheme | 200 |
| [ ] | EN | Hive Scans | https://hivetoons.org | VTheme | 200 |
| [ ] | EN | HNI-Scantrad | https://hni-scantrad.net | PizzaReader | 200 |
| [ ] | EN | HolonoMetria | https://holoearth.com | custom (custom code) | 200 |
| [ ] | EN | Kayn Scan | https://kaynscans.com | NovelDexTheme | 200 |
| [ ] | EN | Lua Scans | https://luacomic.org | HeanCMS | 200 |
| [ ] | EN | Magical Translators | https://mahoushoujobu.com | Guya | 200 |
| [ ] | EN | MangaBat | https://www.mangabats.com | MangaNel | 200 |
| [ ] | EN | MangaCloud | https://mangacloud.org | custom (custom code) | 200 |
| [ ] | EN | MangaDemon | https://demonicscans.org | custom | 200 |
| [ ] | EN | MangaFire | https://mangafire.to | custom (custom code) | 200 |
| [ ] | EN | MangaFox | https://fanfox.net | DM5 (custom code) | 200 |
| [ ] | EN | MangaFoxFun | https://mangafox.fun | MangaHubBase | 200 |
| [ ] | EN | MangaFreak | https://ww3.mangafreak.me | custom (custom code) | 200 (already built in) |
| [ ] | EN | MangaGeko | https://www.mgeko.cc | custom (custom code) | 200 |
| [ ] | EN | MangaHere | https://www.mangahere.cc | DM5 (custom code) | 200 |
| [ ] | EN | MangaHereFun | https://mangahere.onl | MangaHubBase | 200 |
| [ ] | EN | MangaKakalot | https://www.kakamanga.com | MangaNel | 200 |
| [ ] | EN | MangaKakalotFun | https://mangakakalot.fun | MangaHubBase | 200 |
| [ ] | EN | MangaKatana | https://mangakatana.com | custom | 200 |
| [ ] | EN | MangaKio | https://mangak.io | MangakBase | 200 |
| [ ] | EN | Manganato | https://www.manganato.gg | MangaNel | 200 |
| [ ] | EN | MangaOnlineFun | https://mangaonline.fun | MangaHubBase | 200 |
| [ ] | AR | Manga Origin | https://mangaoriginread.blogspot.com | ZeistManga | 200 |
| [ ] | EN | MangaPill | https://mangapill.com | custom (custom code) | 200 |
| [ ] | AR | MangaTales | https://mangatales.com | custom (custom code) | 200 |
| [ ] | EN | MangaTaro | https://mangataro.org | MangaPeakBase | 200 |
| [ ] | AR | MangaTek | https://mangatek.com | custom | 200 |
| [ ] | AR | MangaTime | https://mangatime.org | custom (custom code) | 200 |
| [ ] | AR | MangaToon (Arabic) | https://ar.mangatoon.mobi | MangaToonBase | 200 |
| [ ] | EN | MangaToon (English) | https://mangatoon.mobi | MangaToonBase | 200 |
| [ ] | EN | MangaTown | https://www.mangatown.com | custom (custom code) | 200 |
| [ ] | EN | MangaUp (Global) | https://global.manga-up.com | custom (custom code) | 200 |
| [ ] | EN | Mangayi | https://mangayi.com | custom (custom code) | 200 |
| [ ] | EN | Manhua Buddy | https://manhuabuddy.com | custom | 200 |
| [ ] | EN | ManhuaPlus | https://manhuaplus.org | Liliana | 200 |
| [ ] | EN | Monochrome Scans | https://manga.d34d.one | custom (custom code) | 200 |
| [ ] | EN | MyAnimeList (Manga) | https://myanimelist.net | custom (custom code) | 200 |
| [ ] | EN | MyMangaList | https://www5.mymangalist.org | custom (custom code) | 200 |
| [ ] | EN | NihonKuni | https://nihonkuni.com | FlatManga (custom code) | 200 |
| [ ] | EN | Novel Cool (English) | https://www.novelcool.com | NiaddBase | 200 |
| [ ] | EN | Nyx Scans | https://nyxscans.com | VTheme | 200 |
| [ ] | EN | Philia Scans | https://philiascans.org | custom (custom code) | 200 |
| [ ] | EN | Project Suki | https://projectsuki.com | custom (custom code) | 200 |
| [ ] | EN | Punk Records | https://punkrecordz.com | custom (custom code) | 200 |
| [ ] | EN | Qi Scans | https://qimanga.com | EzMangaBase | 200 |
| [ ] | EN | RenaScans | https://renascans.net | custom (custom code) | 200 |
| [ ] | EN | Rinko Comics | https://rinkocomics.com | custom (custom code) | 200 |
| [ ] | EN | Rithar Scans | https://ritharscans.com | KeyoApp | 200 |
| [ ] | EN | Rolia Scan | https://roliascan.com | MangaPeakBase | 200 |
| [ ] | EN | SeinagiFansub (EN) | https://reader.seinagi.org.es | FoolSlide | 200 |
| [ ] | EN | SetsuScans | https://manga.saytsu.com | custom (custom code) | 200 |
| [ ] | EN | StoneScape | https://stonescape.sayki.fr | custom (custom code) | 200 |
| [ ] | EN | Tapas | https://tapas.io | custom (custom code) | 200 |
| [ ] | EN | TappyToon | https://www.tappytoon.com | custom (custom code) | 200 |
| [ ] | EN | Tapread | https://www.tapread.com | custom (custom code) | 200 |
| [ ] | EN | TCB Scans | https://tcbonepiecechapters.com | custom | 200 |
| [ ] | AR | Team X | https://olympustaff.com | custom | 200 |
| [ ] | EN | Timeless Toons | https://timelesstoons.org | KeyoApp | 200 |
| [ ] | EN | Toptoon (Global) | https://global.toptoon.com | custom (custom code) | 200 |
| [ ] | EN | Valir Scans | https://valirscans.org | NovelDexTheme | 200 |
| [ ] | EN | Viz - Shonen Jump | https://www.viz.com | custom (custom code) | 200 |
| [ ] | EN | Vortex Scans | https://vortexscans.org | VTheme (custom code) | 200 |
| [ ] | EN | Voyce | https://www.voyce.me | custom (custom code) | 200 |
| [ ] | EN | VyManga | https://mangavyvy.com | custom (custom code) | 200 |
| [ ] | EN | WebDex Scans | https://webdexscans.com | custom (custom code) | 200 |
| [ ] | EN | WeebCentral | https://weebcentral.com | custom (custom code) | 200 |
| [ ] | EN | XoxoComics | https://xoxocomic.com | custom (custom code) | 200 |

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
