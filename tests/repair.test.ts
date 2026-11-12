import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  applyFailure,
  applyProbe,
  applyRecovery,
  applyRelocation,
  chapterNumber,
  classifyFailure,
  emptyOutage,
  interpretChapter,
  interpretResponse,
  isBlockedSource,
  mapHost,
  normalizeTitle,
  noteCandidate,
  orderSourceIds,
  probeDelay,
  PROBE_BACKOFF_MS,
  rankAlternatives,
  rewriteDetailUrls,
  runProbePass,
  urlsToTry,
  writeSourceStatus,
  type AltCandidate,
  type OutageState,
  type ProbeTarget,
  type RelocatableSource
} from '../src/main/repair.ts'

const now = 1_700_000_000_000

test('classifyFailure names the outages that take a source out of rotation', () => {
  assert.equal(classifyFailure('getaddrinfo ENOTFOUND example.com'), 'network')
  assert.equal(classifyFailure('Page load timed out'), 'timeout')
  assert.equal(
    classifyFailure('Opening the chapter took too long. Try again in a moment.'),
    'timeout'
  )
  assert.equal(
    classifyFailure('source unavailable (cloudflare): Blocked by a browser check'),
    'cloudflare'
  )
  assert.equal(classifyFailure("The site's data feed answered with an error (503)."), 'http')
  assert.equal(classifyFailure('HTTP 502'), 'http')
  assert.equal(classifyFailure('No chapters found'), 'none')
  assert.equal(classifyFailure('This page is not on the site any more.'), 'none')
  assert.equal(classifyFailure('', 503), 'http')
})

test('a chapter 404 is not an outage, a dead home page is', () => {
  const missing = interpretChapter(
    {
      status: 404,
      html: '<html><title>Not found</title></html>',
      finalUrl: 'https://a.example/ch/1'
    },
    'https://a.example/ch/1'
  )
  assert.equal(missing.kind, 'none')
  assert.equal(missing.up, false)

  const home = interpretResponse(
    { status: 404, html: '<html><title>Not found</title></html>', finalUrl: 'https://a.example/' },
    'https://a.example/',
    'home'
  )
  assert.equal(home.kind, 'http')
  assert.equal(home.up, false)
})

test('cloudflare, 5xx, timeout and a real domain move are recognised', () => {
  const wall = interpretResponse(
    {
      status: 503,
      html: '<html><title>Just a moment...</title> cf-browser-verification</html>',
      finalUrl: 'https://a.example/'
    },
    'https://a.example/',
    'home'
  )
  assert.equal(wall.kind, 'cloudflare')
  assert.equal(wall.up, false)

  const down = interpretResponse(
    {
      status: 502,
      html: '<html><title>Bad gateway</title></html>',
      finalUrl: 'https://a.example/'
    },
    'https://a.example/',
    'home'
  )
  assert.equal(down.kind, 'http')

  const timed = interpretResponse(
    { status: 0, html: '', finalUrl: '', error: 'The operation was aborted' },
    'https://a.example/',
    'home'
  )
  assert.equal(timed.kind, 'timeout')

  const moved = interpretResponse(
    {
      status: 200,
      html: '<html><title>Manga</title>' + 'x'.repeat(100) + '</html>',
      finalUrl: 'https://b.example/'
    },
    'https://a.example/',
    'home'
  )
  assert.equal(moved.up, true)
  assert.equal(moved.movedTo, 'https://b.example')

  const parked = interpretResponse(
    {
      status: 200,
      html: '<html><title>Domain for sale</title> buy this domain</html>',
      finalUrl: 'https://b.example/'
    },
    'https://a.example/',
    'home'
  )
  assert.equal(parked.up, false)
  assert.equal(parked.movedTo, undefined)
})

test('www is the same site, and a parked or challenge page does not count as up', () => {
  const www = interpretResponse(
    {
      status: 200,
      html: '<html><title>Home</title>' + 'x'.repeat(80) + '</html>',
      finalUrl: 'https://www.a.example/'
    },
    'https://a.example/',
    'home'
  )
  assert.equal(www.up, true)
  assert.equal(www.movedTo, undefined)
})

