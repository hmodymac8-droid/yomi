import { useEffect, useMemo, useRef, useState } from 'react'
import type { DownloadItem } from '../../../preload/index.d'

const mb = (b: number): string => (b / 1024 / 1024).toFixed(1) + ' MB'

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export default function Downloads(_props: { onBack: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Record<string, DownloadItem>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [box, setBox] = useState<Box | null>(null) // the drag rectangle, in the scrolling area's own coordinates
  const area = useRef<HTMLDivElement>(null)
  const lastClicked = useRef<string | null>(null)
  const [concurrency, setConcurrencyState] = useState(3)
  const [deleting, setDeleting] = useState(false)
  const [paused, setPausedState] = useState(false)
  const [offline, setOfflineState] = useState(false)
  const [note, setNote] = useState('')
  const suppressClick = useRef(false) // a drag ends with a click event: ignore that one

  useEffect(() => {
    let cancelled = false
    window.api.downloadGetConcurrency().then((n) => !cancelled && setConcurrencyState(n))
    window.api.downloadGetPaused().then((p) => !cancelled && setPausedState(p))
    window.api.offlineGet().then((o) => !cancelled && setOfflineState(o))
    window.api.downloadList().then((list) => {
      if (!cancelled) setItems(Object.fromEntries(list.map((i) => [i.id, i])))
    })
    const off = window.api.onDownload((i) =>
      setItems((prev) => {
        const next = { ...prev }
        if (i.status === 'removed') delete next[i.id]
        else next[i.id] = i
        return next
      })
    )
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const all = useMemo(() => Object.values(items).sort((a, b) => a.queuedAt - b.queuedAt), [items])
  // Two lists: what is still on its way (queued, downloading, failed) and what is saved on this PC.
  const [tab, setTabState] = useState<'queue' | 'library'>('library')
  const pickedTab = useRef(false)
  const setTab = (t: 'queue' | 'library'): void => {
    pickedTab.current = true
    setTabState(t)
    setSelected(new Set())
  }
  // open on the queue while something is downloading (until you choose a tab yourself)
  useEffect(() => {
    if (!pickedTab.current && all.some((i) => i.status !== 'done')) setTabState('queue')
  }, [all])
  const visible = useMemo(() => all.filter((i) => (tab === 'library' ? i.status === 'done' : i.status !== 'done')), [all, tab])
  const bySeries = useMemo(() => {
    const m = new Map<string, DownloadItem[]>()
    for (const i of visible) m.set(i.seriesTitle, [...(m.get(i.seriesTitle) ?? []), i])
    return m
  }, [visible])
  const ordered = useMemo(() => [...bySeries.values()].flat(), [bySeries]) // the order rows appear on screen
  const active = all.filter((i) => i.status === 'queued' || i.status === 'downloading').length
  const total = all.filter((i) => i.status === 'done').reduce((s, i) => s + i.bytes, 0)

  // things that disappeared (deleted) are no longer selected
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => items[id]))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const deleteIds = async (ids: string[], what: string): Promise<void> => {
    if (ids.length === 0) return
    const size = ids.reduce((s, id) => s + (items[id]?.status === 'done' ? items[id].bytes : 0), 0)
    const ok = window.confirm(
      `Delete ${what}?\n\n${ids.length} chapter${ids.length === 1 ? '' : 's'}${size > 0 ? ` · ${mb(size)}` : ''} will be removed from this computer. This cannot be undone.`
    )
    if (!ok) return
    setDeleting(true)
    try {
      await window.api.downloadRemoveMany(ids)
      // take them off the screen in one step (no message per chapter)
      const gone = new Set(ids)
      setItems((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !gone.has(id))))
      setSelected(new Set())
    } finally {
      setDeleting(false)
    }
  }

  // ---- selecting -------------------------------------------------------------------------------------------------

  const toggle = (id: string, shift: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastClicked.current) {
        const a = ordered.findIndex((i) => i.id === lastClicked.current)
        const b = ordered.findIndex((i) => i.id === id)
        if (a >= 0 && b >= 0) {
          for (const i of ordered.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(i.id)
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastClicked.current = id
  }

  const toggleGroup = (list: DownloadItem[]): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      const every = list.every((i) => next.has(i.id))
      for (const i of list) {
        if (every) next.delete(i.id)
        else next.add(i.id)
      }
      return next
    })

  // Press and drag on empty space (or on a row) to draw a box: every row the box touches gets selected, like in a
  // file explorer. Holding Ctrl keeps what was selected before. The list scrolls by itself near its top/bottom edge.
  const onMouseDown = (e: React.MouseEvent): void => {
    const el = area.current
    if (!el || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, input, select, a')) return
    const bounds = el.getBoundingClientRect()
    if (e.clientX > bounds.right - 18) return // the scrollbar
    const toContent = (cx: number, cy: number): { x: number; y: number } => ({
      x: cx - bounds.left + el.scrollLeft,
      y: cy - bounds.top + el.scrollTop
    })
    const start = toContent(e.clientX, e.clientY)
    const base = e.ctrlKey || e.metaKey ? new Set(selected) : new Set<string>()
    let mouse = { x: e.clientX, y: e.clientY }
    let dragging = false
    let raf = 0

    const update = (): void => {
      const cur = toContent(mouse.x, mouse.y)
      const b: Box = { x1: Math.min(start.x, cur.x), y1: Math.min(start.y, cur.y), x2: Math.max(start.x, cur.x), y2: Math.max(start.y, cur.y) }
      setBox(b)
      const hit = new Set(base)
      el.querySelectorAll<HTMLElement>('[data-dl]').forEach((row) => {
        const r = row.getBoundingClientRect()
        const top = r.top - bounds.top + el.scrollTop
        const left = r.left - bounds.left + el.scrollLeft
        if (left < b.x2 && left + r.width > b.x1 && top < b.y2 && top + r.height > b.y1) hit.add(row.dataset.dl!)
      })
      setSelected(hit)
    }

    const tick = (): void => {
      // near the top or bottom edge: scroll faster the closer (or further past) the edge the mouse is
      const edge = 48
      let dy = 0
      if (mouse.y < bounds.top + edge) dy = -Math.min(26, (bounds.top + edge - mouse.y) / 2 + 3)
      else if (mouse.y > bounds.bottom - edge) dy = Math.min(26, (mouse.y - (bounds.bottom - edge)) / 2 + 3)
      if (dy !== 0) {
        el.scrollTop += dy
        update()
      }
      raf = requestAnimationFrame(tick)
    }

    const move = (ev: MouseEvent): void => {
      mouse = { x: ev.clientX, y: ev.clientY }
      if (!dragging) {
        if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 5) return // still just a click
        dragging = true
        raf = requestAnimationFrame(tick)
      }
      ev.preventDefault()
      update()
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      cancelAnimationFrame(raf)
      if (dragging) suppressClick.current = true
      setBox(null)
      if (!dragging && !(e.ctrlKey || e.metaKey || e.shiftKey) && !(e.target as HTMLElement).closest('[data-dl]')) {
        setSelected(new Set()) // a plain click on empty space clears the selection
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Ctrl+A selects everything, Delete removes the selection, Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(visible.map((i) => i.id)))
      } else if (e.key === 'Delete' && selected.size > 0) {
        void deleteIds([...selected], 'the selected downloads')
      } else if (e.key === 'Escape' && selected.size > 0) {
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, visible])

  const failed = all.filter((i) => i.status === 'error')

  const exportCbz = async (ids: string[]): Promise<void> => {
    const done = ids.filter((id) => items[id]?.status === 'done')
    if (done.length === 0) {
      setNote('Pick finished chapters to export.')
      return
    }
    setNote('Exporting…')
    const r = await window.api.downloadExportCbz(done)
    setNote(r ? `Saved ${r.written} .cbz file${r.written === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}.` : '')
  }

  return (
    <div className="series dlarea" ref={area} onMouseDown={onMouseDown}>
      <div className="pagehead">
        <div>
          <div className="kicker">ダウンロード</div>
          <h1>Downloads</h1>
          <p>
            {active} in queue · {all.filter((i) => i.status === 'done').length} chapters offline · {mb(total)} used
          </p>
        </div>
      </div>
      <div className="shelftabs">
        <button className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>
          Queue <span>{all.length - all.filter((i) => i.status === 'done').length}</span>
        </button>
        <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>
          Offline library <span>{all.filter((i) => i.status === 'done').length}</span>
        </button>
      </div>
      <div className="meta">
        {all.filter((i) => i.status === 'done').length} saved · {mb(total)} on disk
        {active > 0 && ` · ${active} in progress`}
        {failed.length > 0 && (
          <button
            className="mini"
            onClick={() =>
              window.api.downloadEnqueue(
                failed.map((i) => ({
                  chapterUrl: i.id,
                  alts: i.urls.slice(1),
                  chapterTitle: i.chapterTitle,
                  seriesUrl: i.seriesUrl,
                  seriesTitle: i.seriesTitle,
                  sourceId: i.sourceId,
                  referer: i.referer
                }))
              )
            }
          >
            Retry failed
          </button>
        )}
      </div>

      <div className="meta">
        <button
          className="mini big"
          title={paused ? 'Start downloading the queue again' : 'Stop the queue. Chapters being downloaded go back to the queue and restart when you resume.'}
          onClick={async () => setPausedState(await window.api.downloadSetPaused(!paused))}
        >
          {paused ? '▶ Resume downloads' : '⏸ Pause downloads'}
        </button>{' '}
        <button
          className={`mini big${offline ? ' on' : ''}`}
          title="Offline mode: the app only uses chapters saved on this computer and doesn't visit any site."
          onClick={async () => setOfflineState(await window.api.offlineSet(!offline))}
        >
          {offline ? '✈ Offline mode: ON' : '✈ Offline mode: off'}
        </button>
        {paused && <span className="sub"> Paused: {active} waiting</span>}
      </div>
      <div className="meta">
        <label title="How many chapters download at the same time. More is faster; some sites slow down or refuse if you ask too much.">
          Download at the same time:{' '}
          <select
            value={concurrency}
            onChange={(e) => {
              const n = Number(e.target.value)
              setConcurrencyState(n)
              void window.api.downloadSetConcurrency(n)
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'chapter' : 'chapters'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {visible.length > 0 && (
        <div className="seltools">
          <button className="mini big" onClick={() => setSelected(new Set(visible.map((i) => i.id)))}>
            Select all
          </button>
          {selected.size > 0 && (
            <>
              <span className="sub">{selected.size} selected</span>
              <button className="mini big danger" disabled={deleting} onClick={() => void deleteIds([...selected], 'the selected downloads')}>
                Delete selected
              </button>
              <button className="mini big" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </>
          )}
          {tab === 'library' && (
            <button className="mini big" onClick={() => void exportCbz(selected.size > 0 ? [...selected] : visible.map((i) => i.id))} title="Save finished chapters as .cbz files (open them in any comic reader)">
              Export CBZ{selected.size > 0 ? ' (selected)' : ' (all)'}
            </button>
          )}
          {note && <span className="sub">{note}</span>}
          <span className="grow" />
          <button className="mini big danger" disabled={deleting} onClick={() => void deleteIds(visible.map((i) => i.id), tab === 'library' ? 'ALL saved chapters' : 'everything in the queue')}>
            {deleting ? 'Deleting…' : 'Delete all'}
          </button>
        </div>
      )}
      {visible.length > 0 && (
        <div className="sub seltip">Tip: press and drag across the list to select several, like in Windows. Ctrl keeps the earlier picks, Shift selects a range.</div>
      )}

      {visible.length === 0 && (
        <div className="hint">
          {tab === 'queue'
            ? 'Nothing waiting. Open a series and press Download on a chapter, or Download unread.'
            : 'No chapters saved yet. Finished downloads show up here and read without the internet.'}
        </div>
      )}
      {[...bySeries.entries()].map(([title, list]) => (
        <section key={title} className="dlgroup">
          <h3 className="dlgrouphead" onClick={() => toggleGroup(list)} title="Click to select every chapter of this series">
            {title}
          </h3>
          {list.map((i) => (
            <div
              key={i.id}
              data-dl={i.id}
              className={`dlrow${selected.has(i.id) ? ' sel' : ''}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                toggle(i.id, e.shiftKey)
              }}
            >
              <span className="dlname">{i.chapterTitle}</span>
              <span className="dlbar" style={i.status === 'done' ? { visibility: 'hidden' } : undefined}>
                <span
                  className={`fill ${i.status}`}
                  style={{ width: `${i.status === 'done' ? 100 : i.total ? (i.done / i.total) * 100 : 0}%` }}
                />
              </span>
              <span className="dlstat">
                {i.status === 'done' && `${i.files.length} pages · ${mb(i.bytes)}`}
                {i.status === 'downloading' && <span className="pct">{i.total ? `${Math.round((i.done / i.total) * 100)}%` : 'Starting'}</span>}
                {i.status === 'queued' && 'Waiting'}
                {i.status === 'error' && <span className="bad">{i.error}</span>}
              </span>
              {(i.status === 'queued' || i.status === 'downloading') && (
                <button className="mini" onClick={() => window.api.downloadCancel(i.id)}>
                  Cancel
                </button>
              )}
              {i.status !== 'downloading' && (
                <>
                  {i.status === 'done' && (
                    <button className="mini" onClick={() => void exportCbz([i.id])}>
                      Export CBZ
                    </button>
                  )}
                  <button className="mini" onClick={() => void deleteIds([i.id], i.chapterTitle)}>
                    {i.status === 'done' ? 'Delete' : 'Remove'}
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      ))}
      {box && <div className="marquee" style={{ left: box.x1, top: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 }} />}
    </div>
  )
}
