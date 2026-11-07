import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { sites } from "@/lib/data";
import { PageHeader } from "@/components/yomi/Cover";

export const Route = createFileRoute("/sites")({
  head: () => ({
    meta: [
      { title: "Sites — Yomi" },
      { name: "description", content: "Health and sync status of every manga site in your Yomi catalog." },
      { property: "og:title", content: "Sites — Yomi" },
      { property: "og:description", content: "Health and sync status of every manga site in your Yomi catalog." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Sites,
});

const label = { healthy: "Healthy", slow: "Slow", down: "Not responding" } as const;
const dot = { healthy: "bg-success", slow: "bg-warning", down: "bg-destructive" } as const;
const text = { healthy: "text-success", slow: "text-warning", down: "text-destructive" } as const;

function Sites() {
  const total = sites.reduce((a, s) => a + s.titles, 0);
  const count = (k: keyof typeof label) => sites.filter((s) => s.status === k).length;
  return (
    <div className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <PageHeader jp="サイト" title="Sites" desc={`${sites.length} sites · ${total.toLocaleString()} titles merged`}>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 rounded-md border border-border bg-paper px-4 py-2.5 text-xs font-medium hover:bg-muted"><RefreshCw size={14} /> Re-check all</button>
          <button className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Add site</button>
        </div>
      </PageHeader>

      <div className="mb-10 grid grid-cols-3 border-y border-border">
        {(["healthy", "slow", "down"] as const).map((k, i) => (
          <div key={k} className={`px-3 py-5 sm:px-6 ${i < 2 ? "border-r border-border" : ""}`}>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${dot[k]}`} />{label[k]}</div>
            <p className="mt-2 font-display text-4xl font-medium">{count(k)}</p>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto border-y border-border md:block">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr_40px] gap-4 border-b border-border px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Site</span><span>Status</span><span>Titles</span><span>Response</span><span>Last sync</span><span />
          </div>
          {sites.map((s) => (
            <div key={s.name} className="grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr_40px] items-center gap-4 border-b border-border px-4 py-4 text-sm transition last:border-0 hover:bg-secondary/65">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-sm border border-border bg-secondary text-[10px] font-semibold text-primary-text">{s.letter}</span>
                <div><p className="font-medium">{s.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{s.url}</p></div>
              </div>
              <span className={`inline-flex w-fit items-center gap-1.5 text-xs font-medium ${text[s.status]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dot[s.status]}`} />{label[s.status]}
              </span>
              <span className="text-xs tabular-nums">{s.titles.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <div className="h-1 w-14 overflow-hidden bg-muted"><div className={`h-full ${dot[s.status]}`} style={{ width: s.latency ? `${Math.max(10, 100 - s.latency / 20)}%` : "0%" }} /></div>
                <span className="text-xs text-muted-foreground">{s.latency ? `${s.latency} ms` : "—"}</span>
              </div>
              <span className="text-xs text-muted-foreground">{s.lastSync}</span>
              <button aria-label={`Options for ${s.name}`} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="border-y border-border md:hidden">
        {sites.map((s) => (
          <div key={s.name} className="border-b border-border py-5 last:border-0">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-sm border border-border bg-secondary text-[10px] font-semibold text-primary-text">{s.letter}</span>
              <div className="min-w-0 flex-1"><p className="font-medium">{s.name}</p><p className="truncate text-xs text-muted-foreground">{s.url}</p></div>
              <button aria-label={`Options for ${s.name}`} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground"><MoreHorizontal size={16} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <span className={`flex items-center gap-1.5 font-medium ${text[s.status]}`}><span className={`h-1.5 w-1.5 rounded-full ${dot[s.status]}`} />{label[s.status]}</span>
              <span className="text-right tabular-nums">{s.titles.toLocaleString()} titles</span>
              <span className="text-muted-foreground">{s.latency ? `${s.latency} ms response` : "No response"}</span>
              <span className="text-right text-muted-foreground">Synced {s.lastSync}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
