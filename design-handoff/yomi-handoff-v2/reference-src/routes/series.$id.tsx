import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDownUp, ArrowLeft, Check, Download, Play, RefreshCw, Star } from "lucide-react";
import { getSeries } from "@/lib/data";

export const Route = createFileRoute("/series/$id")({
  head: ({ params }) => {
    const s = getSeries(params.id);
    return {
      meta: [
        { title: `${s.title} — Yomi` },
        { name: "description", content: s.synopsis || `Read ${s.title} in Yomi.` },
        { property: "og:title", content: `${s.title} — Yomi` },
        { property: "og:description", content: s.synopsis || `Read ${s.title} in Yomi.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: SeriesPage,
});

function SeriesPage() {
  const { id } = Route.useParams();
  const s = getSeries(id);
  const [src, setSrc] = useState(s.sources[0]);
  const [desc, setDesc] = useState(true);
  const [following, setFollowing] = useState(!!s.newCh);
  const read = s.read ?? 0;
  const list = Array.from({ length: s.chapters }, (_, i) => s.chapters - i);
  const ordered = desc ? list : [...list].reverse();

  return (
    <div className="pb-16">
      <div className="border-b border-border bg-secondary/55">
        <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
          <Link to="/" className="mb-7 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary-text"><ArrowLeft size={14} /> Back to Discover</Link>
          <div className="flex flex-col gap-7 sm:flex-row sm:gap-9 lg:gap-12">
            <div className="w-36 shrink-0 sm:w-48 lg:w-52">
              <img src={s.cover} alt={s.title} loading="lazy" decoding="async" width={340} height={474} className="aspect-[5/7] w-full rounded-sm border border-border object-cover shadow-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                {[s.type, ...s.genres, s.status].map((g) => <span key={g} className="rounded-sm border border-border bg-background px-2.5 py-1">{g}</span>)}
              </div>
              <h1 className="mt-4 max-w-3xl font-display text-4xl font-medium leading-[1.08] tracking-tight sm:text-5xl">{s.title}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{s.synopsis || "No description from this site yet."}</p>

              <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
                <span className="mr-1 text-xs text-muted-foreground">Read from</span>
                {s.sources.map((x) => (
                  <button key={x} onClick={() => setSrc(x)} className={`rounded-sm px-3 py-1.5 text-[11px] font-medium transition ${src === x ? "bg-accent text-accent-foreground" : "border border-border bg-background text-muted-foreground hover:text-foreground"}`}>{x}</button>
                ))}
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-2.5">
                <Link to="/read/$id" params={{ id: s.id }} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                  <Play size={14} fill="currentColor" /> {read ? `Continue · Chapter ${read + 1}` : "Start reading"}
                </Link>
                <button onClick={() => setFollowing(!following)} className={`inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-xs font-medium transition ${following ? "border-peach/50 bg-peach-soft text-peach-foreground" : "border-border bg-background hover:bg-muted"}`}>
                  <Star size={14} fill={following ? "currentColor" : "none"} /> {following ? "Following" : "Follow"}
                </button>
                <button className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-xs font-medium hover:bg-muted"><Download size={14} /> Download unread ({s.chapters - read})</button>
              </div>
              <div className="mt-7 flex gap-8 text-sm">
                <Stat n={s.chapters} l="chapters" /><Stat n={read} l="read" /><Stat n={s.sources.length} l="sources" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-[1500px] px-5 pt-9 sm:px-8 lg:px-10">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-text">{src}</p>
            <h2 className="mt-1 font-display text-[28px] font-medium tracking-tight">Chapters</h2>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            <button onClick={() => setDesc(!desc)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3 py-2 font-medium text-muted-foreground hover:text-foreground"><ArrowDownUp size={13} /> {desc ? "Newest first" : "Oldest first"}</button>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3 py-2 font-medium text-muted-foreground hover:text-foreground"><RefreshCw size={13} /> Check for new</button>
          </div>
        </div>
        <div className="border-y border-border">
          {ordered.slice(0, 30).map((n) => {
            const isRead = n <= read;
            const next = n === read + 1;
            return (
              <Link key={n} to="/read/$id" params={{ id: s.id }} className={`group flex items-center gap-2 border-b border-border px-2 py-3.5 text-sm last:border-0 transition hover:bg-secondary/70 sm:gap-4 sm:px-4 ${next ? "bg-accent/45" : "bg-transparent"}`}>
                <span className={`w-24 text-xs font-medium sm:w-28 sm:text-sm ${isRead ? "text-muted-foreground" : "text-foreground"}`}>Chapter {n}</span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {next && <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">Up next</span>}
                  {n > s.chapters - (s.newCh ?? 0) && <span className="rounded-sm bg-peach-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-peach-foreground">New</span>}
                </div>
                <span className="hidden text-right text-[11px] text-muted-foreground sm:block">{src} · {Math.max(1, s.chapters - n + 1)}d ago</span>
                {isRead ? <Check size={15} className="ml-1 shrink-0 text-success" /> : <span className="w-4 shrink-0" />}
                <button aria-label={`Download chapter ${n}`} onClick={(e) => e.preventDefault()} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"><Download size={14} /></button>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return <div><p className="font-display text-2xl font-medium">{n}</p><p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{l}</p></div>;
}
