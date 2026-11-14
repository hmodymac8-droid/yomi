import { useEffect, useState } from 'react'
import type { AniListLink, AniListMediaInfo, AniListStatus } from '../../../preload/index.d'

interface Props {
  seriesUrl: string
  title: string
}

export default function AniListLinkPanel({ seriesUrl, title }: Props): React.JSX.Element {
  const [status, setStatus] = useState<AniListStatus | null>(null)
  const [link, setLink] = useState<AniListLink | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(title)
  const [hits, setHits] = useState<AniListMediaInfo[]>([])
  const [suggested, setSuggested] = useState<AniListMediaInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api.anilistStatus().then((s) => !cancelled && setStatus(s))
    void window.api.anilistLinkFor(seriesUrl).then((l) => !cancelled && setLink(l))
    return () => {
      cancelled = true
    }
  }, [seriesUrl])

  useEffect(() => {
    setQuery(title)
  }, [title])

  if (!status) return <></>

  const search = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.api.anilistSearch(query.trim() || title)
      setHits(r.hits)
      setSuggested(r.suggested)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (media: AniListMediaInfo): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setLink(await window.api.anilistLink(seriesUrl, media))
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.api.anilistUnlink(seriesUrl)
      setLink(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="resume anilistrow">
      <span className="anilistlabel">AniList</span>
      {!status.connected ? (
        <span className="count">Connect AniList in Settings to track this series.</span>
      ) : link && !open ? (
        <>
          <span className="count">
            Linked to {link.title}
            {link.siteUrl && (
              <>
                {' '}
                <a href={link.siteUrl} target="_blank" rel="noreferrer">
                  open
                </a>
              </>
            )}
          </span>
          <button
            className="mini"
            disabled={busy}
            onClick={() => {
              setOpen(true)
              setQuery(title)
              setHits([])
              setSuggested(null)
              setError('')
            }}
          >
            Change
          </button>
          <button className="mini" disabled={busy} onClick={() => void unlink()}>
            Unlink
          </button>
        </>
      ) : !open ? (
        <button
          className="mini big"
          disabled={busy}
          onClick={() => {
            setOpen(true)
            setError('')
            void search()
          }}
        >
          Link to AniList
        </button>
      ) : null}

      {open && status.connected && (
        <div className="anilistpicker">
          <form
            className="anilistsearch"
            onSubmit={(e) => {
              e.preventDefault()
              void search()
            }}
          >
            <input
              className="setfield"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search AniList"
              aria-label="Search AniList"
            />
            <button className="mini" type="submit" disabled={busy}>
              {busy ? 'Searching…' : 'Search'}
            </button>
            <button
              className="mini"
              type="button"
              onClick={() => {
                setOpen(false)
                setError('')
              }}
            >
              Cancel
            </button>
          </form>
          {suggested && (
            <div className="anilistSuggest">
              Suggested: {suggested.title}
              <button className="mini" disabled={busy} onClick={() => void confirm(suggested)}>
                Use this
              </button>
            </div>
          )}
          <ul className="anilistHits">
            {hits.map((h) => (
              <li key={h.id}>
                <button disabled={busy} onClick={() => void confirm(h)}>
                  {h.title}
                  {h.format ? <small> · {h.format}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="sub">{error}</div>}
    </div>
  )
}
