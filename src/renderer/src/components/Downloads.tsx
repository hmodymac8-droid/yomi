import { useEffect, useState } from 'react'
import type { DownloadItem } from '../../../preload/index.d'

const mb = (b: number): string => (b / 1024 / 1024).toFixed(1) + ' MB'

export default function Downloads({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Record<string, DownloadItem>>({})

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

  const all = Object.values(items).sort((a, b) => a.queuedAt - b.queuedAt)
  const bySeries = new Map<string, DownloadItem[]>()
  for (const i of all) bySeries.set(i.seriesTitle, [...(bySeries.get(i.seriesTitle) ?? []), i])
  const active = all.filter((i) => i.status === 'queued' || i.status === 'downloading').length
  const total = all.filter((i) => i.status === 'done').reduce((s, i) => s + i.bytes, 0)

  return (
    <div className="series">
      <button className="back" onClick={onBack}>
        ← Back
      </button>
      <h2>Downloads</h2>
      <div className="meta">
        {all.filter((i) => i.status === 'done').length} saved · {mb(total)} on disk
        {active > 0 && ` · ${active} in progress`}
        {all.some((i) => i.status === 'error') && (
          <button
            className="mini"
            onClick={() =>
              window.api.downloadEnqueue(
                all
                  .filter((i) => i.status === 'error')
                  .map((i) => ({
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
      {all.length === 0 && (
        <div className="hint">Nothing downloaded yet. Open a series and press ⬇ on a chapter.</div>
      )}
      {[...bySeries.entries()].map(([title, list]) => (
        <section key={title} className="dlgroup">
          <h3>{title}</h3>
          {list.map((i) => (
            <div key={i.id} className="dlrow">
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
                <button className="mini" onClick={() => window.api.downloadRemove(i.id)}>
                  {i.status === 'done' ? 'delete' : 'remove'}
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
