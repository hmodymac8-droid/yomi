import { useState } from 'react'
import Browse from './components/Browse'
import Series from './components/Series'
import Reader from './components/Reader'
import Downloads from './components/Downloads'
import Following from './components/Following'
import type { OpenChapter, OpenSeries } from './lib'

type View =
  | { name: 'browse' }
  | { name: 'downloads' }
  | { name: 'following' }
  | { name: 'series'; series: OpenSeries }
  | { name: 'reader'; series: OpenSeries; chapter: OpenChapter }

export default function App(): React.JSX.Element {
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
      {view.name === 'downloads' && (
        <div className="pane">
          <Downloads onBack={() => setView({ name: 'browse' })} />
        </div>
      )}
      {view.name === 'series' && (
        <div className="pane">
          <Series
            series={view.series}
            onBack={() => setView({ name: 'browse' })}
            onRead={(chapter) => setView({ name: 'reader', series: view.series, chapter })}
          />
        </div>
      )}
      {view.name === 'reader' && (
        <div className="pane">
          <Reader
            chapter={view.chapter}
            series={view.series}
            onBack={() => setView({ name: 'series', series: view.series })}
            onNavigate={(chapter) => setView({ name: 'reader', series: view.series, chapter })}
          />
        </div>
      )}
    </div>
  )
}
