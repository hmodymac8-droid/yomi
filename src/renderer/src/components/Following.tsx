import { useEffect, useMemo, useState } from 'react'
import type { FollowCategory, FollowInfo, SourceInfo } from '../../../preload/index.d'
import { OpenSeries, proxied, timeAgo } from '../lib'

interface Props {
  onBack: () => void
  onOpen: (s: OpenSeries) => void
}

type Tab = 'all' | FollowCategory

const SHELVES: { id: FollowCategory; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'plan', label: 'Plan to read' },
  { id: 'finished', label: 'Finished' },
  { id: 'dropped', label: 'Dropped' }
]

const shelfOf = (f: FollowInfo): FollowCategory => f.category ?? 'reading'

/** Every series you follow (you follow a series by pressing Follow, or just by reading it), sorted onto shelves. */
export default function Following({ onOpen }: Props): React.JSX.Element {
  const [list, setList] = useState<FollowInfo[]>([])
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [newOnly, setNewOnly] = useState(false)

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

  const move = async (f: FollowInfo, category: FollowCategory): Promise<void> => {
    // update the screen at once; the saved list follows
    setList((prev) => prev.map((x) => (x.seriesUrl === f.seriesUrl ? { ...x, category } : x)))
    await window.api.followCategory(f.seriesUrl, category)
    load()
  }

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: list.length, reading: 0, plan: 0, finished: 0, dropped: 0 }
    for (const f of list) c[shelfOf(f)]++
    return c
  }, [list])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return list.filter(
      (f) =>
        (tab === 'all' || shelfOf(f) === tab) &&
        (!newOnly || f.unread > 0) &&
        (!needle || f.title.toLowerCase().includes(needle))
    )
  }, [list, tab, q, newOnly])

  const withNew = list.filter((f) => f.unread > 0).length

  return (
    <div className="series">
      <div className="pagehead">
        <div>
          <div className="kicker">追跡中</div>
          <h1>Following</h1>
          <p>
            {list.length} series{withNew > 0 && ` · ${withNew} with new chapters`}
          </p>
        </div>
      </div>

      {list.length > 0 && (
        <>
          <div className="shelftabs">
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
              All <span>{counts.all}</span>
            </button>
            {SHELVES.map((s) => (
              <button key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
                {s.label} <span>{counts[s.id]}</span>
              </button>
            ))}
          </div>
          <div className="shelftools">
            <input
              className="search"
              placeholder="Search what you follow…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="auto">
              <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} /> New chapters only
            </label>
          </div>
        </>
      )}

      {loaded && list.length === 0 && (
        <div className="hint">
          You aren&apos;t following anything yet. Press ☆ Follow on a series, or just read a chapter: reading a series follows
          it, and the app tells you when it gets new chapters.
        </div>
      )}
      {loaded && list.length > 0 && shown.length === 0 && <div className="hint">Nothing here with these filters.</div>}
      <div className="grid">
        {shown.map((f) => (
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
            <select
              className="shelfpick"
              value={shelfOf(f)}
              title="Move to another shelf"
              onChange={(e) => void move(f, e.target.value as FollowCategory)}
            >
              {SHELVES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button className="x" title="Unfollow" onClick={() => unfollow(f)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
