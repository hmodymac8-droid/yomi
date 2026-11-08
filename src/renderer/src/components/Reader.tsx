import { useEffect, useRef, useState } from 'react'
import { OpenChapter, OpenSeries, chapterNumber, localPage, pageSrc } from '../lib'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'

// Page width control: 480 to 1100 px in steps of 80 (Ctrl + wheel and the + / - keys use the same steps).
const WMIN = 480
const WMAX = 1100
const WSTEP = 80
const clampW = (n: number): number => Math.max(WMIN, Math.min(WMAX, n))

type Mode = 'webtoon' | 'paged'
type Dir = 'ltr' | 'rtl'
type Bg = 'dark' | 'black' | 'sepia'

// Reader settings are remembered between chapters and launches (per viewer, so plain localStorage is enough).
function saved<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem('reader.' + key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}
function savedNum(key: string, min: number, max: number, fallback: number): number {
  try {
    const raw = localStorage.getItem('reader.' + key)
    const n = Number(raw)
    return raw !== null && Number.isFinite(n) && n >= min && n <= max ? n : fallback
  } catch {
    return fallback
  }
}
function remember(key: string, value: string | number): void {
  try {
    localStorage.setItem('reader.' + key, String(value))
  } catch {
    /* private window or blocked storage: the setting just won't stick */
  }
}

interface Props {
  chapter: OpenChapter
  series: OpenSeries
  onBack: () => void
  onNavigate: (c: OpenChapter) => void
}

