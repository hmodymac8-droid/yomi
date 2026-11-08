import { useEffect, useMemo, useState } from 'react'
import type { FollowInfo, NewChapter, SourceInfo, UpdateStatus } from '../../../preload/index.d'
import { OpenChapter, OpenSeries, coverSrc, readerFor, timeAgo } from '../lib'

interface Props {
  onOpen: (s: OpenSeries) => void
  onRead: (s: OpenSeries, c: OpenChapter) => void
}

interface Row {
  f: FollowInfo
  c: NewChapter
  unread: boolean
}

const DAY = 24 * 3600 * 1000
const startOfToday = (): number => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
/** "Today", "Yesterday", "This week", "Earlier" by when Yomi noticed the chapter. */
function groupOf(at: number): string {
  const today = startOfToday()
  if (at >= today) return 'Today'
  if (at >= today - DAY) return 'Yesterday'
  if (at >= today - 6 * DAY) return 'This week'
  return 'Earlier'
}
const GROUPS = ['Today', 'Yesterday', 'This week', 'Earlier']

/**
 * New chapters of the series you follow, newest first and grouped by day. Yomi checks your followed series for new
 * chapters in the background (series on your Finished or Dropped shelves are not checked). Click one to read it.
 */
export default function NewChapters({ onOpen, onRead }: Props): React.JSX.Element {
  const [list, setList] = useState<FollowInfo[]>([])
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [opening, setOpening] = useState('')
  const [openError, setOpenError] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)

  useEffect(() => {
    const load = (): void =>
      void window.api.followList().then((l) => {
        setList(l)
        setLoaded(true)
      })
    load()
    void window.api.listSources().then(setSources)
    void window.api.updatesStatus().then(setStatus)
    return window.api.onUpdates((s) => {
      setStatus(s)
      load()
    })
  }, [])

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const f of list) {
      const unread = new Set(f.unreadChapters.map((c) => c.url))
      for (const c of f.newChapters) out.push({ f, c, unread: unread.has(c.url) })
    }
    return out.filter((r) => !unreadOnly || r.unread).sort((a, b) => b.c.at - a.c.at)
  }, [list, unreadOnly])

  const seriesOf = (f: FollowInfo): OpenSeries => ({
    title: f.title,
    cover: f.cover,
    coverReferer: f.coverReferer,
    entries: [{ sourceId: f.sourceId, sourceName: siteName(f.sourceId), url: f.seriesUrl }]
  })
  const siteName = (id: string): string => sources.find((s) => s.id === id)?.name ?? id

  const read = async (r: Row): Promise<void> => {
    const key = r.c.url
    setOpening(key)
    setOpenError('')
    const c = await readerFor(r.f.sourceId, r.f.seriesUrl, (chs) => chs.find((x) => x.url === r.c.url || x.alts?.includes(r.c.url)) ?? { title: r.c.title, url: r.c.url, alts: r.c.alts })
    setOpening('')
    if (c) onRead(seriesOf(r.f), c)
    else setOpenError(`Couldn't open ${r.f.title} right now. Open it from its page instead.`)
  }

  const unreadCount = rows.filter((r) => r.unread).length

  return (
    <div className="series">
      <div className="pagehead">
        <div>
          <div className="kicker">新着</div>
          <h1>New</h1>
          <p>
            New chapters of the series you follow
            {unreadCount > 0 ? ` · ${unreadCount} not read yet` : ''}
            {status?.lastChecked ? ` · checked ${timeAgo(status.lastChecked)}` : ''}
          </p>
        </div>
        <div className="pageact">
          <label className="auto">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Not read only
          </label>
          <button className="primary" disabled={!!status?.checking} onClick={() => void window.api.updatesCheck()}>
            {status?.checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      {openError && <div className="error small">{openError}</div>}
      {loaded && rows.length === 0 && (
        <div className="hint">
          {list.length === 0
            ? "You aren't following anything yet. Follow a series (or just read it) and its new chapters show up here."
            : unreadOnly
              ? "You've read every new chapter."
              : 'No new chapters yet. Yomi checks the series you follow every so often, or press Check now.'}
        </div>
      )}

      {GROUPS.map((g) => {
        const inGroup = rows.filter((r) => groupOf(r.c.at) === g)
        if (inGroup.length === 0) return null
        return (
          <section key={g} className="newgroup">
            <h2>
              {g} <span>{inGroup.length}</span>
            </h2>
            {inGroup.map((r) => (
              <div key={r.f.seriesUrl + r.c.url} className={`newrow${r.unread ? '' : ' seen'}`}>
                <button className="newcover" onClick={() => onOpen(seriesOf(r.f))} title="Open the series">
                  {r.f.cover ? <img loading="lazy" src={coverSrc(r.f.cover, r.f.coverReferer)} alt="" /> : <span>{r.f.title.slice(0, 1)}</span>}
                </button>
                <div className="newtext">
                  <b>{r.f.title}</b>
                  <span>
                    {r.c.title} · {siteName(r.f.sourceId)} · {timeAgo(r.c.at)}
                    {r.unread ? '' : ' · read'}
                  </span>
                </div>
                <button className={r.unread ? 'primary' : 'mini'} disabled={opening === r.c.url} onClick={() => void read(r)}>
                  {opening === r.c.url ? 'Opening…' : r.unread ? 'Read' : 'Read again'}
                </button>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
