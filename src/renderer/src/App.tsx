import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import Browse from './components/Browse'
import Series from './components/Series'
import Reader from './components/Reader'
import Downloads from './components/Downloads'
import Following from './components/Following'
import Sites, { levelOf } from './components/Sites'
import Settings from './components/Settings'
import NewChapters from './components/NewChapters'
import QuickOpen from './components/QuickOpen'
import Stats from './components/Stats'
import type { OpenChapter, OpenSeries } from './lib'
import type { MiniSession, SiteHealth, SourceInfo, UpdateStatus } from '../../preload/index.d'
import logo from './assets/yomi-logo.png'
import { Icon } from './components/Icon'
import { ThemeToggle } from './components/ThemeToggle'

type View =
  | { name: 'browse' }
  | { name: 'added' }
  | { name: 'downloads' }
  | { name: 'following' }
  | { name: 'sites' }
  | { name: 'settings' }
  | { name: 'new' }
  | { name: 'stats' }
  | { name: 'series'; series: OpenSeries; from: Tab }
  | { name: 'reader'; series: OpenSeries; chapter: OpenChapter; from: Tab }

/** The screens in the top bar. A series remembers which one it was opened from, and Back returns there. */
type Tab = 'browse' | 'new' | 'added' | 'following' | 'downloads' | 'sites' | 'settings' | 'stats'
const TAB_LABEL: Record<Tab, string> = { browse: 'Discover', new: 'New', added: 'Added by me', following: 'Following', downloads: 'Downloads', sites: 'Sites', settings: 'Settings', stats: 'Stats' }

