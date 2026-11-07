import { useEffect, useState } from 'react'
import type { GenreJob } from '../../../preload/index.d'

/** "about 2 h 10 min" */
export function timeLeft(ms: number | null): string {
  if (ms === null) return 'working out the time…'
  const min = Math.round(ms / 60000)
  if (min < 1) return 'less than a minute left'
  if (min < 60) return `about ${min} min left`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `about ${h} h${m ? ` ${m} min` : ''} left`
}

/**
 * Shows the background genre reading as it happens: every site, what it is doing, how far it got and about how long
 * is left, so you know when the genre filter will cover your titles. Hidden once every site is done.
 */
export default function GenreProgress({ startOpen = false }: { startOpen?: boolean }): React.JSX.Element | null {
  const [jobs, setJobs] = useState<GenreJob[]>([])
  const [open, setOpen] = useState(startOpen)
  useEffect(() => {
    let alive = true
    const load = (): void => void window.api.genreJobs().then((j) => alive && setJobs(j))
    load()
    const t = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const active = jobs.filter((j) => j.state === 'running' || j.state === 'waiting' || j.state === 'paused')
  if (active.length === 0) return null
  const counted = jobs.filter((j) => j.state !== 'skipped')
  const doneCount = counted.filter((j) => j.state === 'done').length
  const runningEtas = jobs.filter((j) => j.state === 'running').map((j) => j.etaMs)
  const known = runningEtas.filter((x): x is number => x !== null)
  const longest = known.length ? Math.max(...known) : null
  const tagged = jobs.reduce((n, j) => n + j.tagged, 0)

  return (
    <section className="genreprog">
      <button className="gp-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="gp-spin" aria-hidden="true" />
        <span className="gp-title">
          <b>Loading genres</b> · {doneCount} of {counted.length} sites done · {tagged.toLocaleString()} titles have genres so far
        </span>
        <span className="gp-eta">{longest !== null ? timeLeft(longest) : 'starting…'}</span>
        <span className="gp-more">{open ? 'Hide' : 'Details'}</span>
      </button>
      {open && (
        <div className="gp-list">
          <p className="gp-note">
            Yomi reads each site&apos;s genre pages (or each title&apos;s page) in the background, every site at its own gentle
            pace so none of them gets more than an ordinary reader&apos;s traffic. It keeps going after a restart. Opening a title
            loads its genres straight away.
          </p>
          {jobs.map((j) => {
            const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0
            return (
              <div key={j.id} className={`gp-row ${j.state}`}>
                <span className="gp-name">{j.name}</span>
                <span className="gp-phase">
                  {j.state === 'done'
                    ? 'Done'
                    : j.state === 'skipped'
                      ? 'Not read (genres load when you open a title)'
                      : j.state === 'paused'
                        ? j.note ?? 'Paused'
                        : j.state === 'waiting'
                          ? 'Waiting to start'
                          : `${j.phase}${j.total ? ` · ${j.done.toLocaleString()} of ${j.total.toLocaleString()}` : ''}${j.detail ? ` · ${j.detail}` : ''}`}
                </span>
                <span className="gp-bar">
                  <span style={{ width: `${j.state === 'done' ? 100 : pct}%` }} />
                </span>
                <span className="gp-left">{j.state === 'running' ? timeLeft(j.etaMs) : ''}</span>
                <span className="gp-count">
                  {j.tagged.toLocaleString()} / {j.titles.toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
