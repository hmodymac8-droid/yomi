import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANILIST_AUTHORIZE_URL,
  ANILIST_DEFAULT_CLIENT_ID,
  ANILIST_GRAPHQL_URL,
  ANILIST_REDIRECT_URL,
  RateLimiter,
  anilistStatusForFinishedChapter,
  backoffMs,
  dueUpdates,
  enqueueUpdate,
  localProgressNumber,
  markAttemptFailure,
  markAttemptSuccess,
  matchScore,
  mergeProgressForward,
  parseOAuthToken,
  progressToSync,
  rankAniListMatches,
  scoreMedia,
  suggestBestMatch,
  titleCandidates,
  type AniListMediaHit,
  type ChapterRef,
  type QueuedUpdate
} from '../src/main/anilistLogic.ts'
import { chapterNumber } from '../src/main/repair.ts'
import {
  AniListClient,
  MEDIA_PROGRESS_QUERY,
  SAVE_ENTRY_MUTATION,
  SEARCH_MEDIA_QUERY,
  VIEWER_QUERY,
  flushQueue,
  type FetchLike
} from '../src/main/anilistClient.ts'

const media = (id: number, title: AniListMediaHit['title']): AniListMediaHit => ({ id, title })

const chapters: ChapterRef[] = [
  { title: 'Chapter 1', url: 'c1' },
  { title: 'Chapter 2', url: 'c2' },
  { title: 'Chapter 3', url: 'c3' },
  { title: 'Chapter 4', url: 'c4' }
]

const newestFirst: ChapterRef[] = [
  { title: 'Chapter 4', url: 'c4' },
  { title: 'Chapter 3', url: 'c3' },
  { title: 'Chapter 2', url: 'c2' },
  { title: 'Chapter 1', url: 'c1' }
]

const update = (
  mediaId: number,
  progress: number,
  status: 'CURRENT' | 'COMPLETED' = 'CURRENT'
): { mediaId: number; progress: number; status: 'CURRENT' | 'COMPLETED'; seriesUrl: string } => ({
  mediaId,
  progress,
  status,
  seriesUrl: `s${mediaId}`
})

test('the AniList endpoints are the documented ones', () => {
  assert.equal(ANILIST_AUTHORIZE_URL, 'https://anilist.co/api/v2/oauth/authorize')
  assert.equal(ANILIST_GRAPHQL_URL, 'https://graphql.anilist.co')
  assert.equal(ANILIST_REDIRECT_URL, 'https://anilist.co/api/v2/oauth/pin')
  assert.equal(ANILIST_DEFAULT_CLIENT_ID, '')
})

test('parseOAuthToken reads the token and expiry from the hash fragment', () => {
  const r = parseOAuthToken(
    'https://anilist.co/api/v2/oauth/pin#access_token=abc123&token_type=Bearer&expires_in=31536000'
  )
  assert.deepEqual(r, { accessToken: 'abc123', expiresIn: 31536000 })
})

test('parseOAuthToken works without expires_in', () => {
  assert.deepEqual(
    parseOAuthToken('https://anilist.co/api/v2/oauth/pin#access_token=abc123&token_type=Bearer'),
    { accessToken: 'abc123' }
  )
})

test('parseOAuthToken returns null when there is no token', () => {
  assert.equal(parseOAuthToken('https://anilist.co/api/v2/oauth/pin'), null)
  assert.equal(parseOAuthToken('https://anilist.co/api/v2/oauth/pin#token_type=Bearer'), null)
  assert.equal(parseOAuthToken(''), null)
})

test('parseOAuthToken falls back to the query string', () => {
  assert.deepEqual(
    parseOAuthToken('https://anilist.co/api/v2/oauth/pin?access_token=xyz&expires_in=60'),
    { accessToken: 'xyz', expiresIn: 60 }
  )
})

test('parseOAuthToken prefers the hash over the query', () => {
  assert.deepEqual(parseOAuthToken('https://x/pin?access_token=query#access_token=hash'), {
    accessToken: 'hash'
  })
})

test('chapterNumber parses the titles used in these tests', () => {
  assert.equal(chapterNumber('Chapter 1'), 1)
  assert.equal(chapterNumber('Prologue'), null)
})