/** If a screen ever crashes while drawing, show a message and a way back instead of a blank window. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="hint">
        <p>Something went wrong on this screen: {this.state.error.message}</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload the app
        </button>
      </div>
    )
  }
}

export default function App({ mini = false }: { mini?: boolean } = {}): React.JSX.Element {
  return (
    <Boundary>
      <AppInner mini={mini} />
    </Boundary>
  )
}

function TitleBar(): React.JSX.Element {
  return (
    <div className="titlebar">
      <span>
        Yomi <span className="slash">/</span> <span className="jp">読み</span>
      </span>
      <div className="winctl">
        <button aria-label="Minimize" onClick={() => window.api.windowControl('minimize')}>
          <Icon name="minus" />
        </button>
        <button aria-label="Maximize" onClick={() => window.api.windowControl('maximize')}>
          <Icon name="square" />
        </button>
        <button
          className="close"
          aria-label="Close"
          onClick={() => window.api.windowControl('close')}
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  )
}

function MiniTitleBar({ onReturn }: { onReturn: () => void }): React.JSX.Element {
  const [pinned, setPinned] = useState(true)
  return (
    <div className="minibar">
      <span className="minititle">
        Yomi <span className="slash">/</span> mini
      </span>
      <div className="winctl">
        <button
          className={pinned ? 'on' : ''}
          aria-label={pinned ? 'Unpin from top' : 'Pin on top'}
          title={pinned ? 'Stays above other windows' : 'Pin above other windows'}
          onClick={() => void window.api.miniSetPinned(!pinned).then(setPinned)}
        >
          <Icon name="pin" />
        </button>
        <button aria-label="Open in Yomi" title="Continue in the main window" onClick={onReturn}>
          <Icon name="expand" />
        </button>
        <button aria-label="Minimize" onClick={() => window.api.windowControl('minimize')}>
          <Icon name="minus" />
        </button>
        <button
          className="close"
          aria-label="Close mini reader"
          title="Close the mini reader"
          onClick={() => window.api.windowControl('close')}
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  )
}

function AppInner({ mini }: { mini: boolean }): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'browse' })
  const lastSession = useRef<MiniSession | null>(null)
  // In the mini window, start on the chapter the main window handed over, and follow later hand-overs.
  useEffect(() => {
    if (!mini) return
    let cancelled = false
    void window.api.miniGet().then((s) => {
      if (cancelled || !s) return
      lastSession.current = s
      setView({ name: 'reader', series: s.series, chapter: s.chapter, from: 'browse' })
    })
    const off = window.api.onMiniSession((s) => {
      lastSession.current = s
      setView({ name: 'reader', series: s.series, chapter: s.chapter, from: 'browse' })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [mini])
  // Keep the main window's copy of the session in step with the chapter being read here.
  useEffect(() => {
    if (!mini || view.name !== 'reader') return
    const s = { series: view.series, chapter: view.chapter } as MiniSession
    lastSession.current = s
    void window.api.miniUpdate(s)
  }, [mini, view])
  const returnToMain = async (): Promise<void> => {
    if (lastSession.current) await window.api.miniUpdate(lastSession.current)
    await window.api.miniReturn()
  }
  // the top-bar screen we are on, or the one the open series / chapter was opened from
  const here: Tab = view.name === 'series' || view.name === 'reader' ? view.from : view.name
  // The search box lives in the top bar; Discover (always mounted) does the searching.
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [quick, setQuick] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      // Ctrl+P: Quick Open (jump to a screen or any series)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setQuick((v) => !v)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [addedCount, setAddedCount] = useState(0)
  const [queued, setQueued] = useState(0)
  const [sources, setSources] = useState<SourceInfo[]>([])
  // a newer Yomi has been downloaded in the background: offer to restart into it
  const [update, setUpdate] = useState<{ version: string } | null>(null)
  const [miniOn, setMiniOn] = useState(false)
  useEffect(() => {
    window.api.updateStatus().then(setUpdate)
    return window.api.onUpdateReady(setUpdate)
  }, [])
  useEffect(() => {
    if (mini) return
    void window.api.miniIs().then(setMiniOn)
    const offOpen = window.api.onMiniOpened(() => setMiniOn(true))
    const offClosed = window.api.onMiniClosed(() => setMiniOn(false))
    const offReturn = window.api.onMiniReturn((s) => {
      setMiniOn(false)
      setView({ name: 'reader', series: s.series, chapter: s.chapter, from: 'browse' })
    })
    return () => {
      offOpen()
      offClosed()
      offReturn()
    }
  }, [mini])
  const [health, setHealth] = useState<Record<string, SiteHealth>>({})

  // If the library could not be read from disk (a busy file, a slow start), say so instead of showing an empty app, and
  // keep asking until it can be; then the screen reloads with everything in place. Nothing is ever saved over it meanwhile.
  const [trouble, setTrouble] = useState(false)
  const [why, setWhy] = useState('')
  const [report, setReport] = useState('')
  useEffect(() => {
    let stopped = false
    let wasTrouble = false
    let failures = 0
    let troubleTicks = 0
    const ask = async (): Promise<void> => {
      let t: boolean
      try {
        t = await window.api.catalogTrouble()
        failures = 0
        sessionStorage.removeItem('reloads')
        setWhy('')
      } catch (e) {
        // the answer itself failed (Yomi's other half isn't answering): say exactly what, and after a few tries start the screen over
        t = true
        failures++
        const msg = e instanceof Error ? e.message : String(e)
        setWhy(msg.replace(/^Error invoking remote method '[^']*': /, ''))
        window.api.clientLog('catalogTrouble failed (' + failures + '): ' + msg)
        const reloads = Number(sessionStorage.getItem('reloads') ?? '0')
        if (failures >= 3 && reloads < 3) {
          sessionStorage.setItem('reloads', String(reloads + 1))
          window.location.reload()
          return
        }
      }
      if (stopped) return
      setTrouble(t)
      if (t && !wasTrouble) {
        window.api.clientLog('library not readable at start')
        void window.api.catalogDiagnose().then(
          (d) => {
            setReport(d)
            window.api.clientLog('report: ' + d)
          },
          () => undefined
        )
      }
      if (wasTrouble && !t) {
        window.api.clientLog('library readable again: reloading the screen')
        window.location.reload()
        return
      }
      wasTrouble = t
      troubleTicks = t ? troubleTicks + 1 : 0
      if (troubleTicks === 5) void window.api.restartApp() // 15 s and still nothing: start over once
      window.setTimeout(() => void ask(), t ? 3000 : 20000)
    }
    void ask()
    return () => {
      stopped = true
    }
  }, [])

  // unread new chapters of the series you follow (the badge on New)
  const [newCount, setNewCount] = useState(0)
  useEffect(() => {
    const countNew = (): void =>
      void window.api.followList().then((l) => setNewCount(l.reduce((n, f) => n + f.unread, 0)))
    window.api.updatesStatus().then(setUpd)
    countNew()
    return window.api.onUpdates((s) => {
      setUpd(s)
      countNew()
    })
  }, [])
  useEffect(() => {
    if (view.name === 'browse' || view.name === 'new' || view.name === 'following')
      void window.api.followList().then((l) => setNewCount(l.reduce((n, f) => n + f.unread, 0)))
  }, [view.name])
  useEffect(() => {
    const countQueue = (): void =>
      void window.api
        .downloadList()
        .then((l) =>
          setQueued(l.filter((i) => i.status === 'queued' || i.status === 'downloading').length)
        )
    countQueue()
    let t: number | undefined
    const off = window.api.onDownload(() => {
      window.clearTimeout(t)
      t = window.setTimeout(countQueue, 800)
    })
    return () => {
      off()
      window.clearTimeout(t)
    }
  }, [])
  // counts in the bars are refreshed whenever you move between screens
  useEffect(() => {
    window.api.titleList().then((l) => setAddedCount(l.length))
    // Yomi Library sites hidden in Settings are left out of the bars
    window.api.listSources().then((l) => setSources(l.filter((s) => !s.hidden)))
    window.api
      .siteHealth()
      .then((l) => setHealth(Object.fromEntries(l.map((h) => [h.sourceId, h]))))
  }, [view.name])

  const reading = view.name === 'reader'
  const onBrowse = view.name === 'browse' || view.name === 'added'
  const nav: { id: View['name']; label: string; icon: string; n?: number }[] = [
    { id: 'browse', label: 'Discover', icon: 'home' },
    { id: 'new', label: 'New', icon: 'bell', n: newCount || undefined },
    { id: 'following', label: 'Following', icon: 'bookmark', n: upd?.following },
    { id: 'added', label: 'Added by me', icon: 'library', n: addedCount },
    { id: 'downloads', label: 'Downloads', icon: 'download', n: queued || undefined },
    { id: 'sites', label: 'Sites', icon: 'globe' },
    { id: 'stats', label: 'Stats', icon: 'chart' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ]
  const totalTitles = sources.reduce((n, s) => n + s.count, 0)

  return (
    <div className={mini ? 'miniapp' : 'app'}>
      {mini ? <MiniTitleBar onReturn={() => void returnToMain()} /> : <TitleBar />}
      {trouble && (
        <div className="datatrouble" role="alert">
          <strong>Your library is still loading from disk.</strong> Your sites and progress are safe
          — Yomi can&apos;t read the file this very second and is trying again. Nothing is being
          overwritten.
          {why && <em> ({why})</em>}
          {report && <small className="datareport">{report}</small>}
          <button
            className="mini"
            onClick={() =>
              void window.api.catalogTrouble().then(setTrouble, (e) => setWhy(String(e)))
            }
          >
            Try again now
          </button>
        </div>
      )}
      {!reading && (
        <header className="topbar">
          <button
            className="iconbtn"
            style={{ width: 'auto', padding: 0 }}
            onClick={() => setView({ name: 'browse' })}
            aria-label="Yomi home"
          >
            <img className="logo" src={logo} alt="Yomi" width={90} height={36} />
          </button>
          {!mini && (
            <nav className="nav" aria-label="Main navigation">
              {nav.map((item) => (
                <button
                  key={item.id}
                  className={`navitem${view.name === item.id ? ' on' : ''}`}
                  onClick={() => setView({ name: item.id } as View)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.n ? <span className="n">{item.n}</span> : null}
                </button>
              ))}
            </nav>
          )}
          <label className="searchfield">
            <Icon name="search" />
            <input
              ref={searchRef}
              aria-label="Search catalog"
              placeholder={`Search ${totalTitles.toLocaleString()} titles across all your sites…`}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                // searching from another screen brings you to the results
                if (view.name !== 'browse' && view.name !== 'added') setView({ name: 'browse' })
              }}
              onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            />
            <kbd>Ctrl K</kbd>
          </label>
          <button className="qobtn" onClick={() => setQuick(true)} title="Quick Open: jump to any screen or series (Ctrl+P)">
            <kbd>Ctrl P</kbd>
          </button>
          <ThemeToggle />
        </header>
      )}
      <div className="main">
        {/* Browse stays mounted (hidden) so scroll position, search and results survive opening a series. */}
        <div className="pane" style={{ display: onBrowse ? 'flex' : 'none' }}>
          <Browse
            active={onBrowse}
            shelf={view.name === 'added' ? 'added' : 'all'}
            q={q}
            onRead={(series, chapter) => setView({ name: 'reader', series, chapter, from: here })}
            onOpen={(series) => setView({ name: 'series', series, from: here })}
          />
        </div>
        {view.name === 'following' && (
          <div className="pane">
            <Following
              onBack={() => setView({ name: 'browse' })}
              onOpen={(series) => setView({ name: 'series', series, from: 'following' })}
              onRead={(series, chapter) =>
                setView({ name: 'reader', series, chapter, from: 'following' })
              }
            />
          </div>
        )}
        {view.name === 'sites' && (
          <div className="pane">
            <Sites onBack={() => setView({ name: 'browse' })} />
          </div>
        )}
        {view.name === 'new' && (
          <div className="pane">
            <NewChapters
              onOpen={(series) => setView({ name: 'series', series, from: 'new' })}
              onRead={(series, chapter) =>
                setView({ name: 'reader', series, chapter, from: 'new' })
              }
            />
          </div>
        )}
        {view.name === 'settings' && (
          <div className="pane">
            <Settings />
          </div>
        )}
        {view.name === 'downloads' && (
          <div className="pane">
            <Downloads
              onBack={() => setView({ name: 'browse' })}
              onRead={(series, chapter) =>
                setView({ name: 'reader', series, chapter, from: 'downloads' })
              }
              onOpen={(series) => setView({ name: 'series', series, from: 'downloads' })}
            />
          </div>
        )}
        {view.name === 'stats' && (
          <div className="pane">
            <Stats />
          </div>
        )}
        {view.name === 'series' && (
          <div className="pane">
            <Series
              key={view.series.entries[0]?.url ?? view.series.title}
              series={view.series}
              backLabel={TAB_LABEL[view.from]}
              onBack={() => setView({ name: view.from } as View)}
              onRead={(chapter) => setView({ name: 'reader', series: view.series, chapter, from: view.from })}
              onOpen={(series) => setView({ name: 'series', series, from: view.from })}
            />
          </div>
        )}
        {view.name === 'reader' && (
          <div className="pane">
            <Reader
              chapter={view.chapter}
              series={view.series}
              compact={mini}
              onBack={() => setView({ name: 'series', series: view.series, from: view.from })}
              onNavigate={(chapter) =>
                setView({ name: 'reader', series: view.series, chapter, from: view.from })
              }
            />
          </div>
        )}
      </div>
      {quick && (
        <QuickOpen
          screens={nav.map((n) => ({ id: n.id, label: n.label, icon: n.icon }))}
          sources={sources}
          onClose={() => setQuick(false)}
          onScreen={(id) => setView({ name: id } as View)}
          onSeries={(series) =>
            setView({ name: 'series', series, from: view.name === 'series' || view.name === 'reader' ? view.from : (view.name as Tab) })
          }
        />
      )}
      {update && !reading && !mini && (
        <div className="updatebar" role="status">
          <span>
            <b>Yomi {update.version}</b> is ready. It installs when you close Yomi, or now:
          </span>
          <button className="primary" onClick={() => void window.api.updateInstall()}>
            Restart and update
          </button>
          <button className="secondary" onClick={() => setUpdate(null)}>
            Later
          </button>
        </div>
      )}
      {!reading && !mini && (
        <footer className="statusbar">
          <span>
            <b>{totalTitles.toLocaleString()}</b> titles
          </span>
          <span>{sources.length} sites</span>
          {miniOn && (
            <button
              className="more"
              onClick={() => void window.api.miniFocus()}
              title="The mini reader is open"
            >
              Mini reader
            </button>
          )}
          <span>
            {sources.slice(0, 5).map((s) => {
              const lvl = levelOf(health[s.id])
              return (
                <span key={s.id} className="sdot">
                  <i className={lvl === 'fail' ? 'fail' : lvl === 'warn' ? 'warn' : ''} />
                  {s.name}
                </span>
              )
            })}
            {sources.length > 5 && (
              <button className="more" onClick={() => setView({ name: 'sites' })}>
                + {sources.length - 5} more
              </button>
            )}
          </span>
          <span className="right">
            {upd?.lastChecked ? `Checked for new chapters ${ago(upd.lastChecked)}` : ''}
          </span>
        </footer>
      )}
    </div>
  )
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
