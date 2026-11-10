/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from 'cheerio'

// Parsers that work on raw HTML (no browser). They mirror what the in-page scripts do in catalog.ts / grabber.ts.

const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'src']

function abs(href: string | undefined, base: string): string {
  if (!href) return ''
  try {
    return new URL(href.trim(), base).href
  } catch {
    return ''
  }
}

function imgUrl($img: cheerio.Cheerio<any>, base: string): string {
  for (const a of IMG_ATTRS) {
    const v = $img.attr(a)
    if (v && !v.startsWith('data:') && v.trim()) {
      const u = abs(v, base)
      if (u) return u
    }
  }
  return ''
}

/** Visible text of a node with a space between elements (so "C. 1" and "1d ago" don't glue together). */
function textOf(node: any): string {
  const parts: string[] = []
  const walk = (n: any): void => {
    if (!n || n.type === 'script' || n.type === 'style') return
    if (n.type === 'text') parts.push(n.data)
    else if (n.children) n.children.forEach(walk)
    if (n.type === 'tag') parts.push(' ')
  }
  walk(node)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * Cover URLs on list pages are usually tiny thumbnails. Where the site's naming scheme is known, point at the
 * full-size original instead (the caller keeps the thumbnail as a fallback in case the guess is wrong).
 */
export function upgradeCover(url: string): string {
  if (!url) return url
  // MangaFreak: /mini_images/<name>/<w>x<h>  ->  /manga_images/<name>.jpg
  const mf = url.match(/^(https?:\/\/[^/]*mangafreak[^/]*)\/mini_images\/([^/]+)\/\d+x\d+\/?$/i)
  if (mf) return `${mf[1]}/manga_images/${mf[2]}.jpg`
  // WordPress thumbnails: name-175x238.jpg  ->  name.jpg
  const wp = url.match(/^(.*?)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(\?.*)?$/i)
  if (wp && /\/wp-content\/uploads\//i.test(url)) return wp[1] + wp[2]
  return url
}

export function parseSeriesList(
  html: string,
  pageUrl: string,
  seriesRe: string
): { url: string; title: string; cover: string }[] {
  const $ = cheerio.load(html)
  const re = new RegExp(seriesRe)
  const hrefOf = (a: any): string => abs($(a).attr('href'), pageUrl).split('#')[0]
  const map = new Map<string, { url: string; title: string; cover: string; p: number }>()
  $('a[href]').each((_, a) => {
    const href = hrefOf(a)
    if (!href || !re.test(href)) return
    let img = $(a).find('img').first()
    if (img.length === 0) {
      // the cover may sit next to the title link: use the surrounding card if it holds just this series
      const card = $(a).closest('li, article, div')
      if (card.length) {
        const urls = new Set<string>()
        card.find('a[href]').each((_, x) => {
          const h = hrefOf(x)
          if (re.test(h)) urls.add(h)
        })
        if (urls.size === 1) img = card.find('img').first()
      }
    }
    const cur = map.get(href) ?? { url: href, title: '', cover: '', p: 9 }
    const cands: [number, string | undefined][] = [
      [1, $(a).attr('title')],
      [2, img.attr('alt')],
      [3, textOf(a)]
    ]
    for (const [p, t] of cands) {
      const text = (t ?? '').trim().replace(/\s+/g, ' ')
      if (text && text.length < 150 && p < cur.p) {
        cur.title = text
        cur.p = p
      }
    }
    if (!cur.cover && img.length) cur.cover = imgUrl(img, pageUrl)
    map.set(href, cur)
  })
  return [...map.values()].map(({ url, title, cover }) => ({ url, title, cover }))
}

/** Just the title and cover of a series page (used to fill in series that a sitemap listed by URL only). */
export function parseSeriesMeta(html: string, pageUrl: string): { title: string; cover: string } {
  const $ = cheerio.load(html)
  const meta = (p: string): string => $(`meta[property="${p}"]`).attr('content') ?? ''
  // The page's own heading is the cleanest title; og:title / <title> usually carry a "- Read ... | Site" tail.
  const clean = (t: string): string =>
    t.replace(/\s+[-–|]\s+(read|watch|online|free|manga|manhwa|manhua|webtoon).*$/i, '').replace(/\s*\|\s*[^|]+$/, '').trim()
  const h1 = $('h1').first().text().trim().replace(/\s+/g, ' ')
  const title = h1 && h1.length < 150 ? h1 : clean(meta('og:title') || $('title').first().text())
  return { title, cover: abs(meta('og:image'), pageUrl) }
}

export function parseSeries(
  html: string,
  pageUrl: string,
  chapterRe: string
): {
  title: string
  cover: string
  description: string
  chapters: { title: string; url: string }[]
  /** True when the chapter list is split over pager pages / "show more" buttons (needs the browser). */
  paged: boolean
} {
  const $ = cheerio.load(html)
  const re = new RegExp(chapterRe, 'i')
  const seen = new Set<string>()
  const chapters: { title: string; url: string }[] = []
  // A chapter is a link whose address looks like one OR whose visible text does ("Chapter 12"): some sites use
  // opaque addresses (/chapters/01J76X…). "Start Reading" / "Latest" buttons are not chapters themselves.
  const byText = (t: string): boolean => /^(vol(ume)?\.?\s*\d+\s*[,:.-]?\s*)?(chapter|chap\.?|ch\.?|episode|ep\.?|ال?فصل|حلقة|الحلقة)\s*\d/i.test(t)
  // A link below this series' own address with "chapter 12" / "vol-2" in its path is one of its chapters.
  let basePath = ''
  let baseOrigin = ''
  try {
    const pu = new URL(pageUrl)
    basePath = pu.pathname.replace(/\/$/, '')
    baseOrigin = pu.origin
  } catch {
    /* no base */
  }
  const underBase = (h: string): boolean => {
    try {
      const u = new URL(h)
      return !!basePath && u.origin === baseOrigin && u.pathname.startsWith(basePath + '/') && /(chapter|chap|episode|ep|ch)[-_ ]?\d|vol[-_ ]?\d/i.test(u.pathname.slice(basePath.length))
    } catch {
      return false
    }
  }
  const junk = (t: string): boolean => /^(start|read|continue|first|last|latest|new)\b/i.test(t) && !/\d/.test(t)
  // Sites that number chapters by address only: …/reader/<series-slug>/138 (no "chapter" word anywhere).
  const lastSeg = decodeURIComponent(basePath.split('/').pop() || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const slugNumRe = lastSeg ? new RegExp('/' + lastSeg + '/(\\d+(?:[._-]\\d+)?)/?$', 'i') : null
  const slugNum = (h: string): string | null => {
    if (!slugNumRe) return null
    try {
      const m = slugNumRe.exec(decodeURIComponent(new URL(h).pathname))
      return m ? m[1] : null
    } catch {
      return null
    }
  }
  $('a[href]').each((_, a) => {
    const href = abs($(a).attr('href'), pageUrl).split('#')[0]
    if (!href || seen.has(href)) return
    let t = textOf(a).slice(0, 80)
    const sn = slugNum(href)
    // a link back to the series page itself (a "latest: Chapter 204" banner) is not a chapter
    try {
      if (new URL(href).pathname.replace(/\/$/, '') === basePath) return
    } catch {
      /* keep going */
    }
    if ((!re.test(href) && !byText(t) && !underBase(href) && sn === null) || junk(t)) return
    if (sn !== null) t = 'Chapter ' + sn.replace(/[_-]/g, '.')
    seen.add(href)
    chapters.push({ title: t, url: href })
  })
  // Some sites ship the chapter list as data inside the page (a JSON script tag, a hydration blob) and draw the links
  // later with JavaScript. Pick chapter addresses (…/<series-slug>/<number>) out of the raw text as well.
  if (slugNumRe) {
    const raw = html.replace(/\\\//g, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const found = raw.match(new RegExp('https?://[^"\'\\s<>\\\\,)]*/' + lastSeg + '/\\d+(?:[._-]\\d+)?/?(?=["\'\\s<>\\\\,)]|$)', 'gi')) ?? []
    for (const f of found) {
      const href = f.split('#')[0]
      const sn = slugNum(href)
      if (sn === null || seen.has(href)) continue
      seen.add(href)
      chapters.push({ title: 'Chapter ' + sn.replace(/[_-]/g, '.'), url: href })
    }
  }
  // Same for data that carries root-relative addresses ("url":"/series/chapter-68"): any address below this series'
  // own path that looks like a chapter counts, even when the page draws only some of them as links.
  if (basePath) {
    const raw = html.replace(/\\\//g, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const esc = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const found = raw.match(new RegExp('["\'(](?:https?://[^"\'\\s<>\\\\]*)?' + esc + '/[^"\'\\s<>\\\\?#,)]+(?=["\')])', 'gi')) ?? []
    for (const f of found) {
      const href = abs(f.slice(1), pageUrl).split('#')[0]
      if (!href || seen.has(href)) continue
      if (!re.test(href) && !underBase(href)) continue
      const sn = slugNum(href)
      const num = /(?:chapter|chap|ch|episode|ep)[-_ ]?(\d+(?:[._-]\d+)?)/i.exec(href)?.[1]
      seen.add(href)
      chapters.push({ title: sn ?? num ? 'Chapter ' + (sn ?? num)!.replace(/[_-]/g, '.') : decodeURIComponent(href.split('/').pop() ?? ''), url: href })
    }
  }
  const meta = (p: string): string => $(`meta[property="${p}"]`).attr('content') ?? ''
  const body = textOf($('body').get(0))
  const pagerNext = $('button, [role=button], a')
    .toArray()
    .some((el) => {
      const t = textOf(el)
      return t.length < 12 && /^(next\b|›$)/i.test(t)
    })
  const paged =
    /Showing\s+\d+\s*[–-]\s*\d+\s+of\s+\d+/i.test(body) ||
    /(show|view|load|see|expand)\s+(all|more)(\s+\d+)?\s+(chapters?|episodes?)/i.test(body) || // "Show all 35 chapters"
    pagerNext
  return {
    title: $('h1').first().text().trim().replace(/\s+/g, ' ') || meta('og:title') || $('title').text().trim(),
    cover: meta('og:image'),
    description: meta('og:description'),
    chapters,
    paged
  }
}

// Site furniture, not manga pages: logos, favicons, "apple-touch-icon", avatars, sprites... (the name may START with
// something else: apple-touch-icon-152x152.png, site-logo.png)
const NOT_PAGE = /\/[^/]*(?:^|[-_.])?(logo|favicon|icon|avatar|sprite|emoji|apple-touch)[^/]*\.(png|jpe?g|webp|gif|avif|ico|svg)(?:\?|$)|\/(banner|loading|placeholder)[^/]*\.(png|jpe?g|webp|gif|avif)/i

/** Manga pages sit in one folder of one CDN host: take the biggest such group (covers/ads are scattered). */
export function pickPageGroup(urls: string[]): string[] {
  const seen = new Set<string>()
  const groups = new Map<string, string[]>()
  for (const u of urls) {
    if (seen.has(u) || NOT_PAGE.test(u)) continue
    seen.add(u)
    let key: string
    try {
      const p = new URL(u)
      key = p.hostname + p.pathname.replace(/[^/]*$/, '')
    } catch {
      continue
    }
    groups.set(key, [...(groups.get(key) ?? []), u])
  }
  let best: string[] = []
  for (const g of groups.values()) if (g.length > best.length) best = g
  return best
}

export function parseChapterImages(html: string, pageUrl: string): { title: string; pages: string[] } {
  const $ = cheerio.load(html)
  // Some readers (Mangadar) put each page's address in data-mds, base64-encoded, and only show it as you scroll:
  // read them straight from there, in order.
  const encoded: string[] = []
  $('img[data-mds]').each((_, el) => {
    const u = Buffer.from(String($(el).attr('data-mds') ?? ''), 'base64').toString('utf8')
    if (/^https?:\/\//.test(u)) encoded.push(u)
  })
  if (encoded.length > 0) return { title: $('title').first().text().trim(), pages: encoded }
  const dom: string[] = []
  $('img').each((_, el) => {
    const u = imgUrl($(el), pageUrl)
    if (!u) return
    const w = Number($(el).attr('width'))
    const h = Number($(el).attr('height'))
    if ((w && w < 200) || (h && h < 200)) return
    dom.push(u)
  })
  let pages = pickPageGroup(dom)
  if (pages.length < 3) {
    // Some sites ship the page list as JSON inside a script tag and only render the first <img>s.
    // (Only consulted when the <img> tags gave almost nothing: scripts also mention covers and thumbnails.)
    const text = html.replace(/\\\//g, '/')
    const found = text.match(/https?:\/\/[^"'\s<>)\\]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'\s<>)\\]*)?/gi) ?? []
    const fromScripts = pickPageGroup(found)
    if (fromScripts.length > pages.length) pages = fromScripts
  }
  // Readers that fill in each page's picture only as you scroll to it (Mangatek, Mangasid) still number every page
  // in the HTML ("Page 20" / "صفحة 20"). More numbered pages than pictures means this list is only the start of the
  // chapter: give nothing, so a way that scrolls through the page (the hidden browser) is used instead.
  const numbered = $('img').filter((_, el) => /(?:page|صفحة)\s*\d+/i.test($(el).attr('alt') ?? '')).length
  if (numbered >= pages.length + 2) pages = []
  return { title: $('title').first().text().trim(), pages }
}

export type SeriesType = 'manga' | 'manhwa' | 'manhua'
export type SeriesStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled'
export interface SeriesMeta {
  type?: SeriesType
  genres?: string[]
  status?: SeriesStatus
}

const TYPE_WORD: Record<string, SeriesType> = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua', webtoon: 'manhwa' }
const STATUS_WORD: Record<string, SeriesStatus> = {
  ongoing: 'ongoing', 'on going': 'ongoing', releasing: 'ongoing', publishing: 'ongoing',
  completed: 'completed', complete: 'completed', finished: 'completed', ended: 'completed',
  hiatus: 'hiatus', 'on hold': 'hiatus', cancelled: 'cancelled', canceled: 'cancelled', dropped: 'cancelled'
}

/**
 * What a series page says about itself: its type (manga / manhwa / manhua), genres and status. Only what the page
 * states is kept, never a guess. Genre menus in the site header list every genre, so header/nav/footer/sidebars
 * are ignored, and a "genre list" longer than 15 is treated as such a menu and dropped.
 */
export function parseMeta(html: string, pageUrl: string): SeriesMeta {
  if (!html) return {}
  const $ = cheerio.load(html)
  const clean = (t: string): string => t.replace(/\s+/g, ' ').replace(/[,;]+$/, '').trim()
  const ok = (t: string): boolean => t.length >= 2 && t.length <= 30 && !/^\d+$/.test(t) && !/^(genres?|tags?|all|more|\+\d+)$/i.test(t)
  let genres: string[] = []

  // 1. structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    if (genres.length) return
    try {
      const walk = (v: any): void => {
        if (!v || typeof v !== 'object' || genres.length) return
        if (Array.isArray(v)) return v.forEach(walk)
        const g = v.genre
        if (g) genres = (Array.isArray(g) ? g : String(g).split(',')).map((x: unknown) => clean(String(x))).filter(ok)
        for (const k of Object.keys(v)) if (typeof v[k] === 'object') walk(v[k])
      }
      walk(JSON.parse($(el).contents().text()))
    } catch {
      /* not JSON */
    }
  })

  // 2. the page's own genre block, away from menus
  $('header, nav, footer, aside, [class*="menu"], [class*="dropdown"], [id*="menu"], [class*="sidebar"], [class*="footer"]').remove()
  if (!genres.length) {
    const known = $('.genres-content a, .mgen a, .wp-manga-tags-list a, .seriestugenre a, .genres a, .genre a, .tags a, [class*="genre"] a, a[rel="tag"]')
    genres = known.toArray().map((el) => clean($(el).text())).filter(ok)
  }
  // 3. any link to a genre page left in the content
  if (!genres.length) {
    genres = $('a[href]')
      .toArray()
      .filter((el) => /\/(genres?|tags?|categor(y|ies))\/|[?&]genres?=/i.test($(el).attr('href') ?? ''))
      .map((el) => clean($(el).text()))
      .filter(ok)
  }
  genres = [...new Map(genres.map((g) => [g.toLowerCase(), g])).values()]
  if (genres.length > 15) genres = [] // that was a menu of every genre, not this series' genres

  const text = clean($('body').text()).slice(0, 200000)
  let type: SeriesType | undefined
  const tm = /\b(?:type|format|comic type)\s*:?\s*(manga|manhwa|manhua|webtoon)\b/i.exec(text)
  if (tm) type = TYPE_WORD[tm[1].toLowerCase()]
  // many sites list the type among the genres
  const typed = genres.filter((g) => TYPE_WORD[g.toLowerCase()])
  if (!type && typed.length === 1) type = TYPE_WORD[typed[0].toLowerCase()]
  genres = genres.filter((g) => !TYPE_WORD[g.toLowerCase()])
  genres = canonGenres(genres)
  // a site whose own name says what it hosts (manhwatop, manhuatop)
  if (!type) {
    try {
      const host = new URL(pageUrl).hostname
      if (/manhwa/i.test(host)) type = 'manhwa'
      else if (/manhua/i.test(host)) type = 'manhua'
    } catch {
      /* no host */
    }
  }
  let status: SeriesStatus | undefined
  const sm = /\bstatus\s*:?\s*(on going|ongoing|releasing|publishing|completed|complete|finished|ended|hiatus|on hold|cancell?ed|dropped)\b/i.exec(text)
  if (sm) status = STATUS_WORD[sm[1].toLowerCase()]
  return {
    ...(type ? { type } : {}),
    ...(genres.length ? { genres: genres.slice(0, 12) } : {}),
    ...(status ? { status } : {})
  }
}

// ---- genre names: one standard name per genre, whatever the site calls it (and in whatever language) ----

/** Lower-case, no punctuation, Arabic letter variants folded (أ إ آ → ا, ة → ه, ى → ي), leading "ال" dropped. */
function genreKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟ]/g, '') // Arabic marks (hamza, harakat) split off by NFKD
    .replace(/[’'`´]/g, '')
    .replace(/[-_/.&+]/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .join(' ')
}

const CANON: Record<string, string[]> = {
  Action: ['action', 'اكشن', 'حركه'],
  Adventure: ['adventure', 'adventures', 'مغامرات', 'مغامره'],
  Comedy: ['comedy', 'comedic', 'humor', 'humour', 'كوميدي', 'كوميديا'],
  Drama: ['drama', 'دراما'],
  Fantasy: ['fantasy', 'خيال', 'فانتازيا', 'فنتازيا', 'فانتازي'],
  Horror: ['horror', 'رعب'],
  Mystery: ['mystery', 'mysteries', 'غموض'],
  Romance: ['romance', 'romantic', 'رومانسي', 'رومانسيه'],
  'Sci-Fi': ['sci fi', 'scifi', 'science fiction', 'خيال علمي'],
  'Slice of Life': ['slice of life', 'sol', 'شريحه من الحياه', 'شريحة حياة', 'الحياة اليومية'],
  Sports: ['sports', 'sport', 'رياضه', 'رياضي'],
  Supernatural: ['supernatural', 'خارق للطبيعه', 'خوارق', 'فوق الطبيعة'],
  Thriller: ['thriller', 'suspense', 'اثاره', 'تشويق'],
  Psychological: ['psychological', 'نفسي'],
  Tragedy: ['tragedy', 'ماساه', 'ماساوي', 'تراجيدي'],
  Historical: ['historical', 'history', 'تاريخي'],
  'Martial Arts': ['martial arts', 'martial art', 'فنون قتال', 'فنون قتاليه'],
  'School Life': ['school life', 'school', 'مدرسي', 'حياه مدرسيه', 'مدرسه'],
  Shounen: ['shounen', 'shonen', 'شونين'],
  Shoujo: ['shoujo', 'shojo', 'شوجو'],
  Seinen: ['seinen', 'سينين'],
  Josei: ['josei', 'جوسي', 'جوسيه'],
  Isekai: ['isekai', 'ايسيكاي', 'ايسكاي', 'عالم اخر'],
  Harem: ['harem', 'حريم'],
  Ecchi: ['ecchi', 'ايتشي'],
  Mature: ['mature', 'ناضج', 'للكبار', 'راشد'],
  Adult: ['adult', '18+', 'r18', 'بالغ'],
  Smut: ['smut'],
  'Gender Bender': ['gender bender', 'genderswap', 'gender swap', 'تحول جنسي', 'جيندر بندر'],
  Mecha: ['mecha', 'mech', 'ميكا', 'روبوتات'],
  Military: ['military', 'war', 'عسكري', 'حرب', 'حربي'],
  Music: ['music', 'موسيقي'],
  Cooking: ['cooking', 'food', 'طبخ'],
  Medical: ['medical', 'طبي'],
  Magic: ['magic', 'magical', 'سحر'],
  Reincarnation: ['reincarnation', 'reincarnated', 'rebirth', 'تناسخ', 'اعاده تجسد', 'تجسد'],
  Regression: ['regression', 'regressor', 'عوده بالزمن', 'تراجع', 'تراجعي'],
  'Time Travel': ['time travel', 'سفر عبر الزمن'],
  Cultivation: ['cultivation', 'xianxia', 'xuanhuan', 'wuxia', 'صقل', 'زراعه'],
  Murim: ['murim', 'موريم'],
  Game: ['game', 'games', 'gaming', 'video games', 'العاب', 'لعبه', 'العاب فيديو'],
  System: ['system', 'نظام'],
  Dungeons: ['dungeons', 'dungeon', 'زنزانات', 'زنزانه'],
  Demons: ['demons', 'demon', 'شياطين'],
  Monsters: ['monsters', 'monster', 'وحوش'],
  Vampire: ['vampire', 'vampires', 'مصاصي دماء', 'مصاص دماء'],
  Zombies: ['zombies', 'zombie', 'زومبي'],
  'Post-Apocalyptic': ['post apocalyptic', 'apocalypse', 'apocalyptic', 'نهايه عالم'],
  Survival: ['survival', 'نجاه'],
  Revenge: ['revenge', 'انتقام'],
  Villainess: ['villainess', 'شريره'],
  Crime: ['crime', 'جريمه'],
  Detective: ['detective', 'تحقيق', 'محقق'],
  Police: ['police', 'شرطه'],
  'Super Power': ['super power', 'superpower', 'superpowers', 'super powers', 'قوه خارقه', 'قوي خارقه'],
  Overpowered: ['overpowered', 'op mc', 'بطل غير اعتيادي', 'بطل قوي'],
  Gore: ['gore', 'دموي'],
  "Boys' Love": ['boys love', 'bl', 'yaoi', 'shounen ai', 'shonen ai'],
  "Girls' Love": ['girls love', 'gl', 'yuri', 'shoujo ai', 'shojo ai'],
  'Office Workers': ['office workers', 'office', 'workplace'],
  'One Shot': ['one shot', 'oneshot'],
  Doujinshi: ['doujinshi'],
  'Full Color': ['full color', 'colored', 'full colour', 'ملون'],
  Hentai: ['hentai'],
  'Award Winning': ['award winning', 'حائز على جوائز', 'حائز علي جوائز'],
  Adaptation: ['adaptation', 'adapted', 'مقتبس']
}
const CANON_BY_KEY = new Map<string, string>()
for (const [name, words] of Object.entries(CANON)) for (const w of [name, ...words]) CANON_BY_KEY.set(genreKey(w), name)

/** Words sites put among genres that are not genres. */
const NOT_GENRE = new Set(
  ['manga', 'manhwa', 'manhua', 'webtoon', 'webtoons', 'comic', 'comics', 'novel', 'raw', 'english', 'hot', 'new', 'latest',
    'popular', 'trending', 'updated', 'completed', 'ongoing', 'other', 'others', 'misc', 'unknown', 'genre', 'genres', 'add', 'all', 'long strip', 'web comic', 'webcomic', 'official colored', 'oneshot collection',
    'مانجا', 'مانهوا', 'مانها', 'ويبتون', 'ويب تون', 'مكتمل', 'مستمر', 'جديد', 'رائج'].map(genreKey)
)

/** One standard name for a genre ("shonen", "Shōnen", "شونين" → "Shounen"); null for words that aren't genres. */
export function canonGenre(raw: string): string | null {
  const k = genreKey(raw)
  if (!k || NOT_GENRE.has(k)) return null
  const hit = CANON_BY_KEY.get(k) ?? CANON_BY_KEY.get(k.replace(/s$/, ''))
  if (hit) return hit
  // keep the site's own word, tidied: "slow  burn" → "Slow Burn" (Arabic and other scripts kept as written)
  const t = raw.replace(/\s+/g, ' ').trim()
  return /^[\x20-\x7e]+$/.test(t) ? t.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : t
}

/** The standard name only when the word is a known genre (no tidied-up fallback). */
export function knownGenre(raw: string): string | null {
  const k = genreKey(raw)
  return CANON_BY_KEY.get(k) ?? CANON_BY_KEY.get(k.replace(/s$/, '')) ?? null
}

export function canonGenres(list: string[]): string[] {
  const out: string[] = []
  for (const g of list) {
    const c = canonGenre(g)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/**
 * Chapters that are in the page's data but not drawn as links (some sites draw the first and the newest chapters and
 * keep the rest in a script: `slug:"chapter-7",number:7`). Only used when the page's own chapter links are
 * <series address>/<slug>, so the missing addresses can be written the same way.
 */
export function dataChapters(html: string, seriesUrl: string, have: { url: string }[]): { title: string; url: string }[] {
  if (!html) return []
  const base = seriesUrl.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const trim = (u: string): string => u.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const haveUrls = new Set(have.map((c) => trim(c.url)))
  const sameShape = have.some((c) => {
    const u = trim(c.url)
    return u.startsWith(base + '/') && !u.slice(base.length + 1).includes('/')
  })
  if (!sameShape) return []
  const raw = html.replace(/\\"/g, '"').replace(/&quot;/g, '"')
  const found = new Map<string, string>() // slug -> number
  const add = (slug: string, num: string): void => {
    if (!/\d/.test(slug) || slug.length > 80 || /[\s/]/.test(slug)) return
    if (!found.has(slug)) found.set(slug, num)
  }
  const q = '["\']?'
  const slugFirst = new RegExp(q + 'slug' + q + '\\s*:\\s*["\']([^"\']+)["\']\\s*,\\s*' + q + '(?:number|chapter_number|chapterNumber|chapter|num)' + q + '\\s*:\\s*["\']?(\\d+(?:\\.\\d+)?)', 'g')
  const numFirst = new RegExp(q + '(?:number|chapter_number|chapterNumber|num)' + q + '\\s*:\\s*["\']?(\\d+(?:\\.\\d+)?)["\']?\\s*,\\s*' + q + 'slug' + q + '\\s*:\\s*["\']([^"\']+)["\']', 'g')
  for (const m of raw.matchAll(slugFirst)) add(m[1], m[2])
  for (const m of raw.matchAll(numFirst)) add(m[2], m[1])
  // the slugs must look like this series' chapter slugs (at least one of them is already a link)
  if (![...found.keys()].some((s) => haveUrls.has(base + '/' + s))) return []
  const out: { title: string; url: string }[] = []
  for (const [slug, num] of found) {
    const url = base + '/' + slug
    if (!haveUrls.has(url)) out.push({ title: 'Chapter ' + num, url })
  }
  return out
}
