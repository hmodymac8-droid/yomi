import { useEffect, useState } from 'react'
import type { FollowInfo, SourceInfo } from '../../../preload/index.d'
import { OpenSeries, proxied, timeAgo } from '../lib'

interface Props {
  onBack: () => void
  onOpen: (s: OpenSeries) => void
}

/** Every series you follow (you follow a series by pressing Follow, or just by reading it). */
export default function Following({ onBack, onOpen }: Props): React.JSX.Element {
  const [list, setList] = useState<FollowInfo[]>([])
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = (): void => {
    window.api.followList().then((l) => {
      setList(l)
      setLoaded(true)
    })
  }
  useEffect(() => {
    load()
    window.api.listSources().then(setSources)
    return window.api.onUpdates(load) // refreshes while the background checker finds new chapters
  }, [])

  const open = (f: FollowInfo): void => {
    const name = sources.find((s) => s.id === f.sourceId)?.name ?? f.sourceId
    onOpen({
      title: f.title,
      cover: f.cover,
      coverReferer: f.coverReferer,
      entries: [{ sourceId: f.sourceId, sourceName: name, url: f.seriesUrl }]
    })
  }

  const unfollow = async (f: FollowInfo): Promise<void> => {
    await window.api.followSet(
      { seriesUrl: f.seriesUrl, sourceId: f.sourceId, title: f.title, cover: f.cover, coverReferer: f.coverReferer },
      false
    )
    load()
  }

  const withNew = list.filter((f) => f.unread > 0).length

  return (
    <div className="series">
      <button className="back" onClick={onBack}>
        ← Back
      </button>
      <h2>Following</h2>
      <div className="meta">
        {list.length} series{withNew > 0 && ` · ${withNew} with new chapters`}
      </div>
      {loaded && list.length === 0 && (
        <div className="hint">
          You aren&apos;t following anything yet. Press ☆ Follow on a series, or just read a chapter: reading a series follows
          it, and the app tells you when it gets new chapters.
        </div>
      )}
      <div className="grid">
        {list.map((f) => (
          <div key={f.seriesUrl} className="newcard wide">
            <button className="card" onClick={() => open(f)}>
              <div className="cover">
                {f.cover ? (
                  <img loading="lazy" src={proxied(f.cover, f.coverReferer)} />
                ) : (
                  <div className="ph">{f.title.trim().slice(0, 1).toUpperCase()}</div>
                )}
                {f.unread > 0 && <span className="badge">+{f.unread} new</span>}
              </div>
              <div className="name" title={f.title}>
                {f.title}
              </div>
              <div className="from">
                {sources.find((s) => s.id === f.sourceId)?.name ?? f.sourceId} · checked {timeAgo(f.lastChecked)}
              </div>
            </button>
            <button className="x" title="Unfollow" onClick={() => unfollow(f)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