test('one timeout degrades, the next failure marks the source down, and history stays short', () => {
  const first = applyFailure(emptyOutage(), 'timeout', 'Page load timed out', now, 0)
  assert.equal(first.changed, true)
  assert.equal(first.state.availability, 'degraded')
  assert.equal(first.state.history.length, 1)
  assert.equal(first.state.probeAttempt, 1)
  assert.ok(first.state.nextProbeAt && first.state.nextProbeAt > now)

  const again = applyFailure(first.state, 'timeout', 'Page load timed out', now + 1, 0)
  assert.equal(again.changed, false)

  const second = applyFailure(first.state, 'network', 'ENOTFOUND', now + DEDUPE_PAST, 0)
  assert.equal(second.state.availability, 'down')
  assert.equal(second.state.reason, 'ENOTFOUND')

  let state = emptyOutage()
  for (let i = 0; i < 12; i++) {
    state = applyFailure(state, 'http', 'HTTP 500 ' + i, now + i * 120_000, 0.2).state
  }
  assert.equal(state.history.length, 8)
  assert.match(state.history[0].reason, /HTTP 500 0/)
  assert.match(state.history[state.history.length - 1].reason, /HTTP 500 11/)
})

const DEDUPE_PAST = 120_000

test('a probe that answers restores, a new host relocates, a miss backs off', () => {
  const down = applyFailure(emptyOutage(), 'http', 'HTTP 503', now, 0).state
  const up = applyProbe(down, { up: true, kind: 'none', detail: 'Answered' }, now + 500_000, 0)
  assert.equal(up.action, 'restored')
  assert.equal(up.state.availability, 'ok')
  assert.equal(up.state.nextProbeAt, undefined)
  assert.equal(up.state.probeAttempt, 0)
  assert.equal(up.state.history.at(-1)?.kind, 'restored')

  const moved = applyProbe(
    down,
    { up: true, kind: 'moved', movedTo: 'https://b.example', detail: 'Now at https://b.example' },
    now + 500_000,
    0
  )
  assert.equal(moved.action, 'relocated')
  assert.equal(moved.movedTo, 'https://b.example')

  const miss = applyProbe(down, { up: false, kind: 'http', detail: 'HTTP 503' }, now + 500_000, 1)
  assert.equal(miss.action, 'retry')
  assert.equal(miss.state.availability, 'down')
  assert.ok((miss.state.nextProbeAt ?? 0) > now + 500_000)
  assert.ok((miss.state.probeAttempt ?? 0) > down.probeAttempt)
})

test('probe delay grows and stays inside the jitter band', () => {
  assert.equal(probeDelay(0, 0), Math.round(PROBE_BACKOFF_MS[0] * 0.8))
  assert.equal(probeDelay(0, 1), Math.round(PROBE_BACKOFF_MS[0] * 1.2))
  const cap = PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1]
  assert.equal(probeDelay(99, 0.5), Math.round(cap * 1))
  const mid = probeDelay(2, 0.3)
  assert.ok(mid >= PROBE_BACKOFF_MS[2] * 0.8 && mid <= PROBE_BACKOFF_MS[2] * 1.2)
})

test('fallback order is pin, then last read, then fastest healthy site', () => {
  const sites: AltCandidate[] = [
    {
      sourceId: 'slow',
      sourceName: 'Slow',
      url: 'https://slow/',
      pinned: false,
      lastReadAt: 0,
      speedMs: 9000,
      availability: 'ok',
      blocked: false
    },
    {
      sourceId: 'fast',
      sourceName: 'Fast',
      url: 'https://fast/',
      pinned: false,
      lastReadAt: 0,
      speedMs: 400,
      availability: 'ok',
      blocked: false
    },
    {
      sourceId: 'recent',
      sourceName: 'Recent',
      url: 'https://recent/',
      pinned: false,
      lastReadAt: 50,
      speedMs: 8000,
      availability: 'ok',
      blocked: false
    },
    {
      sourceId: 'pin',
      sourceName: 'Pin',
      url: 'https://pin/',
      pinned: true,
      lastReadAt: 0,
      speedMs: 9000,
      availability: 'ok',
      blocked: false
    },
    {
      sourceId: 'dead',
      sourceName: 'Dead',
      url: 'https://dead/',
      pinned: false,
      lastReadAt: 99,
      speedMs: 10,
      availability: 'down',
      blocked: false
    },
    {
      sourceId: 'shaky',
      sourceName: 'Shaky',
      url: 'https://shaky/',
      pinned: false,
      lastReadAt: 99,
      speedMs: 10,
      availability: 'degraded',
      blocked: false
    },
    {
      sourceId: 'comix-to',
      sourceName: 'Comix',
      url: 'https://comix.to/',
      pinned: false,
      lastReadAt: 99,
      speedMs: 10,
      availability: 'ok',
      blocked: true
    },
    {
      sourceId: 'extra',
      sourceName: 'Extra',
      url: 'https://extra/',
      pinned: false,
      lastReadAt: 0,
      speedMs: 500,
      availability: 'ok',
      blocked: false
    }
  ]
  const ranked = rankAlternatives(sites, 5)
  assert.deepEqual(
    ranked.map((s) => s.sourceId),
    ['pin', 'recent', 'fast', 'extra', 'slow']
  )
  assert.equal(isBlockedSource('comix-to', 'https://comix.to/'), true)
  const pinnedComix = rankAlternatives(
    [
      {
        sourceId: 'comix-to',
        sourceName: 'Comix',
        url: 'https://comix.to/x',
        pinned: true,
        lastReadAt: 0,
        availability: 'ok',
        blocked: true
      }
    ],
    5
  )
  assert.equal(pinnedComix.length, 1)
})

