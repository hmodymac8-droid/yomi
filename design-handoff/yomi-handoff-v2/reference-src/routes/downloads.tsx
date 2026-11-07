import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, FileArchive, Pause, RotateCw, Trash2, X } from "lucide-react";
import { downloads, getSeries } from "@/lib/data";
import { PageHeader } from "@/components/yomi/Cover";

export const Route = createFileRoute("/downloads")({
  head: () => ({
    meta: [
      { title: "Downloads — Yomi" },
      { name: "description", content: "Chapters saved for offline reading and CBZ export in Yomi." },
      { property: "og:title", content: "Downloads — Yomi" },
      { property: "og:description", content: "Chapters saved for offline reading and CBZ export in Yomi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Downloads,
});

const tabs = ["Queue", "Offline library"] as const;

function Downloads() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Queue");
  const items = downloads.filter((d) => (tab === "Queue" ? d.state !== "done" : d.state === "done"));
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <PageHeader jp="ダウンロード" title="Downloads" desc="3 in queue · 4 chapters offline · 81.3 MB used">
        <div className="flex gap-5 border-b border-border">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`border-b-2 px-1 py-2.5 text-xs font-medium transition ${tab === t ? "border-primary text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>
      </PageHeader>
      <div className="border-y border-border">
        {items.map((d) => {
          const s = getSeries(d.seriesId);
          return (
            <div key={d.id} className="cv-sm flex flex-wrap items-center gap-4 border-b border-border py-5 last:border-0 sm:flex-nowrap sm:gap-5">
              <img src={s.cover} alt={s.title} loading="lazy" decoding="async" width={340} height={474} className="h-20 w-14 rounded-sm border border-border object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">Chapter {d.chapter} · {d.pages} pages · {d.size}</p>
                {d.state !== "done" && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="h-1 min-w-24 max-w-md flex-1 overflow-hidden bg-muted">
                      <div className={`h-full ${d.state === "failed" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${d.pct}%` }} />
                    </div>
                    <span className={`text-[11px] font-medium ${d.state === "failed" ? "text-destructive" : d.state === "queued" ? "text-muted-foreground" : "text-primary-text"}`}>
                      {d.state === "downloading" ? `${d.pct}%` : d.state === "queued" ? "Waiting" : "Failed — site not responding"}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex w-full items-center gap-1.5 pl-[72px] sm:w-auto sm:pl-0">
                {d.state === "done" ? (
                  <>
                    <Btn icon={BookOpen} label="Read" />
                    <Btn icon={FileArchive} label="Export CBZ" />
                    <IconBtn icon={Trash2} label={`Delete chapter ${d.chapter}`} />
                  </>
                ) : (
                  <>
                    {d.state === "failed" ? <Btn icon={RotateCw} label="Retry" /> : <IconBtn icon={Pause} label={`Pause chapter ${d.chapter}`} />}
                    <IconBtn icon={X} label={`Cancel chapter ${d.chapter}`} />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Btn({ icon: I, label }: { icon: typeof X; label: string }) {
  return <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-paper px-3.5 py-2 text-xs font-medium hover:bg-muted"><I size={14} /> {label}</button>;
}
function IconBtn({ icon: I, label }: { icon: typeof X; label: string }) {
  return <button aria-label={label} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><I size={15} /></button>;
}
