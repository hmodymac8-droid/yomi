import { useEffect, useMemo, useRef, useState } from 'react'
import type { FollowInfo, ProgressRecord, SearchHit, SourceInfo } from '../../../preload/index.d'
import type { OpenSeries } from '../lib'
import { Icon } from './Icon'

/*
 * Quick Open (Ctrl+P): type a few letters to jump to a screen, a series you follow or are reading, or any title on
 * your sites. Up/Down to move, Enter to open, Esc to close.
 */

export interface Screen {
  id: string
  label: string
  icon: string
}

interface Item {
  key: string
  icon: string
  label: string
  sub: string
  run: () => void
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

export default function QuickOpen({
  screens,
  sources,
  onScreen,
  onSeries,
  onClose
}: {
  screens: Screen[]
  sources: SourceInfo[]
  onScreen: (id: string) => void
  onSeries: (s: OpenSeries) => void
  onClose: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [follows, setFollows] = useState<FollowInfo[]>([])
  const [recent, setRecent] = useState<ProgressRecord[]>([])
  const [hits, setHits] = useState<SearchHit[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    input.current?.focus()
    void window.api.followList().then(setFollows)
    void window.api.progressRecent(12).then(setRecent)
  }, [])

  // titles on your sites, as you type (a short pause first so typing stays smooth)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.search(t, [], 'sites', 0, 12).then((r) => !cancelled && setHits(r.hits))
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  const siteName = (id: string): string => sources.find((s) => s.id === id)?.name ?? id
  const one = (r: { title: string; cover: string; coverReferer: string; sourceId: string; seriesUrl: string }): OpenSeries => ({
    title: r.title,
    cover: r.cover,
    coverReferer: r.coverReferer,
    entries: [{ sourceId: r.sourceId, sourceName: siteName(r.sourceId), url: r.seriesUrl }]
  })

  const items: Item[] = useMemo(() => {
    const want = norm(q.trim())
    const has = (s: string): boolean => !want || norm(s).includes(want)
    const out: Item[] = []
    for (const s of screens)
      if (has(s.label)) out.push({ key: 's:' + s.id, icon: s.icon, label: s.label, sub: 'Screen', run: () => onScreen(s.id) })
    const seen = new Set<string>()
    for (const r of recent) {
      if (!has(r.title) || seen.has(r.seriesUrl)) continue
      seen.add(r.seriesUrl)
      out.push({ key: 'r:' + r.seriesUrl, icon: 'play', label: r.title, sub: `Continue · ${r.chapterTitle || 'reading'} · ${siteName(r.sourceId)}`, run: () => onSeries(one(r)) })
    }
    for (const f of follows) {
      if (!f.following || !has(f.title) || seen.has(f.seriesUrl)) continue
      seen.add(f.seriesUrl)
      out.push({ key: 'f:' + f.seriesUrl, icon: 'bookmark', label: f.title, sub: `Following${f.unread ? ` · ${f.unread} new` : ''} · ${siteName(f.sourceId)}`, run: () => onSeries(one(f)) })
    }
    if (want)
      for (const h of hits) {
        if (h.entries.some((e) => seen.has(e.url))) continue
        out.push({
          key: 'h:' + h.key,
          icon: 'search',
          label: h.title,
          sub: h.entries.length > 1 ? `On ${h.entries.length} sites` : h.entries[0]?.sourceName ?? '',
          run: () => onSeries(h)
        })
      }
    return out.slice(0, want ? 40 : 14)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, screens, recent, follows, hits, sources])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (i: number): void => {
    const it = items[i]
    if (!it) return
    onClose()
    it.run()
  }

  return (
    <div className="qo-back" onMouseDown={onClose}>
      <div className="qo" role="dialog" aria-label="Quick open" onMouseDown={(e) => e.stopPropagation()}>
        <label className="qo-field">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            placeholder="Go to a screen, a series you read, or any title…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pick(sel)
              }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="qo-list" ref={list}>
          {items.length === 0 && <div className="qo-empty">{q.trim().length < 2 ? 'Type to search' : 'Nothing found'}</div>}
          {items.map((it, i) => (
            <button
              key={it.key}
              data-i={i}
              className={`qo-item${i === sel ? ' on' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(i)}
            >
              <Icon name={it.icon} />
              <span className="qo-label" dir="auto">
                {it.label}
              </span>
              <span className="qo-sub">{it.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