test('titleCandidates lists non-empty unique titles', () => {
  assert.deepEqual(
    titleCandidates({ romaji: 'Berserk', english: 'Berserk', native: 'ベルセルク', userPreferred: null }),
    ['Berserk', 'ベルセルク']
  )
  assert.deepEqual(titleCandidates({}), [])
})

test('matchScore is 1 for the same title after normalization', () => {
  assert.equal(matchScore('One Piece', 'one piece'), 1)
  assert.equal(matchScore('  One   Piece ', 'One Piece'), 1)
})

test('matchScore is 0 when either side is empty or unrelated', () => {
  assert.equal(matchScore('', 'One Piece'), 0)
  assert.equal(matchScore('One Piece', ''), 0)
  assert.equal(matchScore('Berserk', 'Naruto'), 0)
})

test('matchScore gives a high but not perfect score when one title contains the other', () => {
  const s = matchScore('One Piece', 'One Piece Film Red')
  assert.ok(s > 0.7 && s < 1, `expected a high but not perfect score, got ${s}`)
})

test('matchScore handles Arabic alef variants through normalizeTitle', () => {
  assert.equal(matchScore('أمل', 'امل'), 1)
})

test('scoreMedia takes the best of the title candidates', () => {
  const m = media(1, { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' })
  assert.equal(scoreMedia('Attack on Titan', m), 1)
  assert.equal(scoreMedia('Shingeki no Kyojin', m), 1)
})

test('rankAniListMatches puts the exact title first', () => {
  const hits = [
    media(1, { english: 'One Piece Film Red' }),
    media(2, { english: 'One Piece' }),
    media(3, { english: 'One Piece Party' })
  ]
  const ranked = rankAniListMatches('One Piece', hits)
  assert.equal(ranked[0].media.id, 2)
  assert.equal(ranked[0].score, 1)
  assert.ok(ranked[1].score < 1)
})

test('suggestBestMatch returns the top hit when it is close enough', () => {
  const hits = [media(1, { english: 'Berserk' }), media(2, { english: 'Berserk of Gluttony' })]
  assert.equal(suggestBestMatch('Berserk', hits)?.id, 1)
})

test('suggestBestMatch returns null for an unrelated title', () => {
  assert.equal(suggestBestMatch('Naruto', [media(1, { english: 'Berserk' })]), null)
})

test('suggestBestMatch respects the minimum score', () => {
  const hits = [media(1, { english: 'One Piece Film Red' })]
  assert.equal(suggestBestMatch('One Piece', hits, 0.9), null)
  assert.equal(suggestBestMatch('One Piece', hits, 0.8)?.id, 1)
})

test('localProgressNumber is the highest numbered read chapter', () => {
  assert.equal(localProgressNumber(chapters, ['c1', 'c3']), 3)
})

test('localProgressNumber ignores unread chapters', () => {
  assert.equal(localProgressNumber(chapters, ['c2']), 2)
  assert.equal(localProgressNumber(chapters, []), 0)
})

test('localProgressNumber counts a finished current chapter', () => {
  assert.equal(localProgressNumber(chapters, ['c1'], { url: 'c3', pos: 0.995 }), 3)
  assert.equal(localProgressNumber(chapters, ['c1'], { url: 'c3', pos: 0.5 }), 1)
})

test('localProgressNumber falls back to the read count when titles have no numbers', () => {
  const unnumbered: ChapterRef[] = [
    { title: 'Prologue', url: 'p1' },
    { title: 'Interlude', url: 'p2' },
    { title: 'Epilogue', url: 'p3' }
  ]
  assert.equal(localProgressNumber(unnumbered, ['p1', 'p3']), 2)
})

test('mergeProgressForward adds only chapters at or below the remote progress', () => {
  const r = mergeProgressForward({ chapters, readUrls: ['c1'], remoteProgress: 3 })
  assert.deepEqual(r.addedRead, ['c2', 'c3'])
  assert.deepEqual(r.readUrls, ['c1', 'c2', 'c3'])
  assert.equal(r.movedForward, true)
})

test('mergeProgressForward never removes an already-read later chapter', () => {
  const r = mergeProgressForward({ chapters, readUrls: ['c1', 'c4'], remoteProgress: 2 })
  assert.deepEqual(r.addedRead, ['c2'])
  assert.deepEqual(r.readUrls, ['c1', 'c4', 'c2'])
  assert.ok(r.readUrls.includes('c4'))
})

test('mergeProgressForward does not move the bookmark backward', () => {
  const r = mergeProgressForward({
    chapters,
    readUrls: ['c1', 'c2', 'c3'],
    currentUrl: 'c3',
    currentPos: 0.4,
    remoteProgress: 2
  })
  assert.equal(r.currentUrl, 'c3')
  assert.equal(r.currentPos, 0.4)
  assert.equal(r.movedForward, false)
})

test('mergeProgressForward moves the bookmark forward when the remote is ahead', () => {
  const r = mergeProgressForward({
    chapters,
    readUrls: ['c1'],
    currentUrl: 'c1',
    currentPos: 0.5,
    remoteProgress: 3
  })
  assert.equal(r.currentUrl, 'c3')
  assert.equal(r.currentPos, 0)
  assert.equal(r.movedForward, true)
})

test('mergeProgressForward sets the bookmark when there is none', () => {
  const r = mergeProgressForward({ chapters, readUrls: [], remoteProgress: 2 })
  assert.equal(r.currentUrl, 'c2')
  assert.equal(r.currentPos, 0)
  assert.equal(r.movedForward, true)
})

test('mergeProgressForward is a no-op when the remote is not ahead', () => {
  const r = mergeProgressForward({
    chapters,
    readUrls: ['c1', 'c2'],
    currentUrl: 'c2',
    currentPos: 0.2,
    remoteProgress: 2
  })
  assert.deepEqual(r.addedRead, [])
  assert.deepEqual(r.readUrls, ['c1', 'c2'])
  assert.equal(r.currentUrl, 'c2')
  assert.equal(r.currentPos, 0.2)
  assert.equal(r.movedForward, false)
})

test('mergeProgressForward does nothing for a remote progress of 0', () => {
  const r = mergeProgressForward({
    chapters,
    readUrls: ['c1'],
    currentUrl: 'c1',
    currentPos: 0.1,
    remoteProgress: 0
  })
  assert.deepEqual(r.addedRead, [])
  assert.deepEqual(r.readUrls, ['c1'])
  assert.equal(r.currentUrl, 'c1')
  assert.equal(r.currentPos, 0.1)
  assert.equal(r.movedForward, false)
})

test('mergeProgressForward picks the highest chapter at or below a fractional remote', () => {
  const r = mergeProgressForward({ chapters, readUrls: [], remoteProgress: 2.5 })
  assert.equal(r.currentUrl, 'c2')
  assert.deepEqual(r.addedRead, ['c1', 'c2'])
})

test('a finished latest chapter of a completed series is COMPLETED', () => {
  assert.equal(
    anilistStatusForFinishedChapter({ chapterUrl: 'c4', chapters: newestFirst, seriesStatus: 'completed' }),
    'COMPLETED'
  )
})

test('an ongoing series stays CURRENT even on the latest chapter', () => {
  assert.equal(
    anilistStatusForFinishedChapter({ chapterUrl: 'c4', chapters: newestFirst, seriesStatus: 'ongoing' }),
    'CURRENT'
  )
})

test('a mid-series chapter of a completed series is CURRENT', () => {
  assert.equal(
    anilistStatusForFinishedChapter({ chapterUrl: 'c2', chapters: newestFirst, seriesStatus: 'completed' }),
    'CURRENT'
  )
})

test('the highest-numbered chapter counts as latest even if it is not first', () => {
  const shuffled: ChapterRef[] = [
    { title: 'Chapter 3', url: 'c3' },
    { title: 'Chapter 5', url: 'c5' },
    { title: 'Chapter 4', url: 'c4' }
  ]
  assert.equal(
    anilistStatusForFinishedChapter({ chapterUrl: 'c5', chapters: shuffled, seriesStatus: 'completed' }),
    'COMPLETED'
  )
})

test('progressToSync prefers the chapter title number', () => {
  assert.equal(progressToSync('Chapter 7', newestFirst, 'c2'), 7)
})

test('progressToSync falls back to the matching chapter number', () => {
  assert.equal(progressToSync('Bonus', newestFirst, 'c3'), 3)
})

test('progressToSync falls back to the position in the list', () => {
  const unnumbered: ChapterRef[] = [
    { title: 'Prologue', url: 'p1' },
    { title: 'Interlude', url: 'p2' },
    { title: 'Epilogue', url: 'p3' }
  ]
  assert.equal(progressToSync('Bonus', unnumbered, 'p2'), 2)
})

test('progressToSync returns null when the chapter is unknown and unnumbered', () => {
  assert.equal(progressToSync('Bonus', newestFirst, 'nope'), null)
})

test('enqueueUpdate adds a new item with no attempts', () => {
  const q = enqueueUpdate([], update(1, 5), 1000)
  assert.equal(q.length, 1)
  assert.equal(q[0].mediaId, 1)
  assert.equal(q[0].progress, 5)
  assert.equal(q[0].attempts, 0)
  assert.equal(q[0].nextAttemptAt, 1000)
})

test('enqueueUpdate coalesces the same media to the higher progress', () => {
  const q1 = enqueueUpdate([], update(1, 5), 1000)
  const q2 = enqueueUpdate(q1, update(1, 8), 2000)
  assert.equal(q2.length, 1)
  assert.equal(q2[0].progress, 8)
  assert.equal(q2[0].nextAttemptAt, 2000)
})

test('enqueueUpdate does not regress progress', () => {
  const q1 = enqueueUpdate([], update(1, 8), 1000)
  const q2 = enqueueUpdate(q1, update(1, 3), 2000)
  assert.equal(q2[0].progress, 8)
  assert.equal(q2[0].nextAttemptAt, 1000)
})

test('enqueueUpdate lets COMPLETED win on equal progress', () => {
  const q1 = enqueueUpdate([], update(1, 8, 'CURRENT'), 1000)
  const q2 = enqueueUpdate(q1, update(1, 8, 'COMPLETED'), 2000)
  assert.equal(q2[0].status, 'COMPLETED')
  assert.equal(q2[0].progress, 8)
})

test('enqueueUpdate leaves equal CURRENT progress alone', () => {
  const q1 = enqueueUpdate([], update(1, 5, 'CURRENT'), 1000)
  const q2 = enqueueUpdate(q1, update(1, 5, 'CURRENT'), 2000)
  assert.equal(q2[0].nextAttemptAt, 1000)
  assert.equal(q2[0].status, 'CURRENT')
})

test('enqueueUpdate keeps separate media apart', () => {
  const q = enqueueUpdate(enqueueUpdate([], update(1, 5), 1000), update(2, 3), 1000)
  assert.equal(q.length, 2)
})

test('enqueueUpdate does not mutate the input queue', () => {
  const q1 = enqueueUpdate([], update(1, 5), 1000)
  const before = q1.map((item) => ({ ...item }))
  enqueueUpdate(q1, update(1, 9), 2000)
  assert.deepEqual(q1, before)
})

test('enqueueUpdate resets attempts when progress moves forward', () => {
  const q1 = enqueueUpdate([], update(1, 5), 1000)
  const failed = markAttemptFailure(q1, q1[0].id, 'boom', 1000)
  assert.equal(failed[0].attempts, 1)
  const q2 = enqueueUpdate(failed, update(1, 6), 5000)
  assert.equal(q2[0].attempts, 0)
  assert.equal(q2[0].nextAttemptAt, 5000)
})

test('backoffMs grows and caps at an hour', () => {
  assert.equal(backoffMs(0), 30_000)
  assert.equal(backoffMs(1), 60_000)
  assert.equal(backoffMs(2), 120_000)
  assert.equal(backoffMs(3), 300_000)
  assert.equal(backoffMs(4), 900_000)
  assert.equal(backoffMs(5), 1_800_000)
  assert.equal(backoffMs(6), 3_600_000)
  assert.equal(backoffMs(50), 3_600_000)
})

test('dueUpdates returns the items whose time has come, earliest first', () => {
  const q: QueuedUpdate[] = [
    { id: 'a', mediaId: 1, progress: 1, status: 'CURRENT', seriesUrl: 's1', attempts: 0, nextAttemptAt: 3000 },
    { id: 'b', mediaId: 2, progress: 1, status: 'CURRENT', seriesUrl: 's2', attempts: 0, nextAttemptAt: 1000 },
    { id: 'c', mediaId: 3, progress: 1, status: 'CURRENT', seriesUrl: 's3', attempts: 0, nextAttemptAt: 5000 }
  ]
  assert.deepEqual(dueUpdates(q, 3000).map((item) => item.id), ['b', 'a'])
  assert.deepEqual(dueUpdates(q, 0).map((item) => item.id), [])
})

test('markAttemptFailure increments attempts and schedules a retry', () => {
  const q = enqueueUpdate([], update(1, 5), 1000)
  const failed = markAttemptFailure(q, q[0].id, 'network', 1000)
  assert.equal(failed[0].attempts, 1)
  assert.equal(failed[0].lastError, 'network')
  assert.equal(failed[0].nextAttemptAt, 1000 + 30_000)
  const again = markAttemptFailure(failed, q[0].id, 'network', 31_000)
  assert.equal(again[0].attempts, 2)
  assert.equal(again[0].nextAttemptAt, 31_000 + 60_000)
})

test('markAttemptSuccess removes the item', () => {
  const q = enqueueUpdate([], update(1, 5), 1000)
  assert.deepEqual(markAttemptSuccess(q, q[0].id), [])
  assert.equal(markAttemptSuccess(q, 'missing').length, 1)
})

test('RateLimiter allows 90 requests a minute and makes the 91st wait', () => {
  let now = 0
  const limiter = new RateLimiter(90, () => now)
  for (let i = 0; i < 90; i++) assert.equal(limiter.tryTake(), true)
  assert.equal(limiter.tryTake(), false)
  assert.equal(limiter.waitMs(), 60_000)
  now = 60_000
  assert.equal(limiter.tryTake(), true)
})

test('RateLimiter waitMs shrinks as the window slides', () => {
  let now = 0
  const limiter = new RateLimiter(2, () => now)
  assert.equal(limiter.tryTake(), true)
  now = 10_000
  assert.equal(limiter.tryTake(), true)
  assert.equal(limiter.tryTake(), false)
  assert.equal(limiter.waitMs(), 50_000)
  now = 30_000
  assert.equal(limiter.waitMs(), 30_000)
  now = 60_000
  assert.equal(limiter.waitMs(), 0)
  assert.equal(limiter.tryTake(), true)
})

test('RateLimiter record counts a request without checking', () => {
  let now = 0
  const limiter = new RateLimiter(1, () => now)
  limiter.record()
  assert.equal(limiter.tryTake(), false)
  assert.deepEqual(limiter.recordTimes(), [0])
})


function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Awaited<ReturnType<FetchLike>> {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

test('AniListClient search, viewer, save and progress use the GraphQL endpoint and a bearer token', async () => {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = []
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const q = JSON.parse(init?.body ?? '{}') as { query?: string }
    if (q.query === SEARCH_MEDIA_QUERY) {
      return jsonResponse(200, {
        data: {
          Page: {
            media: [
              {
                id: 11,
                title: { english: 'One Piece', romaji: 'One Piece', native: 'ワンピース', userPreferred: 'One Piece' },
                format: 'MANGA',
                chapters: 1000,
                siteUrl: 'https://anilist.co/manga/11',
                coverImage: { medium: 'https://example.com/op.jpg' }
              }
            ]
          }
        }
      })
    }
    if (q.query === VIEWER_QUERY) {
      return jsonResponse(200, { data: { Viewer: { id: 7, name: 'Nami' } } })
    }
    if (q.query === SAVE_ENTRY_MUTATION) {
      return jsonResponse(200, { data: { SaveMediaListEntry: { id: 99, progress: 12, status: 'CURRENT' } } })
    }
    if (q.query === MEDIA_PROGRESS_QUERY) {
      return jsonResponse(200, {
        data: { Media: { id: 11, chapters: 1000, status: 'RELEASING', mediaListEntry: { progress: 20, status: 'CURRENT' } } }
      })
    }
    return jsonResponse(500, { errors: [{ message: 'unexpected query' }] })
  }
  const client = new AniListClient({
    fetch: fetchLike,
    getToken: () => 'tok-123',
    sleep: async () => undefined,
    now: () => 0,
    limiter: new RateLimiter(90, () => 0)
  })

  const hits = await client.searchMedia('One Piece')
  assert.equal(hits[0]?.id, 11)
  assert.equal(hits[0]?.title.english, 'One Piece')
  const viewer = await client.getViewer()
  assert.deepEqual(viewer, { id: 7, name: 'Nami' })
  const saved = await client.saveMediaListEntry(11, 12, 'CURRENT')
  assert.equal(saved.progress, 12)
  const progress = await client.getMediaProgress(11)
  assert.equal(progress?.progress, 20)

  assert.equal(calls.length, 4)
  for (const c of calls) {
    assert.equal(c.url, 'https://graphql.anilist.co')
    assert.equal(c.init?.headers?.Authorization, 'Bearer tok-123')
    assert.equal(c.init?.method, 'POST')
  }
})

test('AniListClient refuses to call the API without a token', async () => {
  const client = new AniListClient({
    fetch: async () => jsonResponse(200, { data: {} }),
    getToken: () => null,
    sleep: async () => undefined
  })
  await assert.rejects(() => client.getViewer(), /Not connected to AniList/)
})

test('AniListClient retries after a 429 and then succeeds', async () => {
  let n = 0
  const slept: number[] = []
  const fetchLike: FetchLike = async () => {
    n++
    if (n === 1) return jsonResponse(429, {}, { 'retry-after': '2' })
    return jsonResponse(200, { data: { Viewer: { id: 1, name: 'Luffy' } } })
  }
  const client = new AniListClient({
    fetch: fetchLike,
    getToken: () => 'tok',
    sleep: async (ms) => {
      slept.push(ms)
    },
    now: () => 0,
    limiter: new RateLimiter(90, () => 0)
  })
  const viewer = await client.getViewer()
  assert.deepEqual(viewer, { id: 1, name: 'Luffy' })
  assert.equal(n, 2)
  assert.deepEqual(slept, [2000])
})

test('flushQueue sends due items with mock fetch, drops successes, and retries failures', async () => {
  const bodies: unknown[] = []
  const fetchLike: FetchLike = async (_url, init) => {
    const payload = JSON.parse(init?.body ?? '{}') as { variables?: { id?: number } }
    bodies.push(payload)
    if (payload.variables?.id === 2) return jsonResponse(200, { errors: [{ message: 'server busy' }] })
    return jsonResponse(200, {
      data: { SaveMediaListEntry: { id: 50, progress: payload.variables && 0, status: 'CURRENT' } }
    })
  }
  const client = new AniListClient({
    fetch: fetchLike,
    getToken: () => 'tok',
    sleep: async () => undefined,
    now: () => 10_000,
    limiter: new RateLimiter(90, () => 10_000)
  })
  let q: QueuedUpdate[] = []
  q = enqueueUpdate(q, { mediaId: 1, progress: 5, status: 'CURRENT', seriesUrl: 's1' }, 1000)
  q = enqueueUpdate(q, { mediaId: 2, progress: 8, status: 'CURRENT', seriesUrl: 's2' }, 1000)
  q = enqueueUpdate(q, { mediaId: 3, progress: 1, status: 'CURRENT', seriesUrl: 's3' }, 50_000)
  const result = await flushQueue(q, client, 10_000)
  assert.equal(result.sent, 1)
  assert.equal(result.failed, 1)
  assert.equal(result.queue.length, 2)
  const failed = result.queue.find((i) => i.mediaId === 2)
  const later = result.queue.find((i) => i.mediaId === 3)
  assert.ok(failed)
  assert.equal(failed!.attempts, 1)
  assert.equal(failed!.lastError, 'server busy')
  assert.equal(failed!.nextAttemptAt, 10_000 + 30_000)
  assert.ok(later)
  assert.equal(later!.attempts, 0)
})
