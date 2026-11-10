import { useEffect, useMemo, useState } from 'react'
import type {
  FollowCategory,
  FollowInfo,
  ProgressRecord,
  SourceInfo
} from '../../../preload/index.d'
import { OpenChapter, OpenSeries, continueChapter, coverSrc, readerFor, timeAgo } from '../lib'

interface Props {
  onBack: () => void
  onOpen: (s: OpenSeries) => void
  onRead: (s: OpenSeries, c: OpenChapter) => void
}

type Sort = 'new' | 'recent' | 'az'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'new', label: 'New chapters first' },
  { id: 'recent', label: 'Recently read' },
  { id: 'az', label: 'A–Z' }
]
const savedSort = (): Sort => {
  try {
    const v = localStorage.getItem('following.sort')
    return v === 'recent' || v === 'az' ? v : 'new'
  } catch {
    return 'new'
  }
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
export default function Following({ onOpen, onRead }: Props): React.JSX.Element {
  const [list, setList] = useState<FollowInfo[]>([])
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const [sort, setSort] = useState<Sort>(savedSort)
  // where you stopped in each series (for "Recently read", the "Read up to" line and Continue)
  const [prog, setProg] = useState<Record<string, ProgressRecord>>({})
  const [opening, setOpening] = useState('')
  const [openError, setOpenError] = useState('')
  // the Settings switch for auto-download (each series can be turned on or off on its own card)
  const [autoAll, setAutoAll] = useState(false)
  useEffect(() => {
    void window.api.updatesStatus().then((s) => setAutoAll(s.autoDownload))
    return window.api.onUpdates((s) => setAutoAll(s.autoDownload))
  }, [])
  const setAuto = (f: FollowInfo, on: boolean): void => {
    setList((l) => l.map((x) => (x.seriesUrl === f.seriesUrl ? { ...x, autoDownload: on } : x)))
    void window.api.followAutoDownload(f.seriesUrl, on)
  }

  const load = (): void => {
    window.api.followList().then((l) => {
      setList(l)
      setLoaded(true)
      void Promise.all(l.map((f) => window.api.progressGet(f.seriesUrl))).then((recs) =>
        setProg(
          Object.fromEntries(
            recs.filter((r): r is ProgressRecord => !!r).map((r) => [r.seriesUrl, r])
          )
        )
      )
    })
  }
  const pickSort = (s: Sort): void => {
    setSort(s)
    try {
      localStorage.setItem('following.sort', s)
    } catch {
      /* not critical */
    }
  }
  useEffect(() => {
    load()
    window.api.listSources().then(setSources)
    return window.api.onUpdates(load) // refreshes while the background checker finds new chapters
  }, [])

  const seriesOf = (f: FollowInfo): OpenSeries => ({
    title: f.title,
    cover: f.cover,
    coverReferer: f.coverReferer,
    entries: [
      {
        sourceId: f.sourceId,
        sourceName: sources.find((s) => s.id === f.sourceId)?.name ?? f.sourceId,
        url: f.seriesUrl
      }
    ]
  })
  const open = (f: FollowInfo): void => onOpen(seriesOf(f))

  // Continue: straight into the reader, at the chapter you were in (or the next one if you finished it)
  const carryOn = async (f: FollowInfo): Promise<void> => {
    setOpening(f.seriesUrl)
    setOpenError('')
    const c = await readerFor(f.sourceId, f.seriesUrl, (chs) =>
      continueChapter(chs, prog[f.seriesUrl] ?? null)
    )
    setOpening('')
    if (c) onRead(seriesOf(f), c)
    else setOpenError(`Couldn't open ${f.title} right now. Open it from its page instead.`)
  }

  const unfollow = async (f: FollowInfo): Promise<void> => {
    await window.api.followSet(
      {
        seriesUrl: f.seriesUrl,
        sourceId: f.sourceId,
        title: f.title,
        cover: f.cover,
        coverReferer: f.coverReferer
      },
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
    const c: Record<Tab, number> = {
      all: list.length,
      reading: 0,
      plan: 0,
      finished: 0,
      dropped: 0
    }
    for (const f of list) c[shelfOf(f)]++
    return c
  }, [list])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = list.filter(
      (f) =>
        (tab === 'all' || shelfOf(f) === tab) &&
        (!newOnly || f.unread > 0) &&
        (!needle || f.title.toLowerCase().includes(needle))
    )
    const readAt = (f: FollowInfo): number => prog[f.seriesUrl]?.updatedAt ?? 0
    if (sort === 'recent') out.sort((a, b) => readAt(b) - readAt(a))
    else if (sort === 'az') out.sort((a, b) => a.title.localeCompare(b.title))
    return out // 'new': as the list comes (most new chapters first)
  }, [list, tab, q, newOnly, sort, prog])

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
              <input
                type="checkbox"
                checked={newOnly}
                onChange={(e) => setNewOnly(e.target.checked)}
              />{' '}
              New chapters only
            </label>
            <select
              className="sortpick"
              value={sort}
              onChange={(e) => pickSort(e.target.value as Sort)}
              aria-label="Sort"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {openError && <div className="error small">{openError}</div>}
        </>
      )}

      {loaded && list.length === 0 && (
        <div className="hint">
          You aren&apos;t following anything yet. Press ☆ Follow on a series, or just read a
          chapter: reading a series follows it, and the app tells you when it gets new chapters.
        </div>
      )}
      {loaded && list.length > 0 && shown.length === 0 && (
        <div className="hint">Nothing here with these filters.</div>
      )}
      <div className="grid">
        {shown.map((f) => (
          <div key={f.seriesUrl} className="newcard wide">
            <button className="card" onClick={() => open(f)}>
              <div className="cover">
                {f.cover ? (
                  <img loading="lazy" src={coverSrc(f.cover, f.coverReferer)} />
                ) : (
                  <div className="ph">{f.title.trim().slice(0, 1).toUpperCase()}</div>
                )}
                {f.unread > 0 && <span className="badge">+{f.unread} new</span>}
              </div>
              <div className="name" title={f.title}>
                {f.title}
              </div>
              <div className="from">
                {prog[f.seriesUrl]
                  ? `Read up to ${prog[f.seriesUrl].chapterTitle.replace(/^chapters*/i, 'Ch. ')} · ${timeAgo(prog[f.seriesUrl].updatedAt)}`
                  : `${sources.find((s) => s.id === f.sourceId)?.name ?? f.sourceId} · not started`}
              </div>
            </button>
            <button
              className="mini continue"
              disabled={opening === f.seriesUrl}
              onClick={() => void carryOn(f)}
            >
              {opening === f.seriesUrl
                ? 'Opening…'
                : prog[f.seriesUrl]
                  ? 'Continue'
                  : 'Start reading'}
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
            <label
              className="autodl"
              title="Download new chapters of this series as soon as they come out"
            >
              <input
                type="checkbox"
                checked={f.autoDownload ?? autoAll}
                onChange={(e) => setAuto(f, e.target.checked)}
              />
              Auto-download
            </label>
            <button className="x" title="Unfollow" onClick={() => unfollow(f)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
