import { useEffect, useState } from 'react'
import Reader from './components/Reader'
import { Icon } from './components/Icon'
import type { MiniSession } from '../../preload/index.d'

/** Always-on-top reader. The main window keeps running underneath. */
export default function MiniApp(): React.JSX.Element {
  const [session, setSession] = useState<MiniSession | null>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    void window.api.miniGet().then(setSession)
    return window.api.onMiniSession(setSession)
  }, [])

  return (
    <div className="miniapp">
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
          <button
            aria-label="Open in Yomi"
            title="Continue in the main window"
            onClick={() => void window.api.miniReturn()}
          >
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
      {session ? (
        <Reader
          compact
          chapter={session.chapter}
          series={session.series}
          onBack={() => void window.api.miniClose()}
          onNavigate={(chapter) => {
            const next = { ...session, chapter }
            setSession(next)
            void window.api.miniUpdate(next)
          }}
        />
      ) : (
        <div className="hint">Opening the mini reader…</div>
      )}
    </div>
  )
}
