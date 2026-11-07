import { useCallback, useEffect, useRef, useState } from 'react'
import type { CrawlProgress, FollowInfo, ProgressRecord, SearchHit, SourceInfo, UpdateStatus } from '../../../preload/index.d'
import { OpenSeries, fallbackCover, proxied, timeAgo } from '../lib'

const PAGE = 60

interface Props {
  onOpen: (s: OpenSeries) => void
  /** True while this screen is the visible one (it stays mounted behind the reader). */
  active: boolean
  onDownloads: () => void
  onFollowing: () => void
}

export default function Browse({ onOpen, active, onDownloads, onFollowing }: Props): React.JSX.Element {
  const [recent, setRecent] = useState<ProgressRecord[]>([])
  const [follows, setFollows] = useState<FollowInfo[]>([])
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [q, setQ] = useState('')
  const [sourceId, setSourceId] = useState('all')
  const [sort, setSort] = useState<'site' | 'az'>('site')
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [hits, setHits] = useState<SearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [siteUrl, setSiteUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [stage, setStage] = useState('')
  const [addError, setAddError] = useState('')
  const [progress, setProgress] = useState<Record<string, CrawlProgress>>({})
  const asked = useRef(new Set<string>())
  // Resting the mouse on a cover for a moment starts reading that series in the background.
  const hoverTimer = useRef<number | undefined>(undefined)
  const hoverPrefetch = (h: SearchHit): void => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      void window.api.prefetchSeries(h.entries[0].sourceId, h.entries[0].url)
    }, 350)
  }
  const searchRef = useRef<HTMLInputElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  // Every change of query / site / sort starts a new "generation" of the list. Anything that comes back from an
  // older generation is dropped, so rows of the previous site can never end up in front of the new one.
  const gen = useRef(0)
  const resetting = useRef(false) // a brand-new list is still being fetched
  const loadingMore = useRef(false)
  const lastRefresh = useRef(0)

  const refreshSources = useCallback(async () => setSources(await window.api.listSources()), [])

  const runSearch = useCallback(
    async (reset: boolean, offset = 0) => {
      if (reset) {
        gen.current++
        resetting.current = true
      } else if (resetting.current || loadingMore.current) {
        return // "load more" must not start while the new list is loading, or run twice at once
      } else {
        loadingMore.current = true
      }
      const myGen = gen.current
      try {
        const res = await window.api.search(q, sourceId, sort, offset, PAGE)
        if (myGen !== gen.current) return // the list was replaced while we waited
        setTotal(res.total)
        setHits((prev) => (reset ? res.hits : [...prev, ...res.hits]))
      } finally {
        if (myGen === gen.current) resetting.current = false
        if (!reset) loadingMore.current = false
      }
    },
    [q, sourceId, sort]
  )

  useEffect(() => {
    refreshSources()
  }, [refreshSources])

  // Reload "Continue reading" and "New chapters" every time we come back to this screen.
  useEffect(() => {
    if (!active) return
    window.api.progressRecent(12).then(setRecent)
    window.api.followList().then(setFollows)
    window.api.updatesStatus().then(setUpd)
  }, [active])

  // The background checker tells us when it starts, finds something or finishes.
  useEffect(() => {
    return window.api.onUpdates((s) => {
      setUpd(s)
      window.api.followList().then(setFollows)
    })
  }, [])

  const openFollow = (f: FollowInfo): void => {
    const name = sources.find((s) => s.id === f.sourceId)?.name ?? f.sourceId
    onOpen({
      title: f.title,
      cover: f.cover,
      coverReferer: f.coverReferer,
      entries: [{ sourceId: f.sourceId, sourceName: name, url: f.seriesUrl }]
    })
  }
  const withNew = follows.filter((f) => f.unread > 0)

  const openRecent = (r: ProgressRecord): void => {
    const name = sources.find((s) => s.id === r.sourceId)?.name ?? r.sourceId
    onOpen({
      title: r.title,
      cover: r.cover,
      coverReferer: r.coverReferer,
      entries: [{ sourceId: r.sourceId, sourceName: name, url: r.seriesUrl }]
    })
  }

  // Debounced search whenever the query/filters change.
  useEffect(() => {
    const t = setTimeout(() => runSearch(true), 150)
    return () => clearTimeout(t)
  }, [runSearch])

  // Live crawl progress: update counts and re-run the search (throttled) so the grid fills in.
  useEffect(() => {
    return window.api.onProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.sourceId]: p }))
      const now = Date.now()
      if (p.done || now - lastRefresh.current > 2500) {
        lastRefresh.current = now
        refreshSources()
        runSearch(true)
      }
    })
  }, [refreshSources, runSearch])

  // Titles that came from a sitemap only have a URL-derived name and no cover. Ask for the real ones for whatever
  // is on screen (a few at a time), then patch the cards in place.
  useEffect(() => {
    const need = hits
      .filter((h) => h.needsInfo)
      .map((h) => h.entries[0].url)
      .filter((u) => !asked.current.has(u))
      .slice(0, 30)
    if (need.length === 0) return
    need.forEach((u) => asked.current.add(u))
    window.api.enrich(need).then((rows) => {
      if (rows.length === 0) return
      const byUrl = new Map(rows.map((r) => [r.url, r]))
      setHits((prev) =>
        prev.map((h) => {
          const r = byUrl.get(h.entries[0].url)
          return r ? { ...h, title: r.title || h.title, cover: r.cover || h.cover, coverFallback: '', needsInfo: false } : h
        })
      )
    })
  }, [hits])

  // Ctrl+K focuses the search bar.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hits.length < total) runSearch(false, hits.length)
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hits.length, total, runSearch])

  const addSite = async (): Promise<void> => {
    if (!siteUrl.trim()) return
    setAdding(true)
    setAddError('')
    setStage('Starting…')
    const off = window.api.onDetect(setStage)
    const res = await window.api.addSite(siteUrl)
    off()
    setStage('')
    setAdding(false)
    if (!res.ok) return setAddError(res.error)
    setSiteUrl('')
    setSourceId('all')
    refreshSources()
  }

  const removeSite = async (s: SourceInfo): Promise<void> => {
    if (!confirm(`Remove ${s.name} and its ${s.count} saved titles?`)) return
    await window.api.removeSite(s.id)
    if (sourceId === s.id) setSourceId('all')
    refreshSources()
    runSearch(true)
  }

  return (
    <div className="browse">
      <div className="toolbar">
        <input
          ref={searchRef}
          className="search"
          placeholder="Search manga & manhwa across all your sites…  (Ctrl+K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="all">All sites</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'site' | 'az')}>
          <option value="site">Site order</option>
          <option value="az">A – Z</option>
        </select>
        <button onClick={onFollowing}>
          Following{upd && upd.following > 0 ? ` (${upd.following})` : ''}
        </button>
        <button onClick={onDownloads}>Downloads</button>
      </div>

      <div className="sites">
        {sources.map((s) => {
          const p = progress[s.id]
          const busy = s.crawling && !(p && p.done)
          return (
            <span key={s.id} className="chip">
              <b>{s.name}</b> {s.count.toLocaleString()}
              {busy && <em> · scanning page {p?.pages ?? 1}…</em>}
              {p?.done && p.error && <em className="bad"> · {p.error}</em>}
              {busy ? (
                <button className="mini" onClick={() => window.api.cancelCrawl(s.id)}>
                  stop
                </button>
              ) : (
                <>
                  <button className="mini" title="Fetch new titles" onClick={() => window.api.crawl(s.id)}>
                    refresh
                  </button>
                  <button className="mini" title="Remove site" onClick={() => removeSite(s)}>
                    ✕
                  </button>
                </>
              )}
            </span>
          )
        })}
        <span className="add">
          <input
            placeholder="Add a site: paste its URL"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSite()}
          />
          <button onClick={addSite} disabled={adding}>
            {adding ? 'Detecting…' : 'Add site'}
          </button>
        </span>
      </div>
      {addError && <div className="error small">{addError}</div>}
      {adding && stage && <div className="stage">⏳ {stage}</div>}

      {sources.length > 0 && upd && (
        <div className="updbar">
          <span>
            Following {upd.following} series ·{' '}
            {upd.checking ? 'checking for new chapters…' : `checked ${timeAgo(upd.lastChecked)}`}
          </span>
          <button className="mini" disabled={upd.checking} onClick={() => window.api.updatesCheck()}>
            check now
          </button>
          <label className="auto" title="Download new chapters of the series you follow as soon as they appear">
            <input
              type="checkbox"
              checked={upd.autoDownload}
              onChange={(e) => window.api.updatesSetAutoDownload(e.target.checked)}
            />{' '}
            auto-download new chapters
          </label>
        </div>
      )}

      {sources.length === 0 ? (
        <div className="hint">
          Paste a manga site URL above (for example the site&apos;s home page) and I&apos;ll list every series on it.
        </div>
      ) : (
        <>
          {withNew.length > 0 && !q && (
            <section className="continue">
              <div className="meta">New chapters</div>
              <div className="strip">
                {withNew.map((f) => (
                  <div key={f.seriesUrl} className="newcard">
                    <button className="card small" onClick={() => openFollow(f)}>
                      <div className="cover">
                        {f.cover && <img loading="lazy" src={proxied(f.cover, f.coverReferer)} />}
                        <span className="badge">+{f.unread}</span>
                      </div>
                      <div className="name" title={f.title}>
                        {f.title}
                      </div>
                      <div className="from">{f.unreadChapters[0]?.title}</div>
                    </button>
                    <button className="x" title="Dismiss" onClick={() => window.api.followDismiss(f.seriesUrl).then(() => window.api.followList().then(setFollows))}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {recent.length > 0 && !q && (
            <section className="continue">
              <div className="meta">Continue reading</div>
              <div className="strip">
                {recent.map((r) => (
                  <button key={r.seriesUrl} className="card small" onClick={() => openRecent(r)}>
                    <div className="cover">
                      {r.cover && <img loading="lazy" src={proxied(r.cover, r.coverReferer)} />}
                    </div>
                    <div className="name" title={r.title}>
                      {r.title}
                    </div>
                    <div className="from">
                      {r.chapterTitle}
                      {r.pos > 0.02 && !r.read.includes(r.chapterUrl) ? ` · ${Math.round(r.pos * 100)}%` : ''}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="meta">{total.toLocaleString()} titles</div>
          <div className="grid">
            {hits.map((h) => (
              <button
                key={h.key}
                className="card"
                onClick={() => onOpen(h)}
                onMouseEnter={() => hoverPrefetch(h)}
                onMouseLeave={() => window.clearTimeout(hoverTimer.current)}
              >
                <div className="cover">
                  {h.cover ? (
                    <img
                      loading="lazy"
                      src={proxied(h.cover, h.coverReferer)}
                      onError={(e) => fallbackCover(e, h.coverFallback, h.coverReferer)}
                    />
                  ) : (
                    <div className="ph">{h.title.trim().slice(0, 1).toUpperCase()}</div>
                  )}
                </div>
                <div className="name" title={h.title}>
                  {h.title}
                </div>
                <div className="from">{h.entries.map((e) => e.sourceName).join(' · ')}</div>
              </button>
            ))}
          </div>
          <div ref={sentinel} style={{ height: 1 }} />
        </>
      )}
    </div>
  )
}