test('a down site leaves the default slot unless the user pinned it, and Comix is not promoted', () => {
  const members = [
    { id: 'dead', baseUrl: 'https://dead.example/', availability: 'down' as const },
    { id: 'comix-to', baseUrl: 'https://comix.to/', availability: 'ok' as const },
    { id: 'live', baseUrl: 'https://live.example/', availability: 'ok' as const }
  ]
  assert.deepEqual(orderSourceIds(members), ['live', 'dead', 'comix-to'])
  assert.deepEqual(orderSourceIds(members, 'dead'), ['dead', 'comix-to', 'live'])
  assert.deepEqual(
    orderSourceIds([
      { id: 'comix-to', baseUrl: 'https://comix.to/', availability: 'ok' },
      { id: 'live', baseUrl: 'https://live.example/', availability: 'ok' }
    ]),
    ['comix-to', 'live']
  )
})

test('known-down hosts are skipped so another url is tried immediately', () => {
  const left = urlsToTry(
    ['https://dead.example/a', 'https://www.dead.example/b', 'https://mirror.example/c'],
    'https://dead.example/'
  )
  assert.deepEqual(left, ['https://mirror.example/c'])
})

test('chapter numbers used to match the same chapter on another site', () => {
  assert.equal(chapterNumber('Chapter 12.5'), 12.5)
  assert.equal(chapterNumber('Ep. 3'), 3)
  assert.equal(chapterNumber('الفصل 40'), 40)
  assert.equal(chapterNumber('Gallery'), null)
})

test('relocation rewrites the source row and keeps a {n} page marker', () => {
  const src: RelocatableSource = {
    id: 'demo',
    baseUrl: 'https://old.example/',
    listTemplate: 'https://old.example/manga/page/{n}/',
    listTemplates: ['https://old.example/search?q=a&page={n}'],
    seriesRe: '^https://old\\.example/manga/[^/?#]+/?$',
    sitemaps: ['https://old.example/sitemap.xml'],
    api: { base: 'https://old.example/v2/api/' },
    availability: 'down',
    availabilityAt: 1,
    availabilityReason: 'HTTP 503'
  }
  const series = [{ url: 'https://old.example/manga/one', cover: 'https://cdn.example/c.jpg' }]
  const added = [{ url: 'https://old.example/manga/one' }]
  const moved = applyRelocation(src, series, added, 'https://new.example')
  assert.ok(moved)
  assert.equal(moved.oldHost, 'old.example')
  assert.equal(src.baseUrl, 'https://new.example/')
  assert.equal(src.listTemplate, 'https://new.example/manga/page/{n}/')
  assert.equal(src.listTemplates?.[0], 'https://new.example/search?q=a&page={n}')
  assert.equal(src.seriesRe, '^https://new\\.example/manga/[^/?#]+/?$')
  assert.equal(src.sitemaps?.[0], 'https://new.example/sitemap.xml')
  assert.equal(src.api?.base, 'https://new.example/v2/api/')
  assert.equal(src.availability, undefined)
  assert.equal(src.previousBaseUrl, 'https://old.example/')
  assert.equal(series[0].url, 'https://new.example/manga/one')
  assert.equal(series[0].cover, 'https://cdn.example/c.jpg')
  assert.equal(
    mapHost('https://www.old.example/a', 'old.example', 'https://new.example'),
    'https://new.example/a'
  )
  assert.equal(applyRelocation(src, series, added, 'https://www.new.example'), null)
})

