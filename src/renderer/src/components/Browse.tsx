import { useCallback, useEffect, useRef, useState } from 'react'
import type { CrawlProgress, FollowInfo, ProgressRecord, SearchHit, SourceInfo, UpdateStatus } from '../../../preload/index.d'
import { OpenChapter, OpenSeries, fallbackCover, proxied, timeAgo } from '../lib'
import Featured from './Featured'
import { Icon } from './Icon'

const PAGE = 60

interface Props {
  onOpen: (s: OpenSeries) => void
  /** True while this screen is the visible one (it stays mounted behind the reader). */
  active: boolean
  /** "all" is Discover; "added" shows only the titles you saved by address. */
  shelf: 'all' | 'added'
  /** The search text (the box lives in the top bar). */
  q: string
  onRead: (s: OpenSeries, c: OpenChapter) => void
}

interface AddedTitle {
  sourceId: string
  sourceName: string
  url: string
  title: string
  cover: string
  chapters: number
}

export default function Browse({ onOpen, active, shelf, q, onRead }: Props): React.JSX.Element {
  // The row of site chips takes a lot of room: it can be folded away (and stays that way next time).
  const [sitesOpen, setSitesOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('browse.sitesOpen') === '1'
    } catch {
      return false
    }
  })
  const toggleSites = (): void =>
    setSitesOpen((o) => {
      try {
        localStorage.setItem('browse.sitesOpen', o ? '0' : '1')
      } catch {
        /* the choice just won't stick */
      }
      return !o
    })
  const [recent, setRecent] = useState<ProgressRecord[]>([])
  const [follows, setFollows] = useState<FollowInfo[]>([])
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [added, setAdded] = useState<AddedTitle[]>([])
  // Which sites are searched. null means all of them; otherwise the chosen ones (remembered between launches).
  const [picked, setPicked] = useState<string[] | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('pickedSites') ?? 'null')
      return Array.isArray(v) && v.length > 0 ? (v as string[]) : null
    } catch {
      return null
    }
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const choose = (next: string[] | null): void => {
    setPicked(next)
    try {
      localStorage.setItem('pickedSites', JSON.stringify(next))
    } catch {
      /* not critical */
    }
  }
  const [sort, setSort] = useState<'site' | 'az' | 'za' | 'sites' | 'genre'>(() => {
    try {
      const v = localStorage.getItem('browse.sort')
      return v === 'az' || v === 'za' || v === 'sites' || v === 'genre' ? v : 'site'
    } catch {
      return 'site'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('browse.sort', sort)
    } catch {
      /* not critical */
    }
  }, [sort])
  const [genre, setGenre] = useState('')
  const [genreList, setGenreList] = useState<{ name: string; count: number }[]>([])
  // All / Manga / Manhwa / Manhua: only titles whose type a series page has stated are in the three type tabs
  const [kind, setKind] = useState<'' | 'manga' | 'manhwa' | 'manhua'>('')
  const [counts, setCounts] = useState<{ manga: number; manhwa: number; manhua: number } | null>(null)
  const [sources, setSources] = useState<SourceInfo[]>([])
  // The sites actually searched (a site that was removed can't stay ticked). Empty = all of them.
  const sourceIds = picked ? picked.filter((id) => sources.some((s) => s.id === id)) : []
  const sourceKey = sourceIds.join(',')
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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const gridTop = useRef<HTMLDivElement>(null)
  // Every search is a new "generation". Anything that comes back from an older one is dropped, so rows of the
  // previous site or page can never end up in front of the new ones.
  const gen = useRef(0)
  const lastRefresh = useRef(0)
  const searchDelay = useRef(150) // typing is debounced; clicking a page is immediate

  // Pages: the grid shows PAGE titles at a time.
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(total / PAGE))
  // Scrolling past the end of a page turns to the next one (can be switched off; remembered).
  const [autoNext, setAutoNext] = useState<boolean>(() => {
    try {
      return localStorage.getItem('autoNextPage') !== '0'
    } catch {
      return true
    }
  })
  const [pull, setPull] = useState(0) // 0..1: how far the scroll-past-the-end gesture has got
  const pullAcc = useRef(0)
  const pullTimer = useRef<number | undefined>(undefined)
  const bottomSince = useRef(0)

  const refreshSources = useCallback(async () => setSources(await window.api.listSources()), [])

  const runSearch = useCallback(async () => {
    const myGen = ++gen.current
    let res: Awaited<ReturnType<typeof window.api.search>>
    try {
      res = await window.api.search(q, sourceKey ? sourceKey.split(',') : [], sort, page * PAGE, PAGE, kind || undefined, genre || undefined)
    } catch {
      return // a failed search leaves the grid as it is; the next one tries again
    }
    if (myGen !== gen.current) return // replaced while we waited
    setTotal(res.total)
    setHits(res.hits)
    setCounts(res.counts ?? null)
    setGenreList(res.genres ?? [])
    // the list got shorter (a site was removed, a filter changed): don't sit on a page that no longer exists
    const last = Math.max(0, Math.ceil(res.total / PAGE) - 1)
    if (page > last) setPage(last)
  }, [q, sourceKey, sort, page, kind, genre])

  const goPage = (n: number): void => {
    const target = Math.min(Math.max(0, n), pages - 1)
    if (target === page) return
    searchDelay.current = 0
    setPage(target)
    gridTop.current?.scrollIntoView({ block: 'start' })
  }

  // A new query / site / sort starts again from page 1.
  useEffect(() => {
    setPage(0)
  }, [q, sourceKey, sort, kind, genre])

  // Mouse wheel past the bottom of the page: keep scrolling and the next page opens. A short pause after reaching
  // the bottom keeps the momentum of getting there from flipping the page by accident.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    if (!autoNext || !atBottom || e.deltaY <= 0 || page >= pages - 1) {
      bottomSince.current = 0
      if (pullAcc.current !== 0) {
        pullAcc.current = 0
        setPull(0)
      }
      return
    }
    const now = Date.now()
    if (bottomSince.current === 0) bottomSince.current = now
    if (now - bottomSince.current < 450) return
    pullAcc.current += e.deltaY
    setPull(Math.min(1, pullAcc.current / 500))
    window.clearTimeout(pullTimer.current)
    pullTimer.current = window.setTimeout(() => {
      pullAcc.current = 0
      setPull(0)
    }, 700)
    if (pullAcc.current >= 500) {
      pullAcc.current = 0
      bottomSince.current = 0
      setPull(0)
      goPage(page + 1)
    }
  }

  const setAuto = (on: boolean): void => {
    setAutoNext(on)
    try {
      localStorage.setItem('autoNextPage', on ? '1' : '0')
    } catch {
      /* not critical */
    }
  }

  /** Page bar: « ‹ 1 … 4 5 [6] 7 8 … 120 › » plus a "go to" box. */
  const pager = (): React.JSX.Element | null => {
    if (pages <= 1) return null
    const nums: (number | '…')[] = []
    const want = new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2])
    const sorted = [...want].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b)
    sorted.forEach((n, i) => {
      if (i > 0 && n - sorted[i - 1] > 1) nums.push('…')
      nums.push(n)
    })
    return (
      <div className="pager">
        <button className="pg" disabled={page === 0} onClick={() => goPage(0)} title="First page">
          «
        </button>
        <button className="pg" disabled={page === 0} onClick={() => goPage(page - 1)}>
          ‹ Prev
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`gap${i}`} className="gap">
              …
            </span>
          ) : (
            <button key={n} className={`pg${n === page ? ' on' : ''}`} onClick={() => goPage(n)}>
              {n + 1}
            </button>
          )
        )}
        <button className="pg" disabled={page >= pages - 1} onClick={() => goPage(page + 1)}>
          Next ›
        </button>
        <button className="pg" disabled={page >= pages - 1} onClick={() => goPage(pages - 1)} title="Last page">
          »
        </button>
        <span className="goto">
          go to{' '}
          <input
            type="number"
            min={1}
            max={pages}
            placeholder={String(page + 1)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = Number((e.target as HTMLInputElement).value)
                if (v >= 1) goPage(v - 1)
                ;(e.target as HTMLInputElement).value = ''
              }
            }}
          />{' '}
          of {pages.toLocaleString()}
        </span>
        <label className="auto" title="Keep scrolling past the bottom of a page to open the next one">
          <input type="checkbox" checked={autoNext} onChange={(e) => setAuto(e.target.checked)} /> scroll down for next page
        </label>
      </div>
    )
  }

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
  const [addUrl, setAddUrl] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [addMsg, setAddMsg] = useState('')
  useEffect(() => {
    if (!active) return
    ;(async () => {
      // titles an earlier version kept in the window's own storage move to the app's saved data (once)
      try {
        const old = JSON.parse(localStorage.getItem('addedTitles') ?? '[]')
        if (Array.isArray(old) && old.length > 0) {
          await window.api.titleImport(old)
          localStorage.removeItem('addedTitles')
        }
      } catch {
        /* nothing to move */
      }
      setAdded(await window.api.titleList())
    })()
  }, [active])

  const addTitle = async (andDownload: boolean): Promise<void> => {
    if (!addUrl.trim() || addBusy) return
    setAddBusy(true)
    setAddErr('')
    setAddMsg('')
    try {
      const r = await window.api.titleAdd(addUrl.trim())
      if (!r.ok) {
        setAddErr(r.error)
        return
      }
      const a = r.data
      setAdded(await window.api.titleList())
      setAddUrl('')
      if (andDownload) {
        setAddMsg('Reading the chapter list…')
        const d = await window.api.getSeries(a.sourceId, a.url, 'auto')
        if (!d.ok) {
          setAddErr(d.error)
          setAddMsg('')
          return
        }
        const ref = new URL(a.url).origin + '/'
        window.api.downloadEnqueue(
          d.data.chapters.map((c) => ({
            chapterUrl: c.url,
            alts: c.alts,
            chapterTitle: c.title,
            seriesUrl: a.url,
            seriesTitle: d.data.title || a.title,
            sourceId: a.sourceId,
            referer: ref
          }))
        )
        setAddMsg(`Queued ${d.data.chapters.length} chapters of "${a.title}". Watch them in Downloads.`)
      } else {
        setAddMsg(`${a.already ? 'Updated' : 'Added'} "${a.title}" (${a.chapters} chapters).`)
      }
    } finally {
      setAddBusy(false)
    }
  }

  const removeAddedTitle = async (a: AddedTitle): Promise<void> => {
    if (!window.confirm(`Remove "${a.title}" from "Added by me"?\n\nDownloaded chapters are kept (delete them in Downloads).`)) return
    await window.api.titleRemove(a.url)
    setAdded(await window.api.titleList())
  }

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

  // Search whenever the query / filters / page change (typing is debounced, clicking a page is immediate).
  useEffect(() => {
    const t = setTimeout(() => runSearch(), searchDelay.current)
    searchDelay.current = 150
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
        runSearch()
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
    choose(null) // show everything, so the new site is visible
    refreshSources()
  }

  const removeSite = async (s: SourceInfo): Promise<void> => {
    if (!confirm(`Remove ${s.name} and its ${s.count} saved titles?`)) return
    await window.api.removeSite(s.id)
    if (picked?.includes(s.id)) {
      const rest = picked.filter((id) => id !== s.id)
      choose(rest.length > 0 ? rest : null)
    }
    refreshSources()
    runSearch()
  }

  return (
    <div className="browse" ref={scrollerRef} onWheel={onWheel}>
      {shelf === 'added' ? (
        <div className="pagehead">
          <div>
            <div className="kicker">私の追加</div>
            <h1>Added by me</h1>
            <p>Single titles you saved by pasting their page address.</p>
          </div>
          <div className="pageact">
            <span>
              <b>{added.length}</b> {added.length === 1 ? 'title' : 'titles'}
            </span>
          </div>
        </div>
      ) : (
        <div className="pagehead">
          <div>
            <div className="eyebrow">Your combined catalog</div>
            <h1>Discover</h1>
            <p>One quiet place for every series you follow.</p>
          </div>
          <div className="pageact">
            <span>
              <b>{sources.reduce((n, x) => n + x.count, 0).toLocaleString()}</b> titles · {sources.length} sites
            </span>
          </div>
        </div>
      )}
      {shelf === 'all' && (
      <>
      <div className="addsite">
        <p>
          <b>Add a site</b> — paste any manga site&apos;s address and it joins your catalog.
        </p>
        <span className="add">
          <input
            placeholder="https://"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSite()}
          />
          <button onClick={addSite} disabled={adding}>
            {adding ? 'Detecting…' : '+ Add'}
          </button>
        </span>
      </div>
      <div className="sitesbar">
        <button className="mini big" onClick={toggleSites} title={sitesOpen ? 'Hide the site list' : 'Show the site list'}>
          {sitesOpen || sources.length === 0 ? '▾' : '▸'} {sources.length} {sources.length === 1 ? 'site' : 'sites'}
        </button>
        <span className="sub">
          {sources.reduce((n, x) => n + x.count, 0).toLocaleString()} titles
          {sources.some((x) => x.crawling) && ' · scanning…'}
        </span>
      </div>
      <div className="sites" style={{ display: sitesOpen || sources.length === 0 ? undefined : 'none' }}>
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
      </>
      )}

      {sources.length === 0 ? (
        <div className="hint">
          Paste a manga site URL above (for example the site&apos;s home page) and I&apos;ll list every series on it.
        </div>
      ) : (
        <>
        {shelf === 'added' ? (
          <>
            <div className="invite">
              <div className="kicker" style={{ color: 'var(--primary-text)' }}>
                <Icon name="link" />
              </div>
              <h3>Save a single title</h3>
              <p>Paste the address of a title&apos;s page from any site. It is saved here and opens like any other series.</p>
              <span className="add">
                <input
                  placeholder="https://… the address of one title"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addTitle(false)}
                />
                <button onClick={() => void addTitle(false)} disabled={addBusy || !addUrl.trim()}>
                  {addBusy ? 'Reading…' : 'Add title'}
                </button>
                <button onClick={() => void addTitle(true)} disabled={addBusy || !addUrl.trim()} title="Add it and queue every chapter for download">
                  Add + download all
                </button>
              </span>
            </div>
            {addErr && <div className="error small">{addErr}</div>}
            {addMsg && <div className="stage">{addMsg}</div>}
            {added.length === 0 && <div className="hint">Nothing here yet. Paste the address of one title above and it is saved here.</div>}
            <div className="grid">
              {added
                .filter((a) => !q.trim() || a.title.toLowerCase().includes(q.trim().toLowerCase()))
                .map((a) => (
                  <div key={a.url} className="cwrap">
                  <button
                    className="card"
                    onClick={() =>
                      onOpen({
                        title: a.title,
                        cover: a.cover,
                        coverReferer: new URL(a.url).origin + '/',
                        entries: [{ sourceId: a.sourceId, sourceName: a.sourceName, url: a.url }]
                      })
                    }
                  >
                    <div className="cover">
                      {a.cover ? <img loading="lazy" src={proxied(a.cover, new URL(a.url).origin + '/')} /> : <div className="ph">{a.title.trim().slice(0, 1).toUpperCase()}</div>}
                    </div>
                    <div className="name" title={a.title}>
                      {a.title}
                    </div>
                    <div className="from">{a.sourceName}</div>
                  </button>
                  <button className="cremove" title="Remove from Added by me" onClick={() => void removeAddedTitle(a)}>
                    ×
                  </button>
                  </div>
                ))}
            </div>
          </>
        ) : (
        <>
          {!q && <Featured recent={recent} follows={follows} sources={sources} onOpen={onOpen} onRead={onRead} />}
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
                  <div key={r.seriesUrl} className="cwrap">
                    <button className="card small" onClick={() => openRecent(r)}>
                      <div className="cover">
                        {r.cover && <img loading="lazy" decoding="async" src={proxied(r.cover, r.coverReferer)} />}
                        {r.pos > 0.02 && !r.read.includes(r.chapterUrl) && (
                          <div className="cprog">
                            <span style={{ width: `${Math.round(r.pos * 100)}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="name" title={r.title}>
                        {r.title}
                      </div>
                      <div className="from">
                        {r.chapterTitle}
                        {r.pos > 0.02 && !r.read.includes(r.chapterUrl) ? ` · ${Math.round(r.pos * 100)}%` : ''}
                      </div>
                    </button>
                    <button
                      className="cremove"
                      title="Remove from Continue reading"
                      onClick={() => {
                        setRecent((list) => list.filter((x) => x.seriesUrl !== r.seriesUrl))
                        window.api.progressHide(r.seriesUrl)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="sechead gridtop" ref={gridTop}>
            <div>
              <div className="eyebrow">
                {total.toLocaleString()} titles
                {pages > 1 && ` · page ${(page + 1).toLocaleString()} of ${pages.toLocaleString()}`}
              </div>
              <h2>{q.trim() ? `Results for “${q.trim()}”` : 'All titles'}</h2>
            </div>
            <div className="secact">
              <div className="kindtabs">
                {(['', 'manga', 'manhwa', 'manhua'] as const).map((k) => (
                  <button key={k || 'all'} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} title={k ? `Titles whose page says they are ${k} (more appear as series are opened)` : 'Every title'}>
                    {k ? k.charAt(0).toUpperCase() + k.slice(1) : 'All'}
                    {k && counts ? <span>{counts[k].toLocaleString()}</span> : null}
                  </button>
                ))}
              </div>
              <div className="picker">
                <button className="pickbtn" onClick={() => setPickerOpen((o) => !o)} title="Choose which sites to search">
                  {sourceIds.length === 0 || sourceIds.length === sources.length
                    ? `All sites (${sources.length})`
                    : `${sourceIds.length} of ${sources.length} sites`}{' '}
                  ▾
                </button>
                {pickerOpen && (
                  <>
                    <div className="pickshade" onClick={() => setPickerOpen(false)} />
                    <div className="pickmenu">
                      <div className="pickhead">
                        <button className="mini" onClick={() => choose(null)}>
                          all
                        </button>
                        <span>tick the sites to search</span>
                      </div>
                      {sources.map((s) => {
                        const on = sourceIds.length === 0 || sourceIds.includes(s.id)
                        return (
                          <div key={s.id} className="pickrow">
                            <label>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  // from "all" the first click unticks that one site; always keep at least one ticked
                                  const current = sourceIds.length === 0 ? sources.map((x) => x.id) : sourceIds
                                  const next = on ? current.filter((id) => id !== s.id) : [...current, s.id]
                                  if (next.length === 0) return
                                  choose(next.length === sources.length ? null : next)
                                }}
                              />{' '}
                              {s.name} <em>{s.count.toLocaleString()}</em>
                            </label>
                            <button className="mini" title="Search only this site" onClick={() => { choose([s.id]); setPickerOpen(false) }}>
                              only
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
              <select
                className="genresel"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                title="Genres come from the series pages the app has read so far"
              >
                <option value="">All genres</option>
                {genre && !genreList.some((x) => x.name.toLowerCase() === genre.toLowerCase()) && <option value={genre}>{genre}</option>}
                {genreList.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name} ({x.count.toLocaleString()})
                  </option>
                ))}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as 'site' | 'az' | 'za' | 'sites' | 'genre')}>
                <option value="site">{sourceIds.length === 1 || sources.length === 1 ? 'Site order' : 'Mixed'}</option>
                <option value="sites">On most sites</option>
                <option value="genre">By genre</option>
                <option value="az">A – Z</option>
                <option value="za">Z – A</option>
              </select>
            </div>
          </div>
          {pager()}
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
                      decoding="async"
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
          {pager()}
          {page < pages - 1 && (
            <div className="nextbar">
              <button className="nextpage" onClick={() => goPage(page + 1)}>
                Next page ›
              </button>
              {autoNext && (
                <div className="hint2">
                  or keep scrolling down
                  <span className="pullbar">
                    <span style={{ width: `${pull * 100}%` }} />
                  </span>
                </div>
              )}
            </div>
          )}
        </>
        )}
        </>
      )}
    </div>
  )
}
