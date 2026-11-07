import { createFileRoute } from "@tanstack/react-router";
import { Link2 } from "lucide-react";
import { series } from "@/lib/data";
import { Cover, PageHeader } from "@/components/yomi/Cover";

export const Route = createFileRoute("/added")({
  head: () => ({
    meta: [
      { title: "Added by me — Yomi" },
      { name: "description", content: "Single titles you saved to Yomi by pasting their page link." },
      { property: "og:title", content: "Added by me — Yomi" },
      { property: "og:description", content: "Single titles you saved to Yomi by pasting their page link." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Added,
});

function Added() {
  const mine = series.filter((s) => s.addedByMe);
  return (
    <div className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <PageHeader jp="私の追加" title="Added by me" desc="Titles you saved one by one from a page link." />
      <div className="mb-12 rounded-md border border-dashed border-primary/40 bg-peach-soft/45 px-5 py-9 text-center sm:px-8">
        <Link2 className="mx-auto text-primary-text" size={25} strokeWidth={1.5} />
        <p className="mt-3 font-display text-2xl font-medium">Save a single title</p>
        <p className="mt-1.5 text-sm text-muted-foreground">Paste the link to any series page — Yomi will fetch its cover and chapters.</p>
        <div className="mx-auto mt-6 flex max-w-lg flex-col gap-2 sm:flex-row sm:items-center sm:border sm:border-border sm:bg-paper sm:p-1">
          <input aria-label="Series page link" placeholder="https://site.com/manga/your-title" suppressHydrationWarning className="min-w-0 flex-1 border border-border bg-paper px-4 py-3 text-sm outline-none placeholder:text-muted-foreground sm:border-0 sm:py-2" />
          <button className="rounded-sm bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">Save title</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {mine.map((s) => <Cover key={s.id} s={s} sub={`from ${s.sources[0]} · ${s.chapters} ch.`} />)}
      </div>
    </div>
  );
}
