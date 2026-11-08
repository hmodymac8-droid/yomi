import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import Browse from './components/Browse'
import Series from './components/Series'
import Reader from './components/Reader'
import Downloads from './components/Downloads'
import Following from './components/Following'
import Sites, { levelOf } from './components/Sites'
import Settings from './components/Settings'
import NewChapters from './components/NewChapters'
import type { OpenChapter, OpenSeries } from './lib'
import type { SiteHealth, SourceInfo, UpdateStatus } from '../../preload/index.d'
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
  | { name: 'series'; series: OpenSeries; from: Tab }
  | { name: 'reader'; series: OpenSeries; chapter: OpenChapter; from: Tab }

/** The screens in the top bar. A series remembers which one it was opened from, and Back returns there. */
type Tab = 'browse' | 'new' | 'added' | 'following' | 'downloads' | 'sites' | 'settings'
const TAB_LABEL: Record<Tab, string> = { browse: 'Discover', new: 'New', added: 'Added by me', following: 'Following', downloads: 'Downloads', sites: 'Sites', settings: 'Settings' }

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

export default function App(): React.JSX.Element {
  return (
    <Boundary>
      <AppInner />
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
        <button className="close" aria-label="Close" onClick={() => window.api.windowControl('close')}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  )
}

function AppInner(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'browse' })
  // the top-bar screen we are on, or the one the open series / chapter was opened from
  const here: Tab = view.name === 'series' || view.name === 'reader' ? view.from : view.name
  // The search box lives in the top bar; Discover (always mounted) does the searching.
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
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
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [addedCount, setAddedCount] = useState(0)
  const [queued, setQueued] = useState(0)
  const [sources, setSources] = useState<SourceInfo[]>([])
  // a newer Yomi has been downloaded in the background: offer to restart into it
  const [update, setUpdate] = useState<{ version: string } | null>(null)
  useEffect(() => {
    window.api.updateStatus().then(setUpdate)
    return window.api.onUpdateReady(setUpdate)
  }, [])
  const [health, setHealth] = useState<Record<string, SiteHealth>>({})

  // unread new chapters of the series you follow (the badge on New)
  const [newCount, setNewCount] = useState(0)
  useEffect(() => {
    const countNew = (): void => void window.api.followList().then((l) => setNewCount(l.reduce((n, f) => n + f.unread, 0)))
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
      void window.api.downloadList().then((l) => setQueued(l.filter((i) => i.status === 'queued' || i.status === 'downloading').length))
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
    window.api.siteHealth().then((l) => setHealth(Object.fromEntries(l.map((h) => [h.sourceId, h]))))
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
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ]
  const totalTitles = sources.reduce((n, s) => n + s.count, 0)

  return (
    <div className="app">
      <TitleBar />
      {!reading && (
        <header className="topbar">
          <button className="iconbtn" style={{ width: 'auto', padding: 0 }} onClick={() => setView({ name: 'browse' })} aria-label="Yomi home">
            <img className="logo" src={logo} alt="Yomi" width={90} height={36} />
          </button>
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
              onRead={(series, chapter) => setView({ name: 'reader', series, chapter, from: 'following' })}
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
              onRead={(series, chapter) => setView({ name: 'reader', series, chapter, from: 'new' })}
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
            <Downloads onBack={() => setView({ name: 'browse' })} />
          </div>
        )}
        {view.name === 'series' && (
          <div className="pane">
            <Series
              series={view.series}
              backLabel={TAB_LABEL[view.from]}
              onBack={() => setView({ name: view.from } as View)}
              onRead={(chapter) => setView({ name: 'reader', series: view.series, chapter, from: view.from })}
            />
          </div>
        )}
        {view.name === 'reader' && (
          <div className="pane">
            <Reader
              chapter={view.chapter}
              series={view.series}
              onBack={() => setView({ name: 'series', series: view.series, from: view.from })}
              onNavigate={(chapter) => setView({ name: 'reader', series: view.series, chapter, from: view.from })}
            />
          </div>
        )}
      </div>
      {update && !reading && (
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
      {!reading && (
        <footer className="statusbar">
          <span>
            <b>{totalTitles.toLocaleString()}</b> titles
          </span>
          <span>{sources.length} sites</span>
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
          <span className="right">{upd?.lastChecked ? `Checked for new chapters ${ago(upd.lastChecked)}` : ''}</span>
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
