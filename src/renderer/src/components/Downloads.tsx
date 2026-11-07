import { useEffect, useMemo, useRef, useState } from 'react'
import type { DownloadItem } from '../../../preload/index.d'

const mb = (b: number): string => (b / 1024 / 1024).toFixed(1) + ' MB'

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export default function Downloads({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Record<string, DownloadItem>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [box, setBox] = useState<Box | null>(null) // the drag rectangle, in the scrolling area's own coordinates
  const area = useRef<HTMLDivElement>(null)
  const lastClicked = useRef<string | null>(null)
  const suppressClick = useRef(false) // a drag ends with a click event: ignore that one

  useEffect(() => {
    let cancelled = false
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
  const bySeries = useMemo(() => {
    const m = new Map<string, DownloadItem[]>()
    for (const i of all) m.set(i.seriesTitle, [...(m.get(i.seriesTitle) ?? []), i])
    return m
  }, [all])
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
    await window.api.downloadRemoveMany(ids)
    setSelected(new Set())
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
        setSelected(new Set(all.map((i) => i.id)))
      } else if (e.key === 'Delete' && selected.size > 0) {
        void deleteIds([...selected], 'the selected downloads')
      } else if (e.key === 'Escape' && selected.size > 0) {
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, all])

  const failed = all.filter((i) => i.status === 'error')

  return (
    <div className="series dlarea" ref={area} onMouseDown={onMouseDown}>
      <button className="back" onClick={onBack}>
        ← Back
      </button>
      <h2>Downloads</h2>
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
            retry failed
          </button>
        )}
      </div>

      {all.length > 0 && (
        <div className="seltools">
          <button className="mini big" onClick={() => setSelected(new Set(all.map((i) => i.id)))}>
            Select all
          </button>
          {selected.size > 0 && (
            <>
              <span className="sub">{selected.size} selected</span>
              <button className="mini big danger" onClick={() => void deleteIds([...selected], 'the selected downloads')}>
                Delete selected
              </button>
              <button className="mini big" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </>
          )}
          <span className="grow" />
          <button className="mini big danger" onClick={() => void deleteIds(all.map((i) => i.id), 'ALL downloads')}>
            Delete all
          </button>
        </div>
      )}
      {all.length > 0 && (
        <div className="sub seltip">Tip: press and drag across the list to select several, like in Windows. Ctrl keeps the earlier picks, Shift selects a range.</div>
      )}

      {all.length === 0 && <div className="hint">Nothing downloaded yet. Open a series and press ⬇ on a chapter.</div>}
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
              <span className="dlbar">
                <span
                  className={`fill ${i.status}`}
                  style={{ width: `${i.status === 'done' ? 100 : i.total ? (i.done / i.total) * 100 : 0}%` }}
                />
              </span>
              <span className="dlstat">
                {i.status === 'done' && mb(i.bytes)}
                {i.status === 'downloading' && `${i.done}/${i.total || '?'}`}
                {i.status === 'queued' && 'queued'}
                {i.status === 'error' && <span className="bad">{i.error}</span>}
              </span>
              {(i.status === 'queued' || i.status === 'downloading') && (
                <button className="mini" onClick={() => window.api.downloadCancel(i.id)}>
                  cancel
                </button>
              )}
              {i.status !== 'downloading' && (
                <button className="mini" onClick={() => void deleteIds([i.id], i.chapterTitle)}>
                  {i.status === 'done' ? 'delete' : 'remove'}
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
      {box && <div className="marquee" style={{ left: box.x1, top: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 }} />}
    </div>
  )
}
