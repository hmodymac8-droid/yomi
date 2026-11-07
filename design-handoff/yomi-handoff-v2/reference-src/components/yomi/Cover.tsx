import { Link } from "@tanstack/react-router";
import type { Series } from "@/lib/data";

export function Cover({ s, sub, showProgress }: { s: Series; sub?: string; showProgress?: boolean }) {
  return (
    <Link to="/series/$id" params={{ id: s.id }} className="group block cv">
      <div className="relative aspect-[5/7] overflow-hidden rounded-sm border border-border bg-muted shadow-cover transition duration-300 group-hover:-translate-y-1 group-hover:border-primary/45">
        <img src={s.cover} alt={s.title} loading="lazy" decoding="async" width={340} height={474} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" />
        {s.newCh ? (
          <span className="absolute right-2 top-2 rounded-sm bg-peach-soft px-2 py-1 text-[10px] font-semibold text-peach-foreground shadow-cover">+{s.newCh} new</span>
        ) : null}
        <span className="absolute bottom-2 left-2 rounded-sm bg-background/95 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{s.type}</span>
        {showProgress && s.read ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-background/80">
            <div className="h-full bg-primary" style={{ width: `${Math.max(4, (s.read / s.chapters) * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug text-foreground transition group-hover:text-primary-text">{s.title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{sub ?? `${s.chapters} chapters · ${s.genres[0]}`}</p>
    </Link>
  );
}

export function SectionHead({ title, kicker, action }: { title: string; kicker?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-text">{kicker}</p>}
        <h2 className="font-display text-[28px] font-medium leading-tight tracking-tight text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ jp, title, desc, children }: { jp: string; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-border pb-7">
      <div>
        <p className="mb-1.5 font-display text-sm text-primary-text">{jp}</p>
        <h1 className="font-display text-[42px] font-medium leading-none tracking-tight text-foreground">{title}</h1>
        <p className="mt-2.5 text-sm text-muted-foreground">{desc}</p>
      </div>
      {children}
    </header>
  );
}
