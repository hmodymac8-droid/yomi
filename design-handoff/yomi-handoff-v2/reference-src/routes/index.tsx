import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, Play, Plus, RefreshCw, Bookmark } from "lucide-react";
import { catalog, series, sites } from "@/lib/data";
import { Cover, SectionHead } from "@/components/yomi/Cover";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discover — Yomi" },
      { name: "description", content: "Browse one catalog built from every manga site you've added to Yomi." },
      { property: "og:title", content: "Discover — Yomi" },
      { property: "og:description", content: "Browse one catalog built from every manga site you've added to Yomi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Discover,
});

const filters = ["All", "Manga", "Manhwa", "Manhua"];

function Discover() {
  const [hero, setHero] = useState(0);
  const [f, setF] = useState("All");
  const h = series[hero]!;
  const grid = catalog.filter((s) => f === "All" || s.type === f);
  const updates = series.filter((s) => s.newCh);
  const reading = series.filter((s) => s.read);

  return (
    <div className="mx-auto max-w-[1600px] px-5 pb-16 sm:px-8 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 py-8 sm:py-10">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-text">Your combined catalog</p>
          <h1 className="mt-1 font-display text-[46px] font-medium leading-none tracking-tight">Discover</h1>
          <p className="mt-2.5 text-sm text-muted-foreground">One quiet place for every series you follow.</p>
        </div>
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">338,170</span> titles · {sites.length} sites</p>
      </header>

      <div className="flex flex-col gap-3 border-y border-border py-4 md:flex-row md:items-center">
        <p className="text-xs leading-relaxed text-muted-foreground md:max-w-[360px]"><span className="font-medium text-foreground">Add a site</span> — paste any manga site's address and it joins your catalog.</p>
        <div className="flex min-w-0 flex-1 items-center border border-border bg-paper md:ml-auto md:max-w-md">
          <input aria-label="Manga site address" placeholder="https://" suppressHydrationWarning className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground" />
          <button className="m-1 inline-flex items-center gap-1.5 rounded-sm bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"><Plus size={14} /> Add</button>
        </div>
      </div>

      <section className="border-b border-border py-10 sm:py-12">
        <div className="grid items-center gap-8 md:grid-cols-[120px_minmax(0,1fr)] lg:grid-cols-[130px_minmax(0,1fr)_240px] lg:gap-12">
          <Link to="/series/$id" params={{ id: h.id }} className="group order-2 block w-28 md:order-1 md:w-full">
            <img src={h.cover} alt={h.title} decoding="async" width={340} height={474} style={{ maxWidth: 140 }} className="aspect-[5/7] w-full rounded-sm border border-border object-cover shadow-cover transition group-hover:border-primary/50" />
          </Link>
          <div className="order-1 min-w-0 md:order-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-peach-foreground">Continue · Chapter {(h.read ?? 0) + 1}</p>
            <h2 className="mt-3 max-w-xl font-display text-4xl font-medium leading-[1.05] tracking-tight text-foreground sm:text-5xl">{h.title}</h2>
            <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
              {[h.type, ...h.genres, h.status].map((g) => <span key={g} className="rounded-sm border border-border bg-paper px-2.5 py-1">{g}</span>)}
            </div>
            <p className="mt-5 line-clamp-3 max-w-xl text-sm leading-6 text-muted-foreground">{h.synopsis}</p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link to="/read/$id" params={{ id: h.id }} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">
                <Play size={14} fill="currentColor" /> Read now
              </Link>
              <Link to="/series/$id" params={{ id: h.id }} className="inline-flex items-center gap-2 rounded-md border border-border bg-paper px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                <Bookmark size={14} /> Details
              </Link>
            </div>
          </div>
          <div className="hidden self-stretch border-l border-border pl-6 lg:order-3 lg:block">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Featured series</p>
            {series.map((s, i) => (
              <button key={s.id} onClick={() => setHero(i)} className={`flex w-full items-baseline gap-3 border-b border-border py-3 text-left last:border-0 ${i === hero ? "text-primary-text" : "text-muted-foreground hover:text-foreground"}`}>
                <span className="text-[10px] tabular-nums">0{i + 1}</span>
                <span className="line-clamp-2 text-xs font-medium leading-snug">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="no-scrollbar mt-8 flex gap-2 overflow-x-auto lg:hidden">
          {series.map((s, i) => (
            <button key={s.id} aria-label={`Show ${s.title}`} onClick={() => setHero(i)} className={`h-16 w-11 shrink-0 overflow-hidden rounded-sm border-2 transition ${i === hero ? "border-primary" : "border-transparent opacity-55 hover:opacity-90"}`}>
              <img src={s.cover} alt="" loading="lazy" decoding="async" width={340} height={474} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </section>

      <section className="border-b border-border py-10">
        <SectionHead kicker="Following · checked 24 min ago" title="New chapters" action={
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" /> Auto-download</label>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3 py-2 font-medium hover:bg-muted hover:text-foreground"><RefreshCw size={13} /> Check now</button>
          </div>
        } />
        <div className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">
          {updates.map((s) => (
            <Link key={s.id} to="/read/$id" params={{ id: s.id }} className="group cv-sm flex items-center gap-4 border-t border-border py-4 transition hover:bg-secondary/60">
              <img src={s.cover} alt="" loading="lazy" decoding="async" width={340} height={474} className="h-20 w-14 rounded-sm border border-border object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium group-hover:text-primary-text">{s.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">Chapter {s.chapters} · just now</p>
                <span className="mt-2 inline-block rounded-sm bg-peach-soft px-1.5 py-0.5 text-[10px] font-semibold text-peach-foreground">+{s.newCh} new</span>
              </div>
              <Play size={16} className="mr-2 text-muted-foreground transition group-hover:text-primary-text" />
            </Link>
          ))}
        </div>
      </section>

      <section className="border-b border-border py-10">
        <SectionHead kicker="Pick up where you stopped" title="Continue reading" />
        <div className="no-scrollbar -mx-1 flex gap-5 overflow-x-auto px-1 pb-2">
          {reading.map((s) => (
            <div key={s.id} className="w-36 shrink-0 sm:w-40"><Cover s={s} showProgress sub={`Ch. ${s.read} of ${s.chapters}${s.progress ? ` · ${s.progress}%` : ""}`} /></div>
          ))}
        </div>
      </section>

      <section className="pt-10">
        <SectionHead kicker="183,898 titles" title="All titles" action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 border-b border-border">
              {filters.map((x) => (
                <button key={x} onClick={() => setF(x)} className={`border-b-2 px-3 py-2 text-xs font-medium transition ${f === x ? "border-primary text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{x}</button>
              ))}
            </div>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">All sites ({sites.length}) <ChevronDown size={13} /></button>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">Latest update <ChevronDown size={13} /></button>
          </div>
        } />
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
          {grid.map((s) => <Cover key={s.id} s={s} />)}
        </div>
        <p className="mt-10 text-center text-xs text-muted-foreground">Scroll to load more · page 1 of 3,065</p>
      </section>
    </div>
  );
}
