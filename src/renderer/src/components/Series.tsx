import { Tags } from './Tags'
import { Icon } from './Icon'
import { useEffect, useRef, useState } from 'react'
import type { DownloadItem, DownloadRequest, FollowInfo, ProgressRecord, SeriesDetail } from '../../../preload/index.d'
import { OpenChapter, OpenSeries, chapterKey, fallbackCover, pageSrc, coverSrc } from '../lib'

interface Props {
  series: OpenSeries
  onBack: () => void
  /** Name of the screen Back returns to ("Following", "Discover"…). */
  backLabel: string
  onRead: (c: OpenChapter) => void
}

type Ch = SeriesDetail['chapters'][number]

const chapterNumber = (t: string): number => {
  const m = t.match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

export default function Series({ series, onBack, onRead, backLabel }: Props): React.JSX.Element {
  const [entryIdx, setEntryIdx] = useState(0)
  const [entries, setEntries] = useState(series.entries)
  const [switchNote, setSwitchNote] = useState('')
  const [pinReady, setPinReady] = useState(false)
  const forced = useRef(false)
  const switched = useRef(false)
  const [seenTitle, setSeenTitle] = useState(series.title)
  if (seenTitle !== series.title) {
    setSeenTitle(series.title)
    setEntries(series.entries)
    setEntryIdx(0)
    setSwitchNote('')
    setPinReady(false)
  }
  const [detail, setDetail] = useState<SeriesDetail | null>(null)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // progress while the chapter list is collected: when it started, and how many chapters the page says it has
  const [loadStart, setLoadStart] = useState(0)
  const [expected, setExpected] = useState<number | undefined>(undefined)
  const [partial, setPartial] = useState(false)
  // chapters this load has collected so far (the screen may still show a longer saved list meanwhile)
  const [found, setFound] = useState(0)
  // why the latest refresh failed while an older saved list is being shown (empty when it worked)
  const [refreshError, setRefreshError] = useState('')
  // bumped by the buttons to run the loading again; `mode` says how much to re-read
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'auto' | 'check' | 'full'>('auto')
  const reload = (m: 'auto' | 'check' | 'full'): void => {
    setMode(m)
    setAttempt((a) => a + 1)
  }
  const [newestFirst, setNewestFirst] = useState(true)
  const entry = entries[entryIdx] ?? entries[0]
  const [progress, setProgress] = useState<ProgressRecord | null>(null)
  const [dls, setDls] = useState<Record<string, DownloadItem>>({})
  const [follow, setFollowInfo] = useState<FollowInfo | null>(null)

  // Following state + which chapters are new, kept live while the background checker runs.
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.api.followGet(entry.url).then((f) => !cancelled && setFollowInfo(f))
    }
    load()
    const off = window.api.onUpdates(load)
    return () => {
      cancelled = true
      off()
    }
  }, [entry.url])

  const toggleFollow = async (): Promise<void> => {
    await window.api.followSet(
      {
        seriesUrl: entry.url,
        sourceId: entry.sourceId,
        title: series.title,
        cover: series.cover,
        coverReferer: series.coverReferer
      },
      !follow?.following
    )
    setFollowInfo(await window.api.followGet(entry.url))
  }
  const newKeys = new Set((follow?.unreadChapters ?? []).map((c) => chapterKey(c.title)))

  // Reading progress for the selected source (re-read whenever we come back from the reader).
  useEffect(() => {
    let cancelled = false
    window.api.progressGet(entry.url).then((p) => !cancelled && setProgress(p))
    return () => {
      cancelled = true
    }
  }, [entry.url])

  // Download states for this series, kept live while jobs run.
  useEffect(() => {
    let cancelled = false
    window.api.downloadList().then((list) => {
      if (cancelled) return
      setDls(Object.fromEntries(list.filter((i) => i.seriesUrl === entry.url).map((i) => [i.id, i])))
    })
    const off = window.api.onDownload((i) => {
      if (i.seriesUrl !== entry.url) return
      setDls((prev) => {
        const next = { ...prev }
        if (i.status === 'removed') delete next[i.id]
        else next[i.id] = i
        return next
      })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [entry.url])

  useEffect(() => {
    forced.current = false
    switched.current = false
    let cancel = false
    window.api.pinnedSite(series.title).then((id) => {
      if (cancel) return
      if (id) {
        const idx = series.entries.findIndex((e) => e.sourceId === id)
        if (idx >= 0) setEntryIdx(idx)
      }
      setPinReady(true)
    })
    return () => {
      cancel = true
    }
  }, [series.title])

  useEffect(() => {
    if (!pinReady) return
    let cancelled = false
    let gotFresh = false
    let haveCached = false
    let offPartial = (): void => undefined
    const goAlt = async (): Promise<boolean> => {
      if (cancelled || switched.current) return false
      const sites = await window.api.fallbackSites(series.title, [entry.sourceId])
      if (cancelled) return false
      const alt = sites[0]
      if (!alt || alt.url === entry.url) return false
      switched.current = true
      setSwitchNote(`${entry.sourceName} is down. Showing ${alt.sourceName} instead.`)
      const idx = entries.findIndex((e) => e.url === alt.url)
      setEntries((prev) => (prev.some((e) => e.url === alt.url) ? prev : [...prev, alt]))
      setEntryIdx(idx >= 0 ? idx : entries.length)
      return true
    }
    void (async () => {
      const offlineNow = await window.api.offlineGet()
      if (!cancelled && !forced.current && !offlineNow) {
        const state = await window.api.sourceState(entry.sourceId)
        if (cancelled) return
        if ((state.availability === 'down' || state.availability === 'degraded') && (await goAlt()))
          return
      }
      forced.current = false
      if (cancelled) return
      setLoading(true)
      setError('')
      setOffline(false)
      setDetail(null)
      setRefreshing(false)
      setRefreshError('')
      setLoadStart(Date.now())
      setExpected(undefined)
      setPartial(false)
      setFound(0)
      // Show the last known chapter list instantly, then replace it with the fresh one when it arrives.
      window.api.getSeriesCached(entry.url).then((cached) => {
        if (cancelled || gotFresh || !cached) return
        haveCached = true
        setDetail(cached)
        setLoading(false)
        setRefreshing(true)
      })
      // Long lists (sites with a chapter pager) arrive in pieces: show each piece as soon as it's read.
      offPartial = window.api.onSeriesPartial((d) => {
        if (cancelled || gotFresh || d.url !== entry.url) return
        setDetail((prev) => (prev && prev.chapters.length >= d.chapters.length ? prev : d))
        setExpected(d.expected)
        setFound(d.chapters.length)
        setPartial(true)
        setLoading(false)
        setRefreshing(true)
      })
      const res = await window.api.getSeries(entry.sourceId, entry.url, mode)
      if (cancelled) return
      gotFresh = true
      setRefreshing(false)
      setPartial(false)
      setExpected(undefined)
      if (res.ok) {
        setDetail(res.data)
        return setLoading(false)
      }
      const rep = await window.api.sourceFailed(entry.sourceId, res.error)
      if (haveCached) {
        setRefreshError(res.error) // keep showing the saved list, but say why it couldn't be updated
        return
      }
      // Couldn't reach the site: another site with this title, or the chapters saved on this PC.
      const saved = (await window.api.downloadList())
        .filter((i) => i.seriesUrl === entry.url && i.status === 'done')
        .sort((a, b) => chapterNumber(b.chapterTitle) - chapterNumber(a.chapterTitle))
      if (cancelled) return
      if (saved.length === 0 && rep.outOfRotation && (await goAlt())) return
      setLoading(false)
      if (saved.length > 0) {
        setOffline(true)
        setDetail({
          url: entry.url,
          title: series.title,
          cover: series.cover,
          description: '',
          chapters: saved.map((i) => ({ title: i.chapterTitle, url: i.id }))
        })
      } else setError(res.error)
    })()
    return () => {
      cancelled = true
      offPartial()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.sourceId, entry.url, series.title, series.cover, attempt, pinReady])

  const referer = new URL(entry.url).origin + '/'
  const chapters = detail ? (newestFirst ? detail.chapters : [...detail.chapters].reverse()) : []
  const readSet = new Set(progress?.read ?? [])

  const open = (c: Ch): void => {
    if (!detail) return
    onRead({
      url: c.url,
      title: c.title,
      chapters: detail.chapters,
      referer,
      seriesUrl: entry.url,
      sourceId: entry.sourceId
    })
  }

  const request = (c: Ch): DownloadRequest => ({
    chapterUrl: c.url,
    alts: c.alts,
    chapterTitle: c.title,
    seriesUrl: entry.url,
    seriesTitle: series.title,
    sourceId: entry.sourceId,
    referer
  })

  // Oldest first, so the queue fills in reading order.
  const downloadMany = (list: Ch[], label: string): void => {
    const todo = [...list].reverse().filter((c) => !['done', 'queued', 'downloading'].includes(dls[c.url]?.status ?? ''))
    if (todo.length === 0) return
    if (todo.length > 40 && !confirm(`Download ${todo.length} chapters (${label})? This can take a while and use disk space.`)) return
    void window.api.downloadEnqueue(todo.map(request))
  }

  const dlButton = (c: Ch): React.JSX.Element | null => {
    if (offline) return null
    const d = dls[c.url]
    if (!d) return (
      <button className="dl" title="Download for offline" onClick={() => window.api.downloadEnqueue([request(c)])}>
        ⬇
      </button>
    )
    if (d.status === 'done') return (
      <button className="dl done" title="Saved on this PC. Click to delete the download" onClick={() => window.confirm(`Delete the saved copy of "${c.title}" from this PC?`) && window.api.downloadRemove(d.id)}>
        ✓
      </button>
    )
    if (d.status === 'error') return (
      <button className="dl bad" title={`${d.error ?? 'Failed'}. Click to retry`} onClick={() => window.api.downloadEnqueue([request(c)])}>
        ↻
      </button>
    )
    return (
      <button className="dl busy" title="Click to cancel" onClick={() => window.api.downloadCancel(d.id)}>
        {d.status === 'queued' ? '…' : `${d.done}/${d.total || '?'}`}
      </button>
    )
  }

  // "Continue" resumes the last chapter you opened. If you had finished it, go to the next one.
  // The list is stored newest-first, so "next" is the previous index.
  const list = detail?.chapters ?? []
  const lastIdx = progress ? list.findIndex((c) => c.url === progress.chapterUrl) : -1
  let resume: Ch | undefined
  let resumeNote = ''
  if (lastIdx >= 0) {
    const finished = readSet.has(list[lastIdx].url)
    if (finished && lastIdx > 0) {
      resume = list[lastIdx - 1]
      resumeNote = 'next chapter'
    } else if (!finished) {
      resume = list[lastIdx]
      resumeNote = progress && progress.pos > 0.02 ? `${Math.round(progress.pos * 100)}% in` : ''
    }
  }
  const first = list.length > 0 ? list[list.length - 1] : undefined

  // Get the chapter you're most likely to open (the Continue / Start one) ready before you click it:
  // its page list, and its first images into the image cache.
  const prefetched = useRef('')
  const target = resume ?? first
  useEffect(() => {
    if (!target || offline || prefetched.current === target.url) return
    prefetched.current = target.url
    window.api.prefetchChapter(target.url).then((pages) =>
      pages.forEach((p) => {
        const img = new Image()
        img.src = pageSrc(p, referer)
      })
    )
  }, [target?.url, offline, referer])
  const unread = list.filter((c) => !readSet.has(c.url))
  const scrollBox = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(false)
  // Esc, Alt + Left, or the mouse's own Back button = Back (unless you are typing in a box)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Escape' || (e.altKey && e.key === 'ArrowLeft')) onBack()
    }
    const m = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', k)
    window.addEventListener('mouseup', m)
    return () => {
      window.removeEventListener('keydown', k)
      window.removeEventListener('mouseup', m)
    }
  }, [onBack])

  return (
    <div className="series" ref={scrollBox} onScroll={(e) => setPinned(e.currentTarget.scrollTop > 280)}>
      {/* once the header is scrolled away, a slim bar with Back stays at the top */}
      <div className="pinback-wrap">
        <div className={`pinback${pinned ? ' on' : ''}`} aria-hidden={!pinned}>
          <button className="back" onClick={onBack} tabIndex={pinned ? 0 : -1}>
            <Icon name="back" /> Back to {backLabel}
          </button>
          <span className="pintitle">{series.title}</span>
          <button className="secondary" tabIndex={pinned ? 0 : -1} onClick={() => scrollBox.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            ↑ Top
          </button>
        </div>
      </div>
      <div className="head">
        <div className="cover big">
          {(series.cover || detail?.cover) && (
            <img
              src={coverSrc(series.cover || detail!.cover, series.coverReferer)}
              onError={(e) => fallbackCover(e, series.coverFallback || detail?.cover, series.coverReferer)}
            />
          )}
        </div>
        <div className="info">
          <button className="back" onClick={onBack} title="Esc">
            <Icon name="back" /> Back to {backLabel}
          </button>
          <Tags detail={detail} />
          <h2>{series.title}</h2>
          {entries.length > 1 && (
            <div className="srcs">
              Read from:{' '}
              {entries.map((e, i) => (
                <button
                  key={e.url}
                  className={i === entryIdx ? 'on' : ''}
                  onClick={() => {
                    forced.current = true
                    switched.current = false
                    setSwitchNote('')
                    setEntryIdx(i)
                    void window.api.pinSite(series.title, e.sourceId)
                  }}
                >
                  {e.sourceName}
                </button>
              ))}
            </div>
          )}
          {switchNote && <div className="sub">{switchNote}</div>}
          {offline && <p className="desc">Can&apos;t reach the site, so this shows only the chapters saved on this PC.</p>}
          {detail?.description && <p className="desc" dir="auto">{detail.description}</p>}
          {detail && (resume || first) && (
            <div className="resume">
              {resume ? (
                <button className="primary" onClick={() => open(resume!)}>
                  ▶ Continue: {resume.title}
                  {resumeNote && <small> ({resumeNote})</small>}
                </button>
              ) : (
                first && (
                  <button className="primary" onClick={() => open(first)}>
                    ▶ Start: {first.title}
                  </button>
                )
              )}
              {readSet.size > 0 && (
                <span className="count">
                  {[...readSet].filter((u) => list.some((c) => c.url === u)).length} / {list.length} read
                </span>
              )}
            </div>
          )}
          {detail && (
            <div className="resume">
              <button className={`mini big${follow?.following ? ' on' : ''}`} onClick={toggleFollow} title="Follow to be told about new chapters">
                {follow?.following ? '✓ Following' : '☆ Follow'}
              </button>
              {follow && follow.unread > 0 && <span className="count">{follow.unread} new</span>}
            </div>
          )}
          {detail && !offline && list.length > 0 && (
            <div className="resume">
              <button className="mini big" onClick={() => downloadMany(unread, 'unread')}>
                ⬇ Download unread ({unread.length})
              </button>
              <button className="mini big" onClick={() => downloadMany(list, 'all')}>
                ⬇ Download all ({list.length})
              </button>
            </div>
          )}
        </div>
      </div>

      {(loading || (refreshing && partial)) && (
        <ChapterProgress site={entry.sourceName} found={found} expected={expected} since={loadStart} />
      )}
      {error && (
        <div className="error">
          {error}{' '}
          <button className="mini" onClick={() => reload('auto')}>
            Try again
          </button>
        </div>
      )}
      {detail && (
        <>
          <div className="meta">
            {detail.chapters.length} chapters{refreshing && ' · updating…'}{' '}
            <button className="mini" onClick={() => setNewestFirst(!newestFirst)}>
              {newestFirst ? 'newest first' : 'oldest first'}
            </button>
            {!offline && (
              <>
                <button className="mini" disabled={refreshing} onClick={() => reload('check')} title="Look for chapters added since the list was saved">
                  Check for new chapters
                </button>
                <button
                  className="mini"
                  disabled={refreshing}
                  onClick={() => confirm('Read the whole chapter list again? This takes longer and uses more of the site.') && reload('full')}
                  title="Read the complete chapter list again"
                >
                  Reload full list
                </button>
              </>
            )}
          </div>
          {detail.incomplete && !refreshing && (
            <div className="error small">
              This list looks too short for the newest chapter, so some chapters may be missing.{' '}
              <button className="mini" onClick={() => reload('full')}>
                Reload full list
              </button>
            </div>
          )}
          {refreshError && (
            <div className="error small">
              Showing the saved list. Couldn&apos;t check for new chapters: {refreshError}{' '}
              <button className="mini" onClick={() => reload('check')}>
                Try again
              </button>
            </div>
          )}
          {detail.chapters.length === 0 && !refreshing && (
            <div className="hint">
              No chapters found on this page. The site may load them in a way the app can&apos;t see yet.{' '}
              <button className="mini" onClick={() => reload('full')}>
                Try again
              </button>
            </div>
          )}
          <div className="chapters">
            {chapters.map((c) => (
              <div
                key={c.url}
                className={`chapterwrap${readSet.has(c.url) ? ' read' : ''}${progress?.chapterUrl === c.url ? ' current' : ''}`}
              >
                <button className="chapter" onClick={() => open(c)}>
                  {readSet.has(c.url) ? '✓ ' : ''}
                  {c.title}
                  {newKeys.has(chapterKey(c.title)) && !readSet.has(c.url) && <span className="newtag">NEW</span>}
                </button>
                {dlButton(c)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Shows that the chapter list is still being collected, so a long wait never looks like the app is stuck: a bar that
 * fills up when the site says how many chapters there are (otherwise one that keeps moving), how many were found so
 * far, and the time it has taken.
 */
function ChapterProgress({ site, found, expected, since }: { site: string; found: number; expected?: number; since: number }): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.round((now - since) / 1000))
  const time = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`
  const pct = expected && expected > 0 ? Math.min(99, Math.round((found / expected) * 100)) : null
  return (
    <div className="chprog" role="status" aria-live="polite">
      <div className="chprog-top">
        <span>
          {found === 0
            ? `Reading the chapter list from ${site}…`
            : expected
              ? `Loading chapters from ${site}… ${found.toLocaleString()} of ${expected.toLocaleString()}`
              : `Loading chapters from ${site}… ${found.toLocaleString()} found so far`}
        </span>
        <span className="chprog-time">
          {pct !== null ? `${pct}% · ` : ''}
          {time}
        </span>
      </div>
      <div className={`chprog-bar${pct === null ? ' moving' : ''}`}>
        <span style={pct !== null ? { width: `${pct}%` } : undefined} />
      </div>
      {(found > 0 || secs >= 15) && (
        <div className="chprog-note">
          {found > 0 ? 'You can already open the chapters shown below. ' : ''}
          {secs >= 15 ? 'Long series can take a few minutes the first time; after that they open straight away.' : ''}
        </div>
      )}
    </div>
  )
}
