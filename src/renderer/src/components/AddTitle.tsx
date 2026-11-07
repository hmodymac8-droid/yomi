import { useState } from 'react'
import type { OpenSeries } from '../lib'
import { proxied } from '../lib'

interface Added {
  sourceId: string
  sourceName: string
  url: string
  title: string
  cover: string
  chapters: number
  siteIsNew: boolean
  already: boolean
}

const KEY = 'addedTitles'
function loadRecent(): Added[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

/** Paste the address of ONE title's page: it is added to the catalog (the site is not scanned) and can be read or downloaded. */
export default function AddTitle({ onBack, onOpen }: { onBack: () => void; onOpen: (s: OpenSeries) => void }): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [recent, setRecent] = useState<Added[]>(loadRecent)

  const origin = (a: Added): string => {
    try {
      return new URL(a.url).origin + '/'
    } catch {
      return ''
    }
  }
  const open = (a: Added): void =>
    onOpen({
      title: a.title,
      cover: a.cover,
      coverReferer: origin(a),
      entries: [{ sourceId: a.sourceId, sourceName: a.sourceName, url: a.url }]
    })

  const add = async (andDownload: boolean): Promise<void> => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const r = await window.api.titleAdd(url.trim())
      if (!r.ok) {
        setError(r.error)
        return
      }
      const a = r.data
      const next = [a, ...recent.filter((x) => x.url !== a.url)].slice(0, 30)
      setRecent(next)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* not critical */
      }
      setUrl('')
      if (andDownload) await downloadAll(a)
      else setMsg(`${a.already ? 'Updated' : 'Added'} "${a.title}" (${a.chapters} chapters).`)
    } finally {
      setBusy(false)
    }
  }

  const downloadAll = async (a: Added): Promise<void> => {
    setMsg('Reading the chapter list…')
    const d = await window.api.getSeries(a.sourceId, a.url, 'auto')
    if (!d.ok) {
      setError(d.error)
      setMsg('')
      return
    }
    window.api.downloadEnqueue(
      d.data.chapters.map((c) => ({
        chapterUrl: c.url,
        alts: c.alts,
        chapterTitle: c.title,
        seriesUrl: a.url,
        seriesTitle: d.data.title || a.title,
        sourceId: a.sourceId,
        referer: origin(a)
      }))
    )
    setMsg(`Queued ${d.data.chapters.length} chapters of "${a.title}". Watch them in Downloads.`)
  }

  return (
    <div className="series">
      <button className="back" onClick={onBack}>
        ← Back
      </button>
      <h2>Add a title</h2>
      <div className="sub">
        Copy the address of one manga/manhwa page from any site, paste it here, and it is added to your catalog. The rest of the
        site is not scanned.
      </div>
      <div className="sitesbar" style={{ marginTop: 14 }}>
        <span className="add" style={{ flex: 1 }}>
          <input
            style={{ flex: 1, minWidth: 260 }}
            placeholder="Paste the title's page address (for example https://site.com/book/12345)"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add(false)}
          />
          <button onClick={() => void add(false)} disabled={busy || !url.trim()}>
            {busy ? 'Reading…' : 'Add title'}
          </button>
          <button onClick={() => void add(true)} disabled={busy || !url.trim()} title="Add it and queue every chapter for download">
            Add + download all
          </button>
        </span>
      </div>
      {error && <div className="hint bad">{error}</div>}
      {msg && <div className="hint">{msg}</div>}

      {recent.length > 0 && <h3 style={{ marginTop: 22 }}>Added by address</h3>}
      <div className="grid">
        {recent.map((a) => (
          <div key={a.url} className="card" onClick={() => open(a)} title={a.url}>
            <div className="cover">{a.cover && <img loading="lazy" src={proxied(a.cover, origin(a))} />}</div>
            <div className="name" title={a.title}>
              {a.title}
            </div>
            <div className="sub">
              {a.sourceName} · {a.chapters} ch
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
