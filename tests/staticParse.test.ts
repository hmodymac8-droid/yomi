import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChapterImages, parseSeries } from '../src/main/staticParse.ts'

const page = 'https://www.fastestmanga.com/ar/manga/a-fortune-telling-princess/'
const re = '/manga/[^/]+/(?:fsl|chapter)-[^/]+/?$'

test('"read first" / "read last" buttons are not chapters, in Arabic too', () => {
  const html = `
    <a href="${page}fsl-0/">اقرأ أولا</a>
    <a href="${page}fsl-2/">اقرأ الأخير</a>
    <a href="${page}fsl-1/">Read First</a>
    <a href="${page}fsl-2/">قراءة الأخير</a>
    <ul>
      <li><a href="${page}fsl-2/">فصل 2</a></li>
      <li><a href="${page}fsl-1/">فصل 1</a></li>
      <li><a href="${page}fsl-0/">فصل 0</a></li>
    </ul>`
  const { chapters } = parseSeries(html, page, re)
  assert.deepEqual(
    chapters.map((c) => c.title),
    ['فصل 2', 'فصل 1', 'فصل 0']
  )
})

test('a chapter whose title starts with a button word but has a number is kept', () => {
  const html = `<a href="${page}fsl-5/">الأخير 5</a>`
  assert.equal(parseSeries(html, page, re).chapters.length, 1)
})

test('a chapter the site sells is reported as locked, not read as pages (coins popup)', () => {
  const page = 'https://violetmanga.com/some-series-chapter-110/'
  const html = `
    <img src="https://violetmanga.com/wp-content/plugins/thunder-coins-bonus-popup/assets/img/default/treasure-chest.png">
    <img src="https://violetmanga.com/wp-content/plugins/thunder-coins-bonus-popup/assets/img/default/coin.png">
    <img src="https://violetmanga.com/wp-content/plugins/thunder-coins-bonus-popup/assets/img/default/coin.png">
    <div class="lock-container"><h1 class="lock-title">Chapter 110</h1>
      <p class="lock-status">This chapter is locked. Please purchase it to read the full content.</p>
      <p>Free in 2027-05-24 00:00:00</p></div>`
  const r = parseChapterImages(html, page)
  assert.deepEqual(r.pages, [])
  assert.match(r.locked ?? '', /locked.*2027-05-24/)
})

test('site icons, plugin pictures and comment stickers are never pages', () => {
  const page = 'https://example.com/series/chapter-9/'
  const stickers = Array.from(
    { length: 30 },
    (_, i) => `<img src="https://example.com/wp-content/uploads/2025/03/react${i}.webp" class="wpdem-editor-sticker" style="width:40px;max-width:40px;">`
  ).join('')
  const icons = ['32x32', '192x192', '180x180']
    .map((s) => `<img src="https://example.com/wp-content/uploads/2026/09/site-${s}.png">`)
    .join('')
  const real = [1, 2, 3, 4, 5].map((n) => `https://cdn.example.com/data/ch9/${n}.jpg`)
  const html = stickers + icons + real.map((u) => `<img src="${u}">`).join('')
  const r = parseChapterImages(html, page)
  assert.deepEqual(r.pages, real)
  assert.equal(r.locked, undefined)
})

test('the reader area wins even when every page sits in its own folder (Top Manhua)', () => {
  const page = 'https://topmanhua.net/manga/x/chapter-192/'
  const thumbs = [1, 2, 3, 4, 5, 6]
    .map((n) => `<img src="https://topmanhua.net/wp-content/uploads/2025/04/t${n}-thumb-small.webp">`)
    .join('')
  const real = [421256, 421257, 421258, 421259].map(
    (n) => `https://cdn.topmanhua.net/storage/media/${n}/conversions/p-optimized.webp`
  )
  const html =
    `<div class="reading-content">` +
    real.map((u) => `<div class="page-break "><img data-src="${u}" class="wp-manga-chapter-img"></div>`).join('') +
    `</div><aside>${thumbs}</aside>`
  assert.deepEqual(parseChapterImages(html, page).pages, real)
})

test("Madara's protected page list (chapter_data) is decrypted (Gourmet)", async () => {
  const { createCipheriv, createHash, randomBytes } = await import('node:crypto')
  const pass = '92415cbc18'
  const real = ['https://example.com/WP-manga/data/m/1.jpg', 'https://example.com/WP-manga/data/m/2.jpg']
  const salt = randomBytes(8)
  let prev = Buffer.alloc(0)
  let kd = Buffer.alloc(0)
  while (kd.length < 48) {
    prev = createHash('md5').update(Buffer.concat([prev, Buffer.from(pass), salt])).digest()
    kd = Buffer.concat([kd, prev])
  }
  const c = createCipheriv('aes-256-cbc', kd.subarray(0, 32), kd.subarray(32, 48))
  const ct = Buffer.concat([c.update(JSON.stringify(JSON.stringify(real))), c.final()]).toString('base64')
  const data = JSON.stringify({ ct, iv: kd.subarray(32, 48).toString('hex'), s: salt.toString('hex') }).replace(/\//g, '\/')
  const html = `<script>var wpmangaprotectornonce='${pass}';var chapter_data='${data}';</script>
    <div class="reading-content"><div class="page-break"></div><div class="page-break"></div></div>`
  assert.deepEqual(parseChapterImages(html, 'https://example.com/m/chapter-1/').pages, real)
})

test("entries of a Madara chapter list are chapters even without 'chapter' in the address (Manga Eclipse)", () => {
  const page = 'https://mangaeclipse.com/manga/peculiar-tales/'
  const html = `<ul class="main">
    <li class="wp-manga-chapter"><a href="${page}chapter-14/">Chapter 14</a></li>
    <li class="wp-manga-chapter"><a href="${page}12-slap/">12 - Slap</a></li>
    <li class="wp-manga-chapter"><a href="${page}11-the-duel/">11 - The Duel</a></li></ul>
    <a href="https://mangaeclipse.com/manga/other-series/">Other series</a>`
  const { chapters } = parseSeries(html, page, '(?:chapter|chap|ch|episode|ep|read)[-_/ ]?\d')
  assert.deepEqual(chapters.map((c) => c.url), [`${page}chapter-14/`, `${page}12-slap/`, `${page}11-the-duel/`])
})
