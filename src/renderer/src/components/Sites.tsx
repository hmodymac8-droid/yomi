import { useCallback, useEffect, useState } from 'react'
import GenreProgress from './GenreProgress'
import type { SiteHealth, SourceInfo } from '../../../preload/index.d'

const ago = (t: number): string => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'
  return Math.round(s / 86400) + ' d ago'
}

type Level = 'ok' | 'warn' | 'fail' | 'unknown'

/** One word for the site: the last Re-check if there is one, otherwise how your recent series opens went. */
export function levelOf(h: SiteHealth | undefined): Level {
  if (!h) return 'unknown'
  const opens = h.ok + h.incomplete + h.failed
  if (h.check) {
    const fresh = h.lastAt <= h.check.at // no series opened since the check
    if (h.check.overall === 'fail') return 'fail'
    if (!fresh && opens >= 3 && h.failed / opens > 0.5) return 'fail'
    if (h.check.overall === 'warn') return 'warn'
    if (!fresh && opens >= 3 && (h.failed + h.incomplete) / opens > 0.3) return 'warn'
    return 'ok'
  }
  if (opens === 0) return 'unknown'
  if (h.failed / opens > 0.5) return 'fail'
  if ((h.failed + h.incomplete) / opens > 0.3) return 'warn'
  return 'ok'
}

const LABEL: Record<Level, string> = { ok: 'Working', warn: 'Needs a look', fail: 'Broken', unknown: 'Not checked yet' }

export default function Sites({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [health, setHealth] = useState<Record<string, SiteHealth>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    const [s, h] = await Promise.all([window.api.listSources(), window.api.siteHealth()])
    setSources(s)
    setHealth(Object.fromEntries(h.map((x) => [x.sourceId, x])))
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 4000) // titles keep arriving while a scan runs
    return () => clearInterval(t)
  }, [refresh])

  const check = async (id: string): Promise<void> => {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      const h = await window.api.siteCheck(id)
      setHealth((prev) => ({ ...prev, [id]: h }))
      setOpen((o) => ({ ...o, [id]: true }))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const [gstat, setGstat] = useState<Awaited<ReturnType<typeof window.api.genreStatus>> | null>(null)
  const refreshGenres = (): void => void window.api.genreStatus().then(setGstat)
  useEffect(() => {
    refreshGenres()
    const t = setInterval(refreshGenres, 4000)
    return () => clearInterval(t)
  }, [])

  const checkAll = async (): Promise<void> => {
    // one after another: each check opens real pages on the site
    for (const s of sources) await check(s.id)
  }

  const anyBusy = Object.values(busy).some(Boolean)
  const order: Record<Level, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 }
  const rows = [...sources].sort((a, b) => order[levelOf(health[a.id])] - order[levelOf(health[b.id])])

  return (
    <div className="series">
      <div className="pagehead">
        <div>
          <div className="kicker">サイト</div>
          <h1>Sites</h1>
          <p>
            {sources.length} sites · {sources.reduce((n, s) => n + s.count, 0).toLocaleString()} titles merged. Re-check tests a
            site like you would use it: title list, a chapter list, a chapter&apos;s pages and one image.
          </p>
        </div>
        <div className="pageact">
          <button onClick={() => void checkAll()} disabled={anyBusy || sources.length === 0}>
            {anyBusy ? 'Checking…' : 'Re-check all'}
          </button>
          <button className="primary" onClick={onBack}>
            Add site
          </button>
        </div>
      </div>
      <GenreProgress startOpen />
      {sources.length === 0 && <div className="hint">No sites yet. Add one from the main screen.</div>}
      {rows.map((s) => {
        const h = health[s.id]
        const level = levelOf(h)
        const opens = h ? h.ok + h.incomplete + h.failed : 0
        return (
          <div className="siterow" key={s.id}>
            <div className="sitehead">
              <span className={'dot ' + level} title={LABEL[level]} />
              <div className="sitename">
                <b>{s.name}</b>
                <span className="sub">{s.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              </div>
              <span className={'lvl ' + level}>{LABEL[level]}</span>
              <span className="sub">
                {s.count.toLocaleString()} titles{s.crawling ? ' · scanning…' : ''}
              </span>
              <span className="sub genrestat">
                {gstat?.progress[s.id] ??
                  (gstat?.sites[s.id]?.running
                    ? 'reading genres…'
                    : gstat?.sites[s.id]
                      ? gstat.sites[s.id].titles > 0
                        ? `genres: ${gstat.sites[s.id].genres} · ${gstat.sites[s.id].titles.toLocaleString()} titles tagged · ${ago(gstat.sites[s.id].at)}`
                        : 'no genre pages this site lets the app read'
                      : 'genres: not read yet')}
              </span>
              <span className="grow" />
              <button className="mini" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                {open[s.id] ? 'Hide details' : 'Details'}
              </button>
              <button className="mini" disabled={s.crawling} onClick={() => void window.api.crawl(s.id)}>
                Re-scan titles
              </button>
              <button
                className="mini"
                disabled={!!gstat && Object.values(gstat.sites).some((x) => x.running)}
                title="Read this site's genre pages now, so its titles can be filtered by genre"
                onClick={() => void window.api.genreScanNow(s.id).then(() => setTimeout(refreshGenres, 800))}
              >
                Read genres
              </button>
              <button className="mini on" disabled={!!busy[s.id]} onClick={() => void check(s.id)}>
                {busy[s.id] ? 'Checking…' : 'Re-check'}
              </button>
            </div>
            {open[s.id] && (
              <div className="sitebody">
                <div className="sub">
                  {opens > 0
                    ? `Your last ${opens} series opens: ${h!.ok} fine, ${h!.incomplete} cut short, ${h!.failed} failed` +
                      (h!.lastAt ? ` (latest ${ago(h!.lastAt)})` : '')
                    : 'No series opened from this site yet.'}
                  {h?.lastError && h.failed > 0 && <span className="bad"> · last error: {h.lastError}</span>}
                </div>
                {h?.check ? (
                  <>
                    <div className="sub">Last re-check {ago(h.check.at)}:</div>
                    {h.check.steps.map((st) => (
                      <div className="step" key={st.name}>
                        <span className={'dot small ' + st.status} />
                        <span className="stepname">{st.name}</span>
                        <span className="stepdetail">{st.detail}</span>
                        <span className="sub">{(st.ms / 1000).toFixed(1)} s</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="sub">Not re-checked yet. Press Re-check.</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
