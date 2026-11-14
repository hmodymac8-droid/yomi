import { useEffect, useState } from 'react'
import type { SearchHit } from '../../../preload/index.d'
import { coverSrc, fallbackCover, type OpenSeries } from '../lib'

/** One row of title cards (the same cards as Discover), for "Similar" and "Because you read". */
export function HitStrip({
  label,
  hits,
  onOpen
}: {
  label: React.ReactNode
  hits: SearchHit[]
  onOpen: (s: OpenSeries) => void
}): React.JSX.Element | null {
  if (hits.length === 0) return null
  return (
    <section className="continue similar">
      <div className="meta">{label}</div>
      <div className="strip">
        {hits.map((h) => (
          <button key={h.key} className="card small" onClick={() => onOpen(h)}>
            <div className="cover" data-letter={h.title.trim().slice(0, 1).toUpperCase()}>
              {h.cover ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={coverSrc(h.cover, h.coverReferer)}
                  onError={(e) => fallbackCover(e, h.coverFallback, h.coverReferer)}
                />
              ) : (
                <div className="ph">{h.title.trim().slice(0, 1).toUpperCase()}</div>
              )}
            </div>
            <div className="name" title={h.title}>
              {h.title}
            </div>
            <div className="from">
              {h.entries.length > 1 ? `${h.entries.length} sites` : h.entries[0]?.sourceName}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

/** "Similar on your sites" for a series page: AniList's recommendations that you can open. */
export function SimilarRow({
  title,
  seriesUrl,
  onOpen
}: {
  title: string
  seriesUrl: string
  onOpen: (s: OpenSeries) => void
}): React.JSX.Element | null {
  // the answer remembers which title it is for, so a new title never shows the previous one's row
  const [got, setGot] = useState<{ for: string; hits: SearchHit[] }>({ for: '', hits: [] })
  const want = `${title}|${seriesUrl}`
  useEffect(() => {
    let cancelled = false
    if (!title) return
    void window.api
      .recsSimilar(title, seriesUrl)
      .then((h) => !cancelled && setGot({ for: want, hits: h }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [title, seriesUrl, want])
  return (
    <HitStrip
      label="Similar on your sites"
      hits={got.for === want ? got.hits : []}
      onOpen={onOpen}
    />
  )
}

/** "Because you read X" rows for Discover. */
export function BecauseYouRead({
  onOpen
}: {
  onOpen: (s: OpenSeries) => void
}): React.JSX.Element | null {
  const [rows, setRows] = useState<{ title: string; hits: SearchHit[] }[]>([])
  useEffect(() => {
    let cancelled = false
    void window.api
      .recsBecause()
      .then((r) => !cancelled && setRows(r))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <>
      {rows.map((r) => (
        <HitStrip
          key={r.title}
          label={
            <>
              Because you read <em>{r.title}</em>
            </>
          }
          hits={r.hits}
          onOpen={onOpen}
        />
      ))}
    </>
  )
}
