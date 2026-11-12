import { useEffect, useRef, useState } from 'react'
import { OpenChapter, OpenSeries, chapterNumber, localPage, pageSrc } from '../lib'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'
import { findBorders, type Insets } from '../pagetools'

// Page width control: 480 to 1100 px in steps of 80 (Ctrl + wheel and the + / - keys use the same steps).
const WMIN = 480
const WMAX = 1100
const WSTEP = 80
const clampW = (n: number): number => Math.max(WMIN, Math.min(WMAX, n))

type Mode = 'webtoon' | 'paged'
type Dir = 'ltr' | 'rtl'
type Bg = 'dark' | 'black' | 'sepia'
type Tone = 'off' | 'warm' | 'dim' | 'gray'
const TONES = ['off', 'warm', 'dim', 'gray'] as const
const TONE_NAMES: Record<Tone, string> = {
  off: 'Original',
  warm: 'Warm (night)',
  dim: 'Dim',
  gray: 'Gray'
}
const TONE_FILTER: Record<Tone, string> = {
  off: '',
  warm: 'sepia(0.35) saturate(1.1) brightness(0.92)',
  dim: 'brightness(0.72)',
  gray: 'grayscale(1)'
}
// Auto-scroll speeds, in pixels per second
// 20 steps from slow (12 px/s) to fast (about 280 px/s), each about a fifth faster than the one before
const SPEEDS = Array.from({ length: 20 }, (_, i) => Math.round(12 * Math.pow(1.18, i)))

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
  const [mode, setMode] = useState<Mode>(() =>
    saved('mode', ['webtoon', 'paged'] as const, 'webtoon')
  )
  const [fit, setFit] = useState<'width' | 'height'>(() =>
    saved('fit', ['width', 'height'] as const, 'width')
  )
  const [dir, setDir] = useState<Dir>(() => saved('dir', ['ltr', 'rtl'] as const, 'ltr'))
  const [bg, setBg] = useState<Bg>(() => saved('bg', ['dark', 'black', 'sepia'] as const, 'dark'))
  const [zoom, setZoom] = useState(() => clampW(savedNum('zoom', 400, 2000, 900))) // page width in px when fitting width
  const [pct, setPct] = useState(0)
  const [menu, setMenu] = useState(false)
  const [index, setIndex] = useState(0)
  const [, setEager] = useState(false) // every page loads eagerly now; kept so resuming still flags it
  const scroller = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // Pages can come from another site when this one fails (see fromOtherSites): they need that site as Referer.
  const [pageRef, setPageRef] = useState(chapter.referer)
  const [stage, setStage] = useState('')
  const [note, setNote] = useState('')
  // Keep scrolling at the end of a chapter to open the next one (on/off in the reading settings).
  const [autoNext, setAutoNext] = useState(
    () => saved('autonext', ['on', 'off'] as const, 'on') === 'on'
  )
  const [pull, setPull] = useState(0)
  const pullAcc = useRef(0)
  const bottomSince = useRef(0)
  const pullTimer = useRef<number | undefined>(undefined)
  // Which pages have arrived ('ok') or failed ('bad'), by page number. A page still on its way shows a loading frame,
  // so the end of the chapter never shows up before its pages do.
  const [pageState, setPageState] = useState<Record<number, 'ok' | 'bad'>>({})
  const [retry, setRetry] = useState<Record<number, number>>({})
  const mark = (i: number, s: 'ok' | 'bad'): void =>
    setPageState((p) => (p[i] === s ? p : { ...p, [i]: s }))
  const retryPage = (i: number): void => {
    setPageState((p) => {
      const n = { ...p }
      delete n[i]
      return n
    })
    setRetry((r) => ({ ...r, [i]: (r[i] ?? 0) + 1 }))
  }
  const loadedN = pages.reduce((n, _, i) => n + (pageState[i] === 'ok' ? 1 : 0), 0)
  const settledN = pages.reduce((n, _, i) => n + (pageState[i] ? 1 : 0), 0)
  const stillLoading = pages.length > 0 && settledN < pages.length
  const failedN = settledN - loadedN

  // ---- page tools (all off until you turn them on in the reading settings) ----
  const [tone, setTone] = useState<Tone>(() => saved('tone', TONES, 'off'))
  const [sharpen, setSharpen] = useState(
    () => saved('sharpen', ['on', 'off'] as const, 'off') === 'on'
  )
  const [autocrop, setAutocrop] = useState(
    () => saved('crop', ['on', 'off'] as const, 'off') === 'on'
  )
  const [crops, setCrops] = useState<Record<number, Insets | null>>({})
  const cropAsked = useRef(new Set<string>())
  const [aspect, setAspect] = useState<Record<number, number>>({}) // height / width of each page, once it has loaded
  useEffect(() => remember('tone', tone), [tone])
  useEffect(() => remember('sharpen', sharpen ? 'on' : 'off'), [sharpen])
  useEffect(() => remember('crop', autocrop ? 'on' : 'off'), [autocrop])
  const pageFilter =
    [TONE_FILTER[tone], sharpen ? 'url(#yomi-sharpen)' : ''].filter(Boolean).join(' ') || 'none'

  // the chapter open right now (a page looked at for an older chapter is not applied to this one)
  const nowRef = useRef({ url: chapter.url })
  useEffect(() => {
    nowRef.current = { url: chapter.url }
  }, [chapter.url])

  // ---- auto-scroll (vertical scroll only; off until you start it) ----
  const [autoRun, setAutoRun] = useState(false)
  const [speed, setSpeed] = useState(() => savedNum('speed20', 0, SPEEDS.length - 1, 8))
  // The auto-scroll control at the bottom: hides by itself (shows when the mouse goes to the bottom edge), always
  // shown, or never shown (the A key and Up / Down arrows still work).
  const [ctlMode, setCtlMode] = useState(() =>
    saved('autoctl', ['auto', 'show', 'hide'] as const, 'auto')
  )
  useEffect(() => remember('autoctl', ctlMode), [ctlMode])
  const [ctlSeen, setCtlSeen] = useState(false)
  const ctlHover = useRef(false)
  const ctlTimer = useRef<number | undefined>(undefined)
  const showCtl = (): void => {
    setCtlSeen(true)
    window.clearTimeout(ctlTimer.current)
    ctlTimer.current = window.setTimeout(() => {
      if (!ctlHover.current) setCtlSeen(false)
    }, 2500)
  }
  useEffect(() => {
    if (autoRun) showCtl()
    return () => window.clearTimeout(ctlTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, speed])
  useEffect(() => remember('speed20', speed), [speed])

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
  const prevCh =
    pos >= 0 && pos < chapter.chapters.length - 1 ? chapter.chapters[pos + 1] : undefined
  const go = (c?: { title: string; url: string }): void => {
    if (c) onNavigate({ ...chapter, url: c.url, title: c.title })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPages([])
    setPageState({})
    setRetry({})
    setCrops({})
    cropAsked.current = new Set()
    setAspect({})
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
    const bare = (u: string): string => {
      try {
        return new URL(u).hostname.replace(/^www\./i, '').toLowerCase()
      } catch {
        return ''
      }
    }
    restoring.current = true
    finished.current = false
    setEager(false)
    ;(async () => {
      // Resume where you stopped if you are reopening the chapter you last read.
      const rec = await window.api.progressGet(chapter.seriesUrl)
      const startPos =
        rec && rec.chapterUrl === chapter.url && !rec.read.includes(chapter.url) ? rec.pos : 0
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
      // A source already out of rotation is not waited on: another copy of the chapter is opened at once.
      const state = await window.api.sourceState(chapter.sourceId)
      let deadHost =
        state.availability === 'down' || state.availability === 'degraded' ? bare(state.baseUrl) : ''
      if (deadHost) setStage(`${state.name} is down. Looking for another copy…`)
      for (const u of urls) {
        if (deadHost && bare(u) === deadHost) continue
        const res = await window.api.grabChapter(u)
        if (cancelled) return
        if (res.ok && res.data.pages.length > 0) {
          show(res.data.pages, res.data.title)
          return
        }
        if (!res.ok) {
          lastError = res.error
          const rep = await window.api.sourceFailed(chapter.sourceId, res.error)
          if (rep.outOfRotation) deadHost = bare(state.baseUrl) || bare(u)
        }
      }
      // This site didn't give the chapter: look for the same chapter (by its number) on your other sites that have
      // this series, and read it from there.
      const here = state.name || chapter.sourceId
      setStage(`${here} didn't open this chapter. Looking for it on your other sites…`)
      const other = await fromOtherSites(() => cancelled)
      if (cancelled) return
      if (other) {
        show(other.pages, other.title, other.referer)
        setNote(`Opened from ${other.site} — ${here} didn't load this chapter.`)
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
    // Pin, then last read, then the fastest healthy site. Comix and sites already down are left out.
    let entries = await window.api.fallbackSites(series.title, [chapter.sourceId])
    if (entries.length === 0) {
      entries = series.entries.filter((e) => e.sourceId !== chapter.sourceId).slice(0, 5)
    }
    for (const e of entries) {
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
          return {
            pages: g.data.pages,
            title: g.data.title,
            site: e.sourceName,
            referer: new URL(e.url).origin + '/'
          }
      }
    }
    return null
  }

  // Mouse wheel past the end of a chapter: keep scrolling and the next chapter opens. A short pause after reaching the
  // end keeps the momentum of getting there from skipping a chapter by accident (like "next page" on Discover).
  const PULL_NEED = 180 // about two notches of a mouse wheel
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (mode !== 'webtoon' || e.ctrlKey) return
    const el = e.currentTarget
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    // while pages are still arriving, scrolling on never skips to the next chapter
    if (!autoNext || !nextCh || !atEnd || e.deltaY <= 0 || stillLoading) {
      bottomSince.current = 0
      if (pullAcc.current !== 0) {
        pullAcc.current = 0
        setPull(0)
      }
      return
    }
    const now = Date.now()
    if (bottomSince.current === 0) bottomSince.current = now
    if (now - bottomSince.current < 300) return
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

  // Cut white borders: each page is looked at once it has loaded.
  useEffect(() => {
    if (!autocrop) return
    pages.forEach((p, i) => {
      const src = pageSrc(p, pageRef)
      if (pageState[i] !== 'ok' || cropAsked.current.has(src)) return
      cropAsked.current.add(src)
      const url = chapter.url
      void findBorders(src).then((c) => {
        if (nowRef.current.url === url) setCrops((m) => ({ ...m, [i]: c }))
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autocrop, pageState, pages, pageRef])

  // Auto-scroll: moves the page down at your speed, waits at a page that is still loading, and at the end of the
  // chapter goes on to the next one (if "Scroll on to next chapter" is on), otherwise it stops.
  useEffect(() => {
    if (!autoRun || mode !== 'webtoon' || pages.length === 0 || loading) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    let endSince = 0
    const tick = (now: number): void => {
      const el = scroller.current
      const dt = Math.min(100, now - last)
      last = now
      if (el) {
        const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
        if (atEnd) {
          if (!endSince) endSince = now
          if (now - endSince > 1500 && !stillLoading) {
            if (autoNext && nextCh) go(nextCh)
            else setAutoRun(false)
            return
          }
        } else {
          endSince = 0
          const wait = el.querySelector('.page.waiting')
          const blocked =
            !!wait && wait.getBoundingClientRect().top < el.getBoundingClientRect().bottom - 60
          if (!blocked) {
            acc += (SPEEDS[speed] * dt) / 1000
            const px = Math.floor(acc)
            if (px > 0) {
              acc -= px
              el.scrollTop += px
            }
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, mode, pages.length, loading, speed, autoNext, nextCh, stillLoading])

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
      if (e.key === 'a' && mode === 'webtoon') setAutoRun((r) => !r)
      if (autoRun && mode === 'webtoon' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        setSpeed((v) =>
          Math.max(0, Math.min(SPEEDS.length - 1, v + (e.key === 'ArrowUp' ? 1 : -1)))
        )
        return
      }
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

  // One page: its picture (with the optional border cut) and its loading frame.
  // In vertical scroll only the side borders are cut, so the gaps between panels stay as the artist made them.
  function renderPage(p: string, i: number, paged: boolean): React.JSX.Element {
    const st = pageState[i]
    const raw = autocrop ? (crops[i] ?? null) : null
    const crop = raw && !paged ? (raw.l + raw.r > 0 ? { ...raw, t: 0, b: 0 } : null) : raw
    const ar = aspect[i]
    const arShown = ar && crop ? (ar * (1 - crop.t - crop.b)) / (1 - crop.l - crop.r) : ar
    const h = `calc((100vh - 56px) * ${zoom / 900})`
    const innerStyle: React.CSSProperties =
      fit === 'width'
        ? { width: `min(100%, ${zoom}px)` }
        : arShown
          ? { width: `calc(${h} / ${arShown})` }
          : {}
    const sized = fit === 'width' || !!arShown
    const imgStyle = {
      ...(fit === 'width' ? { width: '100%' } : { height: h }),
      ...(crop
        ? {
            objectViewBox: `inset(${crop.t * 100}% ${crop.r * 100}% ${crop.b * 100}% ${crop.l * 100}%)`
          }
        : {})
    } as React.CSSProperties
    return (
      <div className="pagebox" key={p + '#' + (retry[i] ?? 0)}>
        <div
          className={`pageinner${sized ? ' sized' : ''}`}
          style={innerStyle}
          onClick={
            paged
              ? (e) => {
                  // click the left or right third to turn the page (which side is "next" depends on the direction)
                  if ((e.target as HTMLElement).closest('button')) return
                  const r = e.currentTarget.getBoundingClientRect()
                  const x = (e.clientX - r.left) / r.width
                  const leftIsNext = dir === 'rtl'
                  if (x < 0.33) (leftIsNext ? nextPage : prevPage)()
                  else if (x > 0.67) (leftIsNext ? prevPage : nextPage)()
                  else nextPage()
                }
              : undefined
          }
        >
          <img
            className={`page fit-${fit}${st === 'ok' ? '' : ' waiting'}`}
            style={imgStyle}
            src={pageSrc(p, pageRef)}
            // every page starts loading at once (in order), so they are ready by the time you scroll to them
            loading="eager"
            ref={(el) => {
              if (el && !st && el.complete && el.naturalWidth > 0) {
                setAspect((m) => ({ ...m, [i]: el.naturalHeight / el.naturalWidth }))
                mark(i, 'ok') // came from the cache
              }
            }}
            onLoad={(e) => {
              const im = e.currentTarget
              if (im.naturalWidth > 0)
                setAspect((m) => ({ ...m, [i]: im.naturalHeight / im.naturalWidth }))
              mark(i, 'ok')
            }}
            onError={() => mark(i, 'bad')}
          />
          {st !== 'ok' && (
            <PageWait n={i + 1} of={pages.length} bad={st === 'bad'} onRetry={() => retryPage(i)} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="readerview"
      ref={root}
      onMouseMove={(e) => {
        if (e.clientY < 60) showBar()
        if (autoRun && e.clientY > window.innerHeight - 110) showCtl()
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
        <button
          className="iconbtn round"
          onClick={onBack}
          title="Back to the chapter list (Esc)"
          aria-label="Back"
        >
          <Icon name="back" />
        </button>
        <div className="rtitle">
          <b>{series.title}</b>
          <span>
            {chapter.title} ·{' '}
            {series.entries.find((e) => e.sourceId === chapter.sourceId)?.sourceName ??
              chapter.sourceId}
          </span>
        </div>
        <span className="grow" />
        <button
          className="iconbtn"
          onClick={() => go(prevCh)}
          disabled={!prevCh}
          title="Previous chapter"
          aria-label="Previous chapter"
        >
          <Icon name="left" />
        </button>
        <button className="chpill" onClick={onBack} title="All chapters">
          <Icon name="list" />
          {chapter.title.replace(/^chapter\s*/i, 'Ch. ')}
        </button>
        <button
          className="iconbtn"
          onClick={() => go(nextCh)}
          disabled={!nextCh}
          title="Next chapter"
          aria-label="Next chapter"
        >
          <Icon name="right" />
        </button>
        <span className="vdiv" />
        <div className="widthctl" title="Page width (- / + keys, or Ctrl + wheel)">
          <button
            className="iconbtn"
            onClick={() => setZoom((z) => clampW(z - WSTEP))}
            disabled={zoom <= WMIN}
            aria-label="Narrower pages"
          >
            <Icon name="minus" />
          </button>
          <span>{zoom}px</span>
          <button
            className="iconbtn"
            onClick={() => setZoom((z) => clampW(z + WSTEP))}
            disabled={zoom >= WMAX}
            aria-label="Wider pages"
          >
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
          onClick={() =>
            document.fullscreenElement
              ? void document.exitFullscreen()
              : void document.documentElement.requestFullscreen()
          }
        >
          <Icon name="expand" />
        </button>
        <div className="rmenu">
          <button
            className={`iconbtn${menu ? ' on' : ''}`}
            onClick={() => setMenu((m) => !m)}
            title="Reading settings"
            aria-label="Reading settings"
          >
            <Icon name="settings" />
          </button>
          {menu && (
            <div className="rmenupop">
              <button
                onClick={() => setMode(mode === 'webtoon' ? 'paged' : 'webtoon')}
                title="Shortcut: M"
              >
                Layout <b>{mode === 'webtoon' ? 'Vertical scroll' : 'One page at a time'}</b>
              </button>
              <button
                onClick={() => setFit(fit === 'width' ? 'height' : 'width')}
                title="Shortcut: F"
              >
                Fit <b>{fit === 'width' ? 'Width' : 'Height'}</b>
              </button>
              <button onClick={() => setDir(dir === 'ltr' ? 'rtl' : 'ltr')} title="Shortcut: D">
                Direction <b>{dir === 'ltr' ? 'Left to right' : 'Right to left'}</b>
              </button>
              <button
                onClick={() => setAutoNext((a) => !a)}
                title="At the end of a chapter, keep scrolling down to open the next one"
              >
                Scroll on to next chapter <b>{autoNext ? 'On' : 'Off'}</b>
              </button>
              <button
                onClick={() => setBg(bg === 'dark' ? 'black' : bg === 'black' ? 'sepia' : 'dark')}
              >
                Background <b>{bg === 'dark' ? 'Theme' : bg === 'black' ? 'Black' : 'Sepia'}</b>
              </button>
              <div className="sub">Extras (all optional)</div>
              <button
                onClick={() => setAutoRun((r) => !r)}
                disabled={mode !== 'webtoon'}
                title={
                  mode === 'webtoon'
                    ? 'Shortcut: A · Up / Down arrows change the speed'
                    : 'Works in vertical scroll'
                }
              >
                Auto-scroll <b>{autoRun ? 'On' : 'Off'}</b>
              </button>
              <button
                onClick={() =>
                  setCtlMode(ctlMode === 'auto' ? 'show' : ctlMode === 'show' ? 'hide' : 'auto')
                }
                title="The speed control at the bottom while auto-scrolling"
              >
                Auto-scroll controls{' '}
                <b>
                  {ctlMode === 'auto'
                    ? 'Hide by themselves'
                    : ctlMode === 'show'
                      ? 'Always show'
                      : 'Never show'}
                </b>
              </button>
              <button onClick={() => setTone(TONES[(TONES.indexOf(tone) + 1) % TONES.length])}>
                Page colour <b>{TONE_NAMES[tone]}</b>
              </button>
              <button
                onClick={() => setSharpen((v) => !v)}
                title="Makes blurry, low-quality pages crisper"
              >
                Sharpen <b>{sharpen ? 'On' : 'Off'}</b>
              </button>
              <button
                onClick={() => setAutocrop((v) => !v)}
                title="Cuts the plain white or black margins around pages"
              >
                Cut white borders <b>{autocrop ? 'On' : 'Off'}</b>
              </button>
              {pages.length > 0 && (
                <div className="sub">
                  {mode === 'paged'
                    ? `Page ${index + 1} of ${pages.length}`
                    : `${pages.length} pages`}
                </div>
              )}
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

      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="yomi-sharpen">
          <feConvolveMatrix
            order="3"
            kernelMatrix="0 -0.5 0 -0.5 3 -0.5 0 -0.5 0"
            preserveAlpha="true"
          />
        </filter>
      </svg>
      {autoRun && mode === 'webtoon' && pages.length > 0 && (
        <div
          className={`autoscroll${ctlMode === 'show' || (ctlMode === 'auto' && ctlSeen) ? '' : ' hidden'}`}
          role="group"
          aria-label="Auto-scroll"
          onMouseEnter={() => {
            ctlHover.current = true
            showCtl()
          }}
          onMouseLeave={() => {
            ctlHover.current = false
            showCtl()
          }}
        >
          <span className="spin slow" />
          Auto-scroll
          <button
            className="iconbtn"
            onClick={() => setSpeed((v) => Math.max(0, v - 1))}
            disabled={speed === 0}
            aria-label="Slower"
          >
            <Icon name="minus" />
          </button>
          <input
            type="range"
            className="speedbar"
            min={0}
            max={SPEEDS.length - 1}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label="Auto-scroll speed"
            title="Drag to set the speed (or use the Up / Down arrows)"
          />
          <b className="speednum">{speed + 1}</b>
          <button
            className="iconbtn"
            onClick={() => setSpeed((v) => Math.min(SPEEDS.length - 1, v + 1))}
            disabled={speed === SPEEDS.length - 1}
            aria-label="Faster"
          >
            <Icon name="plus" />
          </button>
          <button className="secondary" onClick={() => setAutoRun(false)} title="Shortcut: A">
            Stop
          </button>
        </div>
      )}
      {pages.length > 0 && mode === 'webtoon' && (
        <div className="readpct">
          {stillLoading && (
            <span className="loadingpages" title="Pages still downloading">
              <span className="spin" />
              {settledN}/{pages.length} pages ·{' '}
            </span>
          )}
          {pct}%
        </div>
      )}
      {pages.length > 0 && (
        <div
          className={`reader bg-${bg}`}
          ref={scroller}
          onScroll={onScroll}
          onWheel={onWheel}
          style={{ '--pagefilter': pageFilter } as React.CSSProperties}
        >
          <div className="title">{title}</div>
          {mode === 'webtoon' ? (
            <>
              {pages.map((p, i) => renderPage(p, i, false))}
              <div className="endch">
                {stillLoading ? (
                  <div className="pagesleft">
                    <span className="spin" />
                    Pages are still loading · {settledN} of {pages.length}
                    <span className="pullbar">
                      <span style={{ width: `${(settledN / pages.length) * 100}%` }} />
                    </span>
                  </div>
                ) : (
                  failedN > 0 && (
                    <div className="pagesleft bad">
                      {failedN === 1 ? '1 page' : `${failedN} pages`} didn&apos;t load. Scroll up
                      and press Try again on it.
                    </div>
                  )
                )}
                <div className="endk">終 · End of {chapter.title}</div>
                <div className="upnext">
                  {nextCh ? `Up next: ${nextCh.title}` : "You're all caught up"}
                </div>
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
                {nextCh && autoNext && !stillLoading && (
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
            renderPage(pages[index], index, true)
          )}
        </div>
      )}
    </div>
  )
}

/** Shown over a page that hasn't arrived yet (a spinner), or that failed to load (with Try again). */
function PageWait({
  n,
  of,
  bad,
  onRetry
}: {
  n: number
  of: number
  bad: boolean
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className={`pagewait${bad ? ' bad' : ''}`}>
      {bad ? (
        <>
          <span>Page {n} didn&apos;t load</span>
          <button className="secondary" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : (
        <>
          <span className="spin" />
          <span>
            Loading page {n} of {of}…
          </span>
        </>
      )}
    </div>
  )
}
