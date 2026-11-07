import { useEffect, useRef, useState } from 'react'
import { OpenChapter, OpenSeries, localPage, pageSrc } from '../lib'

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
  const [zoom, setZoom] = useState(() => savedNum('zoom', 400, 2000, 900)) // page width in px when fitting width
  const [index, setIndex] = useState(0)
  const [eager, setEager] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const restoring = useRef(true) // true while we jump back to the saved position: don't overwrite it
  const lastSave = useRef(0)
  const finished = useRef(false)

  useEffect(() => remember('mode', mode), [mode])
  useEffect(() => remember('fit', fit), [fit])
  useEffect(() => remember('dir', dir), [dir])
  useEffect(() => remember('bg', bg), [bg])
  useEffect(() => remember('zoom', zoom), [zoom])

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
      const show = (list: string[], ttl: string): void => {
        const n = list.length
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
      setLoading(false)
      setError(lastError)
      restoring.current = false
    })()
    return () => {
      cancelled = true
    }
  }, [chapter.url])

  // Webtoon mode: save the scroll position (throttled) and mark the chapter read near the end.
  const onScroll = (): void => {
    const el = scroller.current
    if (!el || restoring.current || mode !== 'webtoon' || pages.length === 0) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return
    const f = Math.min(1, el.scrollTop / max)
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
      img.src = pageSrc(pages[i], chapter.referer)
    }
  }, [index, mode, pages, chapter.referer])

  // Turning pages: in right-to-left reading the next page is to the LEFT.
  const nextPage = (): void => (index >= pages.length - 1 ? go(nextCh) : setIndex((i) => i + 1))
  const prevPage = (): void => (index <= 0 ? go(prevCh) : setIndex((i) => i - 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return onBack()
      if (e.key === 'm') setMode((m) => (m === 'webtoon' ? 'paged' : 'webtoon'))
      if (e.key === 'f') setFit((f) => (f === 'width' ? 'height' : 'width'))
      if (e.key === 'd') setDir((d) => (d === 'ltr' ? 'rtl' : 'ltr'))
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(2000, z + 100))
      if (e.key === '-') setZoom((z) => Math.max(400, z - 100))
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
    <div className="readerview">
      <header className="bar">
        <button onClick={onBack}>← Back</button>
        <button onClick={() => go(prevCh)} disabled={!prevCh}>
          ‹ Prev
        </button>
        <span className="count grow">{chapter.title}</span>
        <button onClick={() => go(nextCh)} disabled={!nextCh}>
          Next ›
        </button>
        <button onClick={() => setMode(mode === 'webtoon' ? 'paged' : 'webtoon')}>
          {mode === 'webtoon' ? 'Webtoon' : 'Paged'}
        </button>
        <button onClick={() => setFit(fit === 'width' ? 'height' : 'width')} title="Shortcut: F">
          Fit {fit}
        </button>
        {fit === 'width' && mode === 'webtoon' && (
          <>
            <button onClick={() => setZoom((z) => Math.max(400, z - 100))} title="Smaller pages (-)">
              −
            </button>
            <button onClick={() => setZoom((z) => Math.min(2000, z + 100))} title="Bigger pages (+)">
              +
            </button>
          </>
        )}
        <button onClick={() => setDir(dir === 'ltr' ? 'rtl' : 'ltr')} title="Reading direction. Shortcut: D">
          {dir === 'ltr' ? 'Left → Right' : 'Right → Left'}
        </button>
        <button onClick={() => setBg(bg === 'dark' ? 'black' : bg === 'black' ? 'sepia' : 'dark')} title="Background colour">
          {bg === 'dark' ? 'Dark' : bg === 'black' ? 'Black' : 'Sepia'}
        </button>
        {pages.length > 0 && (
          <span className="count">{mode === 'paged' ? `${index + 1} / ${pages.length}` : `${pages.length} pages`}</span>
        )}
      </header>

      {loading && <div className="hint">Opening chapter and collecting pages…</div>}
      {error && <div className="error">{error}</div>}

      {pages.length > 0 && (
        <div className={`reader bg-${bg}`} ref={scroller} onScroll={onScroll}>
          <div className="title">{title}</div>
          {mode === 'webtoon' ? (
            <>
              {pages.map((p, i) => (
                <img
                  key={p}
                  className={`page fit-${fit}`}
                  style={fit === 'width' ? { width: `min(100%, ${zoom}px)` } : undefined}
                  src={pageSrc(p, chapter.referer)}
                  loading={eager || i < 3 ? 'eager' : 'lazy'}
                />
              ))}
              {nextCh && (
                <button className="nextbig" onClick={() => go(nextCh)}>
                  Next chapter: {nextCh.title} ›
                </button>
              )}
            </>
          ) : (
            <img
              key={pages[index]}
              className={`page fit-${fit}`}
              src={pageSrc(pages[index], chapter.referer)}
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
