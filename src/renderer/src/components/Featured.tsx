import { useEffect, useState } from 'react'
import type { FollowInfo, ProgressRecord, SeriesDetail, SourceInfo } from '../../../preload/index.d'
import { OpenChapter, OpenSeries, proxied } from '../lib'
import { Icon } from './Icon'
import { Tags } from './Tags'

interface Pick {
  seriesUrl: string
  sourceId: string
  title: string
  cover: string
  coverReferer: string
  /** what the small line above the title says */
  eyebrow: string
  /** the chapter "Read now" opens */
  chapterUrl?: string
  detail: SeriesDetail
}

interface Props {
  recent: ProgressRecord[]
  follows: FollowInfo[]
  sources: SourceInfo[]
  onOpen: (s: OpenSeries) => void
  onRead: (s: OpenSeries, c: OpenChapter) => void
}

/**
 * The series you are in the middle of, big, with a numbered switcher. Built only from real data: what you are
 * reading and following, with the description saved when its page was last read. Nothing to show = no section.
 */
export default function Featured({ recent, follows, sources, onOpen, onRead }: Props): React.JSX.Element | null {
  const [picks, setPicks] = useState<Pick[]>([])
  const [sel, setSel] = useState(0)

  const key = recent.map((r) => r.seriesUrl + r.chapterUrl).join('|') + '#' + follows.map((f) => f.seriesUrl + f.unread).join('|')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cands: Omit<Pick, 'detail'>[] = []
      const seen = new Set<string>()
      for (const r of recent) {
        if (seen.has(r.seriesUrl)) continue
        seen.add(r.seriesUrl)
        cands.push({
          seriesUrl: r.seriesUrl,
          sourceId: r.sourceId,
          title: r.title,
          cover: r.cover,
          coverReferer: r.coverReferer,
          eyebrow: `Continue · ${r.chapterTitle}`,
          chapterUrl: r.chapterUrl
        })
      }
      for (const f of follows) {
        if (seen.has(f.seriesUrl)) continue
        seen.add(f.seriesUrl)
        cands.push({
          seriesUrl: f.seriesUrl,
          sourceId: f.sourceId,
          title: f.title,
          cover: f.cover,
          coverReferer: f.coverReferer,
          eyebrow: f.unread > 0 ? `Following · ${f.unread} new` : 'Following'
        })
      }
      const out: Pick[] = []
      for (const c of cands) {
        if (out.length >= 6) break
        const d = await window.api.getSeriesCached(c.seriesUrl).catch(() => null)
        if (d && d.description && d.description.trim().length > 20) out.push({ ...c, detail: d })
      }
      if (!cancelled) {
        setPicks(out)
        setSel((s) => (s < out.length ? s : 0))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (picks.length === 0) return null
  const p = picks[Math.min(sel, picks.length - 1)]
  const name = sources.find((s) => s.id === p.sourceId)?.name ?? p.sourceId
  const series: OpenSeries = {
    title: p.title,
    cover: p.cover || p.detail.cover,
    coverReferer: p.coverReferer,
    entries: [{ sourceId: p.sourceId, sourceName: name, url: p.seriesUrl }]
  }
  const chapters = p.detail.chapters
  // "Read now": the chapter you stopped in, or the first one (lists are newest first)
  const target = chapters.find((c) => c.url === p.chapterUrl) ?? chapters[chapters.length - 1]
  const read = (): void => {
    if (!target) return onOpen(series)
    onRead(series, {
      url: target.url,
      title: target.title,
      chapters,
      referer: new URL(p.seriesUrl).origin + '/',
      seriesUrl: p.seriesUrl,
      sourceId: p.sourceId
    })
  }

  return (
    <section className="featured">
      <button className="fcover" onClick={() => onOpen(series)} aria-label={`Open ${p.title}`}>
        {series.cover && <img src={proxied(series.cover, p.coverReferer)} alt="" width={140} height={196} decoding="async" />}
      </button>
      <div className="fbody">
        <div className="eyebrow peach">{p.eyebrow}</div>
        <h2>{p.title}</h2>
        <Tags detail={p.detail} />
        <p className="fdesc" dir="auto">{p.detail.description}</p>
        <div className="factions">
          <button className="primary withicon" onClick={read}>
            <Icon name="play" /> Read now
          </button>
          <button className="secondary withicon" onClick={() => onOpen(series)}>
            <Icon name="bookmark" /> Details
          </button>
        </div>
      </div>
      {picks.length > 1 && (
        <ol className="flist">
          <li className="flabel">Featured series</li>
          {picks.map((x, i) => (
            <li key={x.seriesUrl}>
              <button className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
                <span className="fnum">{String(i + 1).padStart(2, '0')}</span>
                <span className="ftitle">{x.title}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
