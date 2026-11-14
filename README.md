<p align="center">
  <img src="docs/banner.png" alt="Yomi" width="100%">
</p>

<p align="center">
  <b>All your manga, manhwa and manhua sites in one clean, ad-free reader for Windows.</b><br>
  <a href="https://github.com/hmodymac8-droid/yomi/releases/latest"><b>⬇ Download for Windows</b></a>
  &nbsp;·&nbsp; <a href="#العربية">العربية</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-000000?style=flat-square&logo=windows&logoColor=white" alt="Windows 10 and 11">
  <img src="https://img.shields.io/badge/x64%20%2B%20ARM-one%20installer-dcbc33?style=flat-square" alt="x64 and ARM">
  <img src="https://img.shields.io/badge/version-1.1.2-dcbc33?style=flat-square" alt="Version 1.1.2">
</p>

<p align="center">
  <img src="docs/screenshots/discover.png" alt="Discover" width="49%">
  <img src="docs/screenshots/series.png" alt="Series page" width="49%">
</p>

## Sites that work smoothly with Yomi

Tested end to end (title list, chapters, pages and images). Copy an address, paste it into **Add a site** on Discover, and every title on that site appears in Yomi.

### English sites
| Site | Address (paste into **Add a site**) | Has |
|---|---|---|
| **MangaFreak** | [ww3.mangafreak.me](https://ww3.mangafreak.me/) | manga |
| **Manganato** | [www.manganato.gg](https://www.manganato.gg/) | manga · manhwa · manhua |
| **Mangapill** | [mangapill.com](https://mangapill.com/) | manga · manhwa · manhua |
| **Weebcentral** | [weebcentral.com](https://weebcentral.com/) | manga · manhwa · manhua |
| **Mangastash** | [mangastash.org](https://mangastash.org/) | manga · manhwa · manhua |
| **Kuramanga** | [kuramanga.com](https://kuramanga.com/) | manhwa · manhua |
| **ManhwaTop** | [manhwatop.com](https://manhwatop.com/) | manhwa |
| **BaeToon** | [baetoon.com](https://baetoon.com/) | manhwa · webtoons |
| **Webtoonclub** | [webtoonclub.com](https://webtoonclub.com/) | manhwa · webtoons |
| **Manhuatop** | [manhuatop.org](https://manhuatop.org/) | manhua |
| **Projectsuki** | [projectsuki.com](https://projectsuki.com/) | manga · manhwa · manhua |

### Arabic sites · المواقع العربية
| Site | Address (paste into **Add a site**) | Has |
|---|---|---|
| **Azorafly** | [azorafly.com](https://azorafly.com/) | مانجا · مانهوا · مانها |
| **Olympustaff** | [olympustaff.com](https://olympustaff.com/) | مانجا · مانهوا · مانها |
| **Mangadar** | [mangadar.com](https://mangadar.com/) | مانجا · مانهوا · مانها |
| **Mangasid** | [mangasid.com](https://mangasid.com/) | مانجا · مانهوا · مانها |

<sub>Comix ([comix.to](https://comix.to/)) also works, but its chapter lists can take a minute to load. Any other manga site can be tried the same way.</sub>

## What it does

- **Add any site.** Paste its address and every title joins one big catalog.
- **Search everything at once**, filter by type and genre, sort how you like.
- **English or Arabic**: one click shows only English sites or only Arabic sites.
- **Read without ads** in Yomi's own reader.
- **Follow series** and see new chapters as they come out.
- **Download chapters** to read offline, or export them as CBZ.
- Dark and light themes.
- **Optional AniList tracking**: connect your account to sync progress when you finish a chapter.
- **Optional source extensions**: add a repo in Settings to install extra sites. See [EXTENSIONS.md](EXTENSIONS.md).

## How to use

1. Download **Yomi-Setup** from [Releases](https://github.com/hmodymac8-droid/yomi/releases/latest) and run it.
   If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**.
2. On **Discover**, paste a manga site's address into **Add a site** and press **Add**.
3. Search with the top bar (**Ctrl + K**), open a title, and press **Start** or **Continue**.
4. Press **☆ Follow** to get new chapters, or **⬇** to save chapters for offline.


## AniList tracking (optional)

Yomi can update your AniList reading progress when you finish a chapter. This is off until you connect an account in **Settings → Tracking**. Nothing is sent, and no default reading behavior changes, until you opt in.

### Register an AniList API client

Yomi does not ship with an AniList client ID. You create your own (free) and paste it into Settings.

1. Sign in at [anilist.co](https://anilist.co) and open [Developer Settings](https://anilist.co/settings/developer).
2. Click **Create New Client**.
3. Give it a name such as `Yomi`.
4. Set **Redirect URL** to exactly:

   `https://anilist.co/api/v2/oauth/pin`

5. Create the client and copy the **Client ID** (a number). You do not need the client secret: Yomi uses the implicit grant (`response_type=token`).
6. In Yomi, open **Settings → Tracking**, paste the Client ID, and press **Connect AniList**. Sign in and approve access. Yomi captures the token from the redirect and stores it in the main process, encrypted with Electron `safeStorage` when the OS allows it.

Then, on a series page, press **Link to AniList** and confirm the suggested match (or search and pick another). When you finish a chapter, Yomi updates AniList progress with status `CURRENT`, or `COMPLETED` if the series is finished and that was the last chapter. Updates made while offline are queued and retried. **Import progress from AniList** only moves your local progress forward; it never marks chapters unread or moves a bookmark backward.


## Source extensions (optional)

You can install extra sites from an extension repo or by dropping a JSON/JS file into Yomi's extensions folder. Built-in sources are unchanged. See [EXTENSIONS.md](EXTENSIONS.md) for the format, an example port of MangaFreak, and how to publish a repo with SHA-256 checks.

## Build from source

```bash
npm install
npm run dev        # run the app
npm run build:win  # make the installer in dist/
```

<br>

<div dir="rtl" align="right">

<h2 id="العربية">العربية</h2>

**يومي (Yomi)**: كل مواقع المانجا والمانهوا والمانها في قارئ واحد نظيف وبدون إعلانات على ويندوز.

### ماذا يفعل

- **أضف أي موقع**: الصق رابطه وتنضم كل أعماله إلى مكتبة واحدة.
- **ابحث في كل المواقع معاً**، وصفِّ حسب النوع والتصنيف، ورتّب كما تحب.
- **عربي أو إنجليزي**: بضغطة واحدة تعرض المواقع العربية فقط أو الإنجليزية فقط.
- **اقرأ بدون إعلانات** في قارئ يومي الخاص.
- **تابع الأعمال** واعرف الفصول الجديدة فور صدورها.
- **حمّل الفصول** للقراءة بدون إنترنت، أو صدّرها كملفات CBZ.
- وضع داكن ووضع فاتح.

### طريقة الاستخدام

1. حمّل **Yomi-Setup** من صفحة [الإصدارات](https://github.com/hmodymac8-droid/yomi/releases/latest) وشغّله.
   إذا ظهرت رسالة *"Windows protected your PC"* اضغط **More info** ثم **Run anyway**.
2. في صفحة **Discover** الصق رابط موقع مانجا في خانة **Add a site** واضغط **Add**.
3. ابحث من الشريط العلوي (**Ctrl + K**)، افتح أي عمل، واضغط **Start** أو **Continue**.
4. اضغط **☆ Follow** لتصلك الفصول الجديدة، أو **⬇** لحفظ الفصول للقراءة بدون إنترنت.

### مواقع تعمل بسلاسة مع يومي

انسخ الرابط والصقه في خانة **Add a site** وستظهر كل أعمال الموقع في يومي.

**المواقع العربية:** [Azorafly](https://azorafly.com/) · [Olympustaff](https://olympustaff.com/) · [Mangadar](https://mangadar.com/) · [Mangasid](https://mangasid.com/)

**المواقع الإنجليزية:** [MangaFreak](https://ww3.mangafreak.me/) · [Manganato](https://www.manganato.gg/) · [Mangapill](https://mangapill.com/) · [Weebcentral](https://weebcentral.com/) · [Mangastash](https://mangastash.org/) · [Kuramanga](https://kuramanga.com/) · [ManhwaTop](https://manhwatop.com/) · [BaeToon](https://baetoon.com/) · [Webtoonclub](https://webtoonclub.com/) · [Manhuatop](https://manhuatop.org/) · [Projectsuki](https://projectsuki.com/)


</div>

<br>

<p align="center"><sub>For personal use. Yomi only shows what the sites themselves publish and follows their robots.txt rules.</sub></p>
