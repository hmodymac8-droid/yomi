import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize2, Minus, Plus, List } from "lucide-react";
import page from "@/assets/page-1.jpg";
import { getSeries } from "@/lib/data";
import { ThemeToggle } from "@/components/yomi/Shell";

export const Route = createFileRoute("/read/$id")({
  head: ({ params }) => {
    const s = getSeries(params.id);
    return {
      meta: [
        { title: `Reading ${s.title} — Yomi` },
        { name: "description", content: `Read ${s.title} in Yomi's ad-free vertical reader.` },
        { property: "og:title", content: `Reading ${s.title} — Yomi` },
        { property: "og:description", content: `Read ${s.title} in Yomi's ad-free vertical reader.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: Reader,
});

function Reader() {
  const { id } = Route.useParams();
  const s = getSeries(id);
  const ch = (s.read ?? 0) + 1;
  const [width, setWidth] = useState(720);
  const [pct, setPct] = useState(0);

  return (
    <div className="relative h-full bg-reader">
      <div className="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 sm:gap-4 sm:px-5">
        <Link aria-label="Back to chapters" to="/series/$id" params={{ id: s.id }} className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-muted"><ArrowLeft size={17} /></Link>
        <div className="min-w-0 flex-1 md:flex-none">
          <p className="truncate text-xs font-medium sm:text-sm">{s.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-xs">Chapter {ch} · {s.sources[0]}</p>
        </div>
        <div className="flex items-center gap-1 md:ml-auto">
          <button aria-label="Previous chapter" className="hidden h-9 w-9 place-items-center rounded-md hover:bg-muted sm:grid"><ChevronLeft size={17} /></button>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3 py-2 text-[11px] font-medium"><List size={13} /> Ch. {ch}</button>
          <button aria-label="Next chapter" className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted"><ChevronRight size={17} /></button>
          <span className="mx-2 hidden h-5 w-px bg-border md:block" />
          <button aria-label="Reduce page width" onClick={() => setWidth((w) => Math.max(480, w - 80))} className="hidden h-9 w-9 place-items-center rounded-md hover:bg-muted md:grid"><Minus size={15} /></button>
          <span className="hidden w-12 text-center text-[11px] tabular-nums text-muted-foreground md:block">{width}px</span>
          <button aria-label="Increase page width" onClick={() => setWidth((w) => Math.min(1100, w + 80))} className="hidden h-9 w-9 place-items-center rounded-md hover:bg-muted md:grid"><Plus size={15} /></button>
          <button aria-label="Download chapter" className="hidden h-9 w-9 place-items-center rounded-md hover:bg-muted lg:grid"><Download size={15} /></button>
          <button aria-label="Full screen" className="hidden h-9 w-9 place-items-center rounded-md hover:bg-muted lg:grid"><Maximize2 size={15} /></button>
          <ThemeToggle />
        </div>
      </div>
      <div className="absolute inset-x-0 top-14 z-10 h-0.5 bg-border"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>

      <div
        className="scrollbar-thin h-full overflow-y-auto pt-14"
        onScroll={(e) => { const t = e.currentTarget; setPct(Math.round((t.scrollTop / (t.scrollHeight - t.clientHeight)) * 100)); }}
      >
        <div className="mx-auto w-full border-x border-border bg-paper shadow-cover" style={{ maxWidth: width }}>
          {[0, 1, 2, 3].map((i) => <img key={i} src={page} alt={`Page ${i + 1}`} loading={i ? "lazy" : undefined} decoding="async" width={760} height={1140} className="block w-full" />)}
        </div>
        <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
          <p className="font-display text-sm text-primary-text">終 · End of chapter {ch}</p>
          <p className="mt-2 font-display text-3xl font-medium tracking-tight">Up next: Chapter {ch + 1}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            <button className="rounded-md bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Next chapter</button>
            <Link to="/series/$id" params={{ id: s.id }} className="rounded-md border border-border bg-background px-5 py-2.5 text-xs font-medium hover:bg-muted">All chapters</Link>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 right-5 rounded-sm border border-border bg-background/95 px-2.5 py-1 text-[10px] tabular-nums text-muted-foreground">{pct}%</div>
    </div>
  );
}