export default function Reader({ chapter, series, onBack, onNavigate }: Props): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [pages, setPages] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>(() => saved('mode', ['webtoon', 'paged'] as const, 'webtoon'))
  const [fit, setFit] = useState<'width' | 'height'>(() => saved('fit', ['width', 'height'] as const, 'width'))
  const [dir, setDir] = useState<Dir>(() => saved('dir', ['ltr', 'rtl'] as const, 'ltr'))
  const [bg, setBg] = useState<Bg>(() => saved('bg', ['dark', 'black', 'sepia'] as const, 'dark'))
  const [zoom, setZoom] = useState(() => clampW(savedNum('zoom', 400, 2000, 900))) // page width in px when fitting width
  const [pct, setPct] = useState(0)
  const [menu, setMenu] = useState(false)
  const [index, setIndex] = useState(0)
  const [eager, setEager] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // Pages can come from another site when this one fails (see fromOtherSites): they need that site as Referer.
  const [pageRef, setPageRef] = useState(chapter.referer)
  const [stage, setStage] = useState('')
  const [note, setNote] = useState('')
  // Keep scrolling at the end of a chapter to open the next one (on/off in the reading settings).
  const [autoNext, setAutoNext] = useState(() => saved('autonext', ['on', 'off'] as const, 'on') === 'on')
  const [pull, setPull] = useState(0)
  const pullAcc = useRef(0)
  const bottomSince = useRef(0)
  const pullTimer = useRef<number | undefined>(undefined)

  // The top bar is out of the way while you read: it shows when the mouse goes to the top edge (or when a chapter opens),
  // and hides again by itself after a moment, or at once when you scroll down.
  const [barVisible, setBarVisible] = useState(true)
  const barHover = useRef(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const lastTop = useRef(0)
  const showBar = (): void => {
    setBarVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!barHover.current) setBarVisible(false)
    }, 2200)
  }
  const restoring = useRef(true) // true while we jump back to the saved position: don't overwrite it
  const lastSave = useRef(0)
  const finished = useRef(false)

  useEffect(() => {
    showBar()
    return () => window.clearTimeout(hideTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.url])

  // Ctrl + mouse wheel (or a trackpad pinch) makes the pages smaller or bigger, like a browser would.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clampW(z + (e.deltaY < 0 ? WSTEP : -WSTEP)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => remember('mode', mode), [mode])
  useEffect(() => remember('fit', fit), [fit])
  useEffect(() => remember('dir', dir), [dir])
  useEffect(() => remember('bg', bg), [bg])
  useEffect(() => remember('zoom', zoom), [zoom])
  useEffect(() => remember('autonext', autoNext ? 'on' : 'off'), [autoNext])

  // Saves where you are (pos 0..1) for this series; markRead flags the chapter as finished.
  const persist = (pos: number, markRead = false): void => {
    void window.api.progressSave({
      seriesUrl: chapter.seriesUrl,
      sourceId: chapter.sourceId,
      title: series.title,
      cover: series.cover,
      coverReferer: series.coverReferer,
      chapterUrl: chapter.url,
      chapterTitle: chapter.title,
      pos,
      markRead: markRead ? chapter.url : undefined
    })
  }

  // chapters are listed newest-first on most sites; "next" = the one before it in the list.
  const pos = chapter.chapters.findIndex((c) => c.url === chapter.url)
  const nextCh = pos > 0 ? chapter.chapters[pos - 1] : undefined
  const prevCh = pos >= 0 && pos < chapter.chapters.length - 1 ? chapter.chapters[pos + 1] : undefined
  const go = (c?: { title: string; url: string }): void => {
    if (c) onNavigate({ ...chapter, url: c.url, title: c.title })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPages([])
    setIndex(0)
    setNote('')
    setStage('')
    setPageRef(chapter.referer)
    pullAcc.current = 0
    bottomSince.current = 0
    setPull(0)
    scroller.current?.scrollTo(0, 0)
    // Try the main link first, then any other providers that host the same chapter.
    const cur = chapter.chapters.find((c) => c.url === chapter.url)
    const urls = [chapter.url, ...(cur?.alts ?? [])]
    restoring.current = true
    finished.current = false
    setEager(false)
    ;(async () => {
      // Resume where you stopped if you are reopening the chapter you last read.
      const rec = await window.api.progressGet(chapter.seriesUrl)
      const startPos = rec && rec.chapterUrl === chapter.url && !rec.read.includes(chapter.url) ? rec.pos : 0
      persist(startPos) // registers "last read" right away, before any scrolling
      const show = (list: string[], ttl: string, referer = chapter.referer): void => {
        const n = list.length
        setPageRef(referer)
        setStage('')
        setLoading(false)
        setTitle(ttl)
        setPages(list)
        // Get the neighbouring chapters ready while you read, so Next / Prev open instantly.
        setTimeout(() => {
          if (cancelled) return
          for (const c of [nextCh, prevCh]) {
            if (!c) continue
            window.api.prefetchChapter(c.url).then((first) =>
              first.forEach((p) => {
                const img = new Image() // warms the image cache for the first pages
                img.src = pageSrc(p, chapter.referer)
              })
            )
          }
        }, 600)
        if (startPos > 0.02) {
          setEager(true) // load every page so the scroll height is real before jumping
          setIndex(Math.round(startPos * (n - 1)))
          setTimeout(() => {
            const el = scroller.current
            if (el && !cancelled) el.scrollTop = startPos * (el.scrollHeight - el.clientHeight)
            restoring.current = false
          }, 1800)
        } else {
          restoring.current = false
        }
      }

      // A downloaded chapter opens straight from disk: no network, no browser, works offline.
      const dl = await window.api.downloadGet(chapter.url)
      if (cancelled) return
      if (dl && dl.files.length > 0) {
        show(
          dl.files.map((f) => localPage(dl, f)),
          `${dl.seriesTitle} · ${dl.chapterTitle} (saved)`
        )
        return
      }

      let lastError = 'No manga pages found on that chapter page.'
      for (const u of urls) {
        const res = await window.api.grabChapter(u)
        if (cancelled) return
        if (res.ok && res.data.pages.length > 0) {
          show(res.data.pages, res.data.title)
          return
        }
        if (!res.ok) lastError = res.error
      }
      // This site didn't give the chapter: look for the same chapter (by its number) on your other sites that have
      // this series, and read it from there.
      const here = series.entries.find((e) => e.sourceId === chapter.sourceId)?.sourceName ?? chapter.sourceId
      setStage(`${here} didn't open this chapter. Looking for it on your other sites…`)
      const other = await fromOtherSites(() => cancelled)
      if (cancelled) return
      if (other) {
        show(other.pages, other.title, other.referer)
        setNote(`Opened from ${other.site}, because ${here} didn't load this chapter.`)
        return
      }
      setStage('')
      setLoading(false)
      setError(lastError)
      restoring.current = false
    })()
    return () => {
      cancelled = true
    }
  }, [chapter.url])

  /** The same chapter (same number) on another of your sites that has this series, read from there. */
  async function fromOtherSites(
    stop: () => boolean
  ): Promise<{ pages: string[]; title: string; site: string; referer: string } | null> {
    const num = chapterNumber(chapter.title)
    if (num === null) return null
    const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    let entries = series.entries.filter((e) => e.sourceId !== chapter.sourceId)
    if (entries.length === 0) {
      // opened from Following / Continue reading (one site only): find the other sites by the title
      const r = await window.api.search(series.title, [], 'az', 0, 10)
      const hit = r.hits.find((h) => norm(h.title) === norm(series.title))
      entries = hit ? hit.entries.filter((e) => e.sourceId !== chapter.sourceId) : []
    }
    for (const e of entries.slice(0, 5)) {
      if (stop()) return null
      setStage(`Trying ${e.sourceName}…`)
      const res = await window.api.getSeries(e.sourceId, e.url)
      if (!res.ok) continue
      const c = res.data.chapters.find((x) => chapterNumber(x.title) === num)
      if (!c) continue
      for (const u of [c.url, ...(c.alts ?? [])]) {
        if (stop()) return null
        const g = await window.api.grabChapter(u)
        if (g.ok && g.data.pages.length > 0)
          return { pages: g.data.pages, title: g.data.title, site: e.sourceName, referer: new URL(e.url).origin + '/' }
      }
    }
    return null
  }

  // Mouse wheel past the end of a chapter: keep scrolling and the next chapter opens. A short pause after reaching the
  // end keeps the momentum of getting there from skipping a chapter by accident (like "next page" on Discover).
  const PULL_NEED = 500
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (mode !== 'webtoon' || e.ctrlKey) return
    const el = e.currentTarget
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    if (!autoNext || !nextCh || !atEnd || e.deltaY <= 0) {
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
    setPull(Math.min(1, pullAcc.current / PULL_NEED))
    window.clearTimeout(pullTimer.current)
    pullTimer.current = window.setTimeout(() => {
      pullAcc.current = 0
      setPull(0)
    }, 700)
    if (pullAcc.current >= PULL_NEED) {
      pullAcc.current = 0
      bottomSince.current = 0
      setPull(0)
      go(nextCh)
    }
  }

  // Webtoon mode: save the scroll position (throttled) and mark the chapter read near the end.
  const onScroll = (): void => {
    const el = scroller.current
    if (el) {
      if (el.scrollTop > lastTop.current + 8 && !barHover.current) {
        window.clearTimeout(hideTimer.current)
        setBarVisible(false)
      }
      lastTop.current = el.scrollTop
    }
    if (!el || restoring.current || mode !== 'webtoon' || pages.length === 0) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return
    const f = Math.min(1, el.scrollTop / max)
    root.current?.style.setProperty('--prog', String(f))
    setPct(Math.round(f * 100))
    const now = Date.now()
    if (f > 0.9 && !finished.current) {
      finished.current = true
      lastSave.current = now
      persist(f, true)
    } else if (now - lastSave.current > 1500) {
      lastSave.current = now
      persist(f)
    }
  }

  // Paged mode: save the page you are on; the last page counts as finished.
  useEffect(() => {
    if (mode !== 'paged' || pages.length === 0 || restoring.current) return
    const f = pages.length > 1 ? index / (pages.length - 1) : 1
    const done = index >= pages.length - 1
    if (done) finished.current = true
    persist(f, done)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode, pages.length])

  // Paged mode: load the next few pages (and the previous one) ahead of time so turning a page never waits.
  useEffect(() => {
    if (mode !== 'paged' || pages.length === 0) return
    for (const i of [index + 1, index + 2, index + 3, index - 1]) {
      if (i < 0 || i >= pages.length) continue
      const img = new Image()
      img.src = pageSrc(pages[i], pageRef)
    }
  }, [index, mode, pages, pageRef])

  // Turning pages: in right-to-left reading the next page is to the LEFT.
  const nextPage = (): void => (index >= pages.length - 1 ? go(nextCh) : setIndex((i) => i + 1))
  const prevPage = (): void => (index <= 0 ? go(prevCh) : setIndex((i) => i - 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return onBack()
      if (e.key === 'm') setMode((m) => (m === 'webtoon' ? 'paged' : 'webtoon'))
      if (e.key === 'f') setFit((f) => (f === 'width' ? 'height' : 'width'))
      if (e.key === 'd') setDir((d) => (d === 'ltr' ? 'rtl' : 'ltr'))
      if (e.key === '+' || e.key === '=') setZoom((z) => clampW(z + WSTEP))
      if (e.key === '-') setZoom((z) => clampW(z - WSTEP))
      const forward = dir === 'ltr' ? 'ArrowRight' : 'ArrowLeft'
      const back = dir === 'ltr' ? 'ArrowLeft' : 'ArrowRight'
      if (mode === 'paged') {
        if (e.key === forward || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault()
          nextPage()
        }
        if (e.key === back || e.key === 'PageUp') {
          e.preventDefault()
          prevPage()
        }
      } else {
        // webtoon: the arrows jump chapters (the page scrolls with the mouse wheel, space and Page Up/Down as usual)
        if (e.key === forward) go(nextCh)
        if (e.key === back) go(prevCh)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="readerview"
      ref={root}
      onMouseMove={(e) => {
        if (e.clientY < 60) showBar()
      }}
    >
      <header
        className={`bar${barVisible ? '' : ' hidden'}`}
        onMouseEnter={() => {
          barHover.current = true
          showBar()
        }}
        onMouseLeave={() => {
          barHover.current = false
          showBar() // starts the countdown to hide again
        }}
      >
        <button className="iconbtn round" onClick={onBack} title="Back to the chapter list (Esc)" aria-label="Back">
          <Icon name="back" />
        </button>
        <div className="rtitle">
          <b>{series.title}</b>
          <span>
            {chapter.title} · {series.entries.find((e) => e.sourceId === chapter.sourceId)?.sourceName ?? chapter.sourceId}
          </span>
        </div>
        <span className="grow" />
        <button className="iconbtn" onClick={() => go(prevCh)} disabled={!prevCh} title="Previous chapter" aria-label="Previous chapter">
          <Icon name="left" />
        </button>
        <button className="chpill" onClick={onBack} title="All chapters">
          <Icon name="list" />
          {chapter.title.replace(/^chapter\s*/i, 'Ch. ')}
        </button>
        <button className="iconbtn" onClick={() => go(nextCh)} disabled={!nextCh} title="Next chapter" aria-label="Next chapter">
          <Icon name="right" />
        </button>
        <span className="vdiv" />
        <div className="widthctl" title="Page width (- / + keys, or Ctrl + wheel)">
          <button className="iconbtn" onClick={() => setZoom((z) => clampW(z - WSTEP))} disabled={zoom <= WMIN} aria-label="Narrower pages">
            <Icon name="minus" />
          </button>
          <span>{zoom}px</span>
          <button className="iconbtn" onClick={() => setZoom((z) => clampW(z + WSTEP))} disabled={zoom >= WMAX} aria-label="Wider pages">
            <Icon name="plus" />
          </button>
        </div>
        <button
          className="iconbtn"
          title="Download this chapter"
          aria-label="Download this chapter"
          onClick={() => {
            const cur = chapter.chapters.find((c) => c.url === chapter.url)
            void window.api.downloadEnqueue([
              {
                chapterUrl: chapter.url,
                alts: cur?.alts,
                chapterTitle: chapter.title,
                seriesUrl: chapter.seriesUrl,
                seriesTitle: series.title,
                sourceId: chapter.sourceId,
                referer: chapter.referer
              }
            ])
          }}
        >
          <Icon name="download" />
        </button>
        <button
          className="iconbtn"
          title="Full screen"
          aria-label="Full screen"
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen())}
        >
          <Icon name="expand" />
        </button>
        <div className="rmenu">
          <button className={`iconbtn${menu ? ' on' : ''}`} onClick={() => setMenu((m) => !m)} title="Reading settings" aria-label="Reading settings">
            <Icon name="settings" />
          </button>
          {menu && (
            <div className="rmenupop">
              <button onClick={() => setMode(mode === 'webtoon' ? 'paged' : 'webtoon')} title="Shortcut: M">
                Layout <b>{mode === 'webtoon' ? 'Vertical scroll' : 'One page at a time'}</b>
              </button>
              <button onClick={() => setFit(fit === 'width' ? 'height' : 'width')} title="Shortcut: F">
                Fit <b>{fit === 'width' ? 'Width' : 'Height'}</b>
              </button>
              <button onClick={() => setDir(dir === 'ltr' ? 'rtl' : 'ltr')} title="Shortcut: D">
                Direction <b>{dir === 'ltr' ? 'Left to right' : 'Right to left'}</b>
              </button>
              <button onClick={() => setAutoNext((a) => !a)} title="At the end of a chapter, keep scrolling down to open the next one">
                Scroll on to next chapter <b>{autoNext ? 'On' : 'Off'}</b>
              </button>
              <button onClick={() => setBg(bg === 'dark' ? 'black' : bg === 'black' ? 'sepia' : 'dark')}>
                Background <b>{bg === 'dark' ? 'Theme' : bg === 'black' ? 'Black' : 'Sepia'}</b>
              </button>
              {pages.length > 0 && <div className="sub">{mode === 'paged' ? `Page ${index + 1} of ${pages.length}` : `${pages.length} pages`}</div>}
            </div>
          )}
        </div>
        <ThemeToggle />
      </header>
      <div className="progline">
        <span />
      </div>

      {loading && <div className="hint">{stage || 'Opening chapter and collecting pages…'}</div>}
      {note && <div className="readnote">{note}</div>}
      {error && <div className="error">{error}</div>}

      {pages.length > 0 && mode === 'webtoon' && <div className="readpct">{pct}%</div>}
      {pages.length > 0 && (
        <div className={`reader bg-${bg}`} ref={scroller} onScroll={onScroll} onWheel={onWheel}>
          <div className="title">{title}</div>
          {mode === 'webtoon' ? (
            <>
              {pages.map((p, i) => (
                <img
                  key={p}
                  className={`page fit-${fit}`}
                  style={fit === 'width' ? { width: `min(100%, ${zoom}px)` } : { height: `calc((100vh - 56px) * ${zoom / 900})` }}
                  src={pageSrc(p, pageRef)}
                  loading={eager || i < 3 ? 'eager' : 'lazy'}
                />
              ))}
              <div className="endch">
                <div className="endk">終 · End of {chapter.title}</div>
                <div className="upnext">{nextCh ? `Up next: ${nextCh.title}` : "You're all caught up"}</div>
                <div className="endact">
                  {nextCh && (
                    <button className="primary" onClick={() => go(nextCh)}>
                      Next chapter
                    </button>
                  )}
                  <button className="secondary" onClick={onBack}>
                    All chapters
                  </button>
                </div>
                {nextCh && autoNext && (
                  <div className="hint2 pullhint">
                    or keep scrolling down
                    <span className="pullbar">
                      <span style={{ width: `${pull * 100}%` }} />
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <img
              key={pages[index]}
              className={`page fit-${fit}`}
              style={fit === 'width' ? { width: `min(100%, ${zoom}px)` } : { height: `calc((100vh - 56px) * ${zoom / 900})` }}
              src={pageSrc(pages[index], pageRef)}
              // click the left or right third to turn the page (which side is "next" depends on the direction)
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const x = (e.clientX - r.left) / r.width
                const leftIsNext = dir === 'rtl'
                if (x < 0.33) (leftIsNext ? nextPage : prevPage)()
                else if (x > 0.67) (leftIsNext ? prevPage : nextPage)()
                else nextPage()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
