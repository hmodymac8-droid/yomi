import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, Play, RefreshCw } from "lucide-react";
import { series } from "@/lib/data";
import { PageHeader } from "@/components/yomi/Cover";

export const Route = createFileRoute("/following")({
  head: () => ({
    meta: [
      { title: "Following — Yomi" },
      { name: "description", content: "Series you follow in Yomi and their newest chapters." },
      { property: "og:title", content: "Following — Yomi" },
      { property: "og:description", content: "Series you follow in Yomi and their newest chapters." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Following,
});

function Following() {
  const list = [...series].sort((a, b) => (b.newCh ?? 0) - (a.newCh ?? 0));
  return (
    <div className="mx-auto max-w-[1450px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <PageHeader jp="追跡中" title="Following" desc="18 series · last checked 24 minutes ago">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" defaultChecked className="accent-primary" /> Auto-download new chapters</label>
          <button className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"><RefreshCw size={14} /> Check now</button>
        </div>
      </PageHeader>
      <div className="grid gap-x-12 xl:grid-cols-2">
        {list.map((s) => {
          const left = s.chapters - (s.read ?? 0);
          return (
            <div key={s.id} className="group cv-sm flex gap-4 border-t border-border py-6 sm:gap-5">
              <Link to="/series/$id" params={{ id: s.id }} className="shrink-0"><img src={s.cover} alt={s.title} loading="lazy" decoding="async" width={340} height={474} className="h-32 w-[92px] rounded-sm border border-border object-cover shadow-cover sm:h-36 sm:w-[104px]" /></Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start gap-2">
                  <Link to="/series/$id" params={{ id: s.id }} className="font-display text-xl font-medium leading-tight tracking-tight hover:text-primary-text">{s.title}</Link>
                  {s.newCh && <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm bg-peach-soft px-2 py-1 text-[10px] font-semibold text-peach-foreground"><BellRing size={11} /> +{s.newCh}</span>}
                </div>
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{s.type} · {s.sources.join(", ")}</p>
                <div className="mt-auto pt-4">
                  <div className="mb-2 flex justify-between text-[11px] text-muted-foreground"><span>Ch. {s.read ?? 0} / {s.chapters}</span><span>{left} unread</span></div>
                  <div className="h-1 overflow-hidden bg-muted"><div className="h-full bg-primary" style={{ width: `${((s.read ?? 0) / s.chapters) * 100}%` }} /></div>
                  <Link to="/read/$id" params={{ id: s.id }} className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary-text"><Play size={12} fill="currentColor" /> Continue chapter {(s.read ?? 0) + 1}</Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
