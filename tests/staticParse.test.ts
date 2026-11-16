import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSeries } from '../src/main/staticParse.ts'

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
