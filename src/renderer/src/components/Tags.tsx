import type { SeriesDetail } from '../../../preload/index.d'

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Type, genre and status pills, shown only for what the series page actually told us. */
export function Tags({ detail, max = 6 }: { detail: Pick<SeriesDetail, 'type' | 'genres' | 'status'> | null | undefined; max?: number }): React.JSX.Element | null {
  if (!detail) return null
  const list = [
    ...(detail.type ? [cap(detail.type)] : []),
    ...(detail.genres ?? []).slice(0, max),
    ...(detail.status ? [cap(detail.status)] : [])
  ]
  if (list.length === 0) return null
  return (
    <div className="tags">
      {list.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </div>
  )
}