test('status and the new url round-trip through the catalog file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yomi-repair-'))
  const file = join(dir, 'catalog.json')
  const doc = {
    sources: [
      {
        id: 'demo',
        name: 'Demo',
        baseUrl: 'https://old.example/',
        listTemplate: 'https://old.example/page/{n}/',
        seriesRe: '^https://old\\.example/s/',
        chapterRe: 'chapter',
        maxPages: 10
      }
    ] as RelocatableSource[],
    series: { demo: [{ url: 'https://old.example/s/one', title: 'One', cover: '' }] },
    added: [{ url: 'https://old.example/s/one', sourceId: 'demo' }],
    scan: {}
  }
  writeFileSync(file, JSON.stringify(doc))
  const loaded = JSON.parse(readFileSync(file, 'utf8')) as typeof doc
  writeSourceStatus(loaded.sources[0], 'down', now, 'HTTP 503')
  writeFileSync(file, JSON.stringify(loaded))
  const marked = JSON.parse(readFileSync(file, 'utf8')) as typeof doc
  assert.equal(marked.sources[0].availability, 'down')
  assert.equal(marked.sources[0].availabilityReason, 'HTTP 503')
  assert.equal(marked.sources[0].availabilityAt, now)

  applyRelocation(marked.sources[0], marked.series.demo, marked.added, 'https://new.example')
  const detail = rewriteDetailUrls(
    {
      url: 'https://old.example/s/one',
      chapters: [
        { url: 'https://old.example/s/one/ch-1', alts: ['https://old.example/s/one/ch-1b'] }
      ]
    },
    'old.example',
    'https://new.example'
  )
  marked.series.demo[0].url = detail.url
  writeFileSync(file, JSON.stringify({ ...marked, detail }))
  const again = JSON.parse(readFileSync(file, 'utf8')) as typeof doc & { detail: typeof detail }
  assert.equal(again.sources[0].baseUrl, 'https://new.example/')
  assert.equal(again.sources[0].availability, undefined)
  assert.equal(again.sources[0].previousBaseUrl, 'https://old.example/')
  assert.equal(again.series.demo[0].url, 'https://new.example/s/one')
  assert.equal(again.detail.chapters[0].url, 'https://new.example/s/one/ch-1')
  assert.equal(again.detail.chapters[0].alts?.[0], 'https://new.example/s/one/ch-1b')
  assert.equal(again.sources[0].listTemplate, 'https://new.example/page/{n}/')
})

test('the prober restores, follows a candidate host, and does not touch Comix', async () => {
  const down = (id: string, base: string, extra: Partial<OutageState> = {}): ProbeTarget => ({
    id,
    baseUrl: base,
    state: {
      ...applyFailure(emptyOutage(), 'network', 'ENOTFOUND', now - 10 * 60_000, 0).state,
      nextProbeAt: now - 1000,
      ...extra
    }
  })
  const sleeps: number[] = []
  const fetched: string[] = []
  const results = await runProbePass({
    targets: [
      down('comix-to', 'https://comix.to/'),
      down('later', 'https://later.example/', { nextProbeAt: now + 60_000 }),
      down('back', 'https://back.example/'),
      down('moved', 'https://moved.example/', { candidateOrigin: 'https://moved-new.example' }),
      down('still', 'https://still.example/')
    ],
    now,
    random: () => 0,
    max: 3,
    gapMs: 15_000,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    probe: async (url) => {
      fetched.push(url)
      if (url.startsWith('https://back.example')) {
        return { up: true, kind: 'none', detail: 'Answered' }
      }
      if (url.startsWith('https://moved-new.example')) {
        return {
          up: true,
          kind: 'none',
          detail: 'Answered',
          movedTo: undefined
        }
      }
      return { up: false, kind: 'http', detail: 'HTTP 503' }
    }
  })
  assert.deepEqual(
    results.map((r) => r.id),
    ['back', 'moved', 'still']
  )
  assert.equal(results[0].action, 'restored')
  assert.equal(results[0].state.availability, 'ok')
  assert.equal(results[1].action, 'relocated')
  assert.equal(results[1].movedTo, 'https://moved-new.example')
  assert.equal(results[2].action, 'retry')
  assert.ok(results[2].state.nextProbeAt && results[2].state.nextProbeAt > now)
  assert.equal(fetched.includes('https://comix.to/'), false)
  assert.equal(fetched.includes('https://later.example/'), false)
  assert.equal(sleeps.length, 2)
  assert.ok(sleeps.every((ms) => ms >= 15_000))

  const noted = noteCandidate(
    down('back', 'https://back.example/').state,
    'https://alt.example/chapter/1',
    now
  )
  assert.equal(noted.candidateOrigin, 'https://alt.example')
})

