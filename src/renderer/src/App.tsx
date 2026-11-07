import { Component, useState, type ReactNode } from 'react'
import Browse from './components/Browse'
import Series from './components/Series'
import Reader from './components/Reader'
import Downloads from './components/Downloads'
import Following from './components/Following'
import Sites from './components/Sites'
import AddTitle from './components/AddTitle'
import type { OpenChapter, OpenSeries } from './lib'

type View =
  | { name: 'browse' }
  | { name: 'downloads' }
  | { name: 'following' }
  | { name: 'sites' }
  | { name: 'addtitle' }
  | { name: 'series'; series: OpenSeries; back?: 'addtitle' }
  | { name: 'reader'; series: OpenSeries; chapter: OpenChapter; back?: 'addtitle' }

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

function AppInner(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'browse' })

  // Browse stays mounted (hidden) so scroll position, search and results survive opening a series.
  return (
    <div className="app">
      <div className="pane" style={{ display: view.name === 'browse' ? 'flex' : 'none' }}>
        <Browse
          active={view.name === 'browse'}
          onOpen={(series) => setView({ name: 'series', series })}
          onDownloads={() => setView({ name: 'downloads' })}
          onFollowing={() => setView({ name: 'following' })}
          onSites={() => setView({ name: 'sites' })}
          onAddTitle={() => setView({ name: 'addtitle' })}
        />
      </div>
      {view.name === 'following' && (
        <div className="pane">
          <Following
            onBack={() => setView({ name: 'browse' })}
            onOpen={(series) => setView({ name: 'series', series })}
          />
        </div>
      )}
      {view.name === 'addtitle' && (
        <div className="pane">
          <AddTitle onBack={() => setView({ name: 'browse' })} onOpen={(series) => setView({ name: 'series', series, back: 'addtitle' })} />
        </div>
      )}
      {view.name === 'sites' && (
        <div className="pane">
          <Sites onBack={() => setView({ name: 'browse' })} />
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
            onBack={() => setView(view.back === 'addtitle' ? { name: 'addtitle' } : { name: 'browse' })}
            onRead={(chapter) => setView({ name: 'reader', series: view.series, chapter, back: view.back })}
          />
        </div>
      )}
      {view.name === 'reader' && (
        <div className="pane">
          <Reader
            chapter={view.chapter}
            series={view.series}
            onBack={() => setView({ name: 'series', series: view.series, back: view.back })}
            onNavigate={(chapter) => setView({ name: 'reader', series: view.series, chapter, back: view.back })}
          />
        </div>
      )}
    </div>
  )
}
