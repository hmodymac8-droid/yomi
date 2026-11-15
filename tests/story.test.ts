import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aniListText, cleanStory, pickStory } from '../src/main/storyLogic.ts'

test('site-only lines leave no story', () => {
  const lines = [
    'Mercenary Enrollment also known as Teenage Mercenary was written by YC and drawn by Rakhyun. This series was published on 2020 and recommended for readers who likes Action, Drama, Romance, School Life, Shounen genre. Read Mercenary Enrollment at mangafreak.',
    'Read The Necromancer of a Noble Sword Family manga online for free on MangaNato! Get the latest chapters, high-quality scans, and raw versions of your favorite series. Enjoy an immersive reading experience and stay up-to-date with The Necromancer of a Noble Sword Family.',
    'Read Duke Pendragon - Master of the White Dragon Manhwa online for free at Weeb Central',
    'جميع فصول مانجا How to Live as a Villain مترجمة بجودة عالية على موقع MangaDar ، قراءة جميع فصول مانجا How to Live as a Villain مترجم اون لاين.',
    'اقرأ مانجا Ansatsu Kyoushitsu مترجمة للعربية على مانجا العاشق، وتابع الفصول والتحديثات.'
  ]
  for (const l of lines) assert.equal(cleanStory(l), '', l.slice(0, 40))
})

test('the story is kept and the advertising around it goes', () => {
  assert.equal(
    cleanStory(
      'Read Levelling Up In An Exclusive Dungeon Korean Manhwa online free on BaeToon. Hunter Kang Jin-hyeok has been D-rank for years. His days were spent barely scraping by.'
    ),
    'Hunter Kang Jin-hyeok has been D-rank for years. His days were spent barely scraping by.'
  )
  const mt = cleanStory(
    'Manhwa "Levelling Up In An Exclusive Dungeon" which is rencently published, is searched by many. is published online for free on Manhwa adventure The description of the comics "Levelling Up In An Exclusive Dungeon": Kang Jin-hyeok, a D-rank hunter for years. One day, a dungeon appears in his room. "Levelling Up In An Exclusive Dungeon" is alternative: Level Up Through Dungeon Exclusivity'
  )
  assert.equal(mt, 'Kang Jin-hyeok, a D-rank hunter for years. One day, a dungeon appears in his room.')
  const sid = cleanStory(
    'قراءة جميع فصول مانجا Eleceed مترجمة عربي أون لاين وبجودة عالية. استمتع بأحداث Eleceed المثيرة عبر 430 الفصول المتوفرة حصرياً على موقع مانجا سيد. كايدن، المحارب الاستثنائي الذي يمتلك قوى خارقة متعددة، كان يخوض معارك عنيفة ضد خصوم يستخدمون موهبات خاصة.'
  )
  assert.ok(sid.startsWith('كايدن، المحارب'), sid)
  const story = 'The ordinary F-rank hunter, Gang HyeonJoon, had always prayed for the strength to change his life. One day, his prayers were answered.'
  assert.equal(cleanStory(story), story)
})

test('another site fills in when the one being read has no story', () => {
  const real = 'Kang Jin-hyeok, a D-rank hunter for years, finds a dungeon in his own room and starts to level up.'
  assert.deepEqual(
    pickStory(
      [
        { text: 'Read X at mangafreak.', own: true, lang: 'en' },
        { text: 'كانغ جين هيوك صياد من الرتبة D منذ سنوات، يجد زنزانة في غرفته ويبدأ في رفع مستواه شيئاً فشيئاً.', lang: 'ar', from: 'Azora' },
        { text: real, lang: 'en', from: 'BaeToon' }
      ],
      'X',
      'en'
    ),
    { text: real, from: 'BaeToon' }
  )
  // the site being read wins when its story is real
  assert.deepEqual(pickStory([{ text: real, own: true }, { text: real + ' More.', from: 'B' }], 'X'), { text: real })
  assert.equal(pickStory([{ text: 'Read X online for free at Weeb Central', own: true }], 'X'), null)
})

test('AniList text loses its HTML and source note', () => {
  assert.equal(
    aniListText('Kang Jin-hyeok is a D-rank hunter.<br><br>\n<i>He finds a dungeon.</i> (Source: Webtoon)'),
    'Kang Jin-hyeok is a D-rank hunter. He finds a dungeon.'
  )
})