test('recovery clears the outage fields that the source row stores', () => {
  const src: RelocatableSource = {
    id: 'demo',
    baseUrl: 'https://a.example/',
    listTemplate: 'https://a.example/{n}',
    seriesRe: 'a',
    availability: 'down',
    availabilityAt: 5,
    availabilityReason: 'HTTP 503'
  }
  const healed = applyRecovery(
    {
      availability: 'down',
      probeAttempt: 3,
      history: [],
      failedAt: 5,
      reason: 'HTTP 503',
      nextProbeAt: 9
    },
    'The original address answered again',
    now
  )
  writeSourceStatus(src, healed.availability, now, healed.reason)
  assert.equal(src.availability, undefined)
  assert.equal(src.availabilityReason, undefined)
  assert.equal(healed.availability, 'ok')
})

test('normalizeTitle keeps the Latin keys it always had', () => {
  assert.equal(normalizeTitle('One Piece'), 'one piece')
  assert.equal(normalizeTitle('  Café!  '), 'cafe')
  assert.equal(normalizeTitle('Naruto: Shippuden'), 'naruto shippuden')
  assert.equal(normalizeTitle('Foo-Bar'), 'foo bar')
  assert.equal(normalizeTitle('Søren'), 's ren')
  assert.equal(normalizeTitle('Straße'), 'stra e')
  assert.equal(normalizeTitle('Étoile'), 'etoile')
  assert.equal(normalizeTitle('ONE-PUNCH MAN'), 'one punch man')
  assert.equal(normalizeTitle('Attack on Titan #2'), 'attack on titan 2')
  assert.equal(normalizeTitle('   '), '')
  assert.equal(normalizeTitle('!!!'), '')
  assert.equal(normalizeTitle('Book 12'), 'book 12')
})

test('normalizeTitle folds Arabic harakat, tatweel and letter forms for matching', () => {
  const key = normalizeTitle('كتاب')
  assert.equal(key, 'كتاب')
  assert.equal(normalizeTitle('كِتَابٌ'), key)
  assert.equal(normalizeTitle('كـــتاب'), key)
  assert.equal(normalizeTitle('أحمد'), normalizeTitle('احمد'))
  assert.equal(normalizeTitle('فتى'), normalizeTitle('فتي'))
  assert.equal(normalizeTitle('مدرسة'), normalizeTitle('مدرسه'))
  assert.equal(normalizeTitle('ٱلرحمن'), normalizeTitle('الرحمن'))
})

test('normalizeTitle keeps both halves of a mixed Latin and Arabic title', () => {
  assert.equal(normalizeTitle('Solo Leveling أَحْمَد'), 'solo leveling احمد')
  assert.equal(normalizeTitle('Solo Leveling أَحْمَد'), normalizeTitle('solo leveling احمد'))
})

test('normalizeTitle keeps letters from other scripts', () => {
  assert.equal(normalizeTitle('進撃の巨人'), '進撃の巨人')
  assert.equal(normalizeTitle('Наруто'), 'наруто')
  assert.notEqual(normalizeTitle('進撃の巨人'), '')
  assert.notEqual(normalizeTitle('Наруто'), '')
})

test('a folded Arabic query token is found inside the folded title key', () => {
  const key = normalizeTitle('كِتَابُ الأَسْبَاب')
  assert.ok(key.includes(normalizeTitle('الاسباب')))
})

test('normalizeTitle lines up Arabic-Indic digits with 0-9', () => {
  assert.equal(normalizeTitle('الفصل ١٢'), normalizeTitle('الفصل 12'))
})
