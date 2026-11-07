import logo from "@/assets/yomi-logo-sm.png.asset.json";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Bookmark, Download, Globe, Home, Library, Minus, Moon, Search, Settings, Square, Sun, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { sites } from "@/lib/data";

export function Logo() {
  return (
    <Link to="/" aria-label="Yomi home" className="flex shrink-0 items-center gap-2.5">
      <img src={logo.url} alt="Yomi" className="h-9 w-auto" />
    </Link>
  );
}

function TitleBar() {
  return (
    <div className="flex h-8 shrink-0 select-none items-center justify-between border-b border-border bg-chrome pl-4 text-[11px] text-muted-foreground">
      <span className="tracking-wide">Yomi <span className="mx-1.5 text-border">/</span> 読み</span>
      <div className="flex h-full">
        {[Minus, Square, X].map((I, i) => (
          <button key={i} aria-label={["Minimize", "Maximize", "Close"][i]} className={`grid h-full w-11 place-items-center transition hover:bg-muted hover:text-foreground ${i === 2 ? "hover:bg-destructive hover:text-destructive-foreground" : ""}`}>
            <I size={i === 1 ? 10 : 13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}

const nav = [
  { to: "/", label: "Discover", icon: Home },
  { to: "/following", label: "Following", icon: Bookmark, badge: 18 },
  { to: "/added", label: "Added by me", icon: Library, badge: 2 },
  { to: "/downloads", label: "Downloads", icon: Download, badge: 3 },
  { to: "/sites", label: "Sites", icon: Globe },
] as const;

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Main navigation" className={mobile ? "no-scrollbar flex gap-5 overflow-x-auto px-4 lg:hidden" : "hidden items-stretch gap-6 self-stretch lg:flex"}>
      {nav.map(({ to, label, icon: I, ...r }) => {
        const active = to === "/" ? path === "/" : path.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            className={mobile
              ? `flex shrink-0 items-center gap-1.5 border-b-2 py-3 text-xs font-medium transition ${active ? "border-primary text-primary-text" : "border-transparent text-muted-foreground"}`
              : `relative flex items-center gap-2 border-b-2 text-[13px] font-medium transition ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <I size={mobile ? 14 : 15} strokeWidth={1.7} className={active ? "text-primary-text" : ""} />
            <span>{label}</span>
            {"badge" in r && <span className={`text-[10px] tabular-nums ${active ? "text-primary-text" : "text-muted-foreground"}`}>{r.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function SearchField({ mobile = false }: { mobile?: boolean }) {
  return (
    <label className={mobile ? "flex h-10 items-center gap-2.5 border-b border-border px-1 text-sm text-muted-foreground focus-within:border-primary md:hidden" : "ml-auto hidden h-9 w-full max-w-[310px] items-center gap-2.5 border-b border-border text-sm text-muted-foreground transition focus-within:border-primary md:flex"}>
      <Search size={16} strokeWidth={1.7} />
      <input aria-label="Search catalog" placeholder="Search 338,170 titles across all your sites…" suppressHydrationWarning className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" />
      <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 text-[9px] xl:block">Ctrl K</kbd>
    </label>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(next);
    try { localStorage.setItem("yomi-theme", next); } catch { /* storage unavailable */ }
    setTheme(next);
  };
  return (
    <button
      onClick={flip}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={theme === "light" ? "Dark theme" : "Light theme"}
      className={`grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground ${className}`}
    >
      {theme === "light" ? <Moon size={17} strokeWidth={1.7} /> : <Sun size={17} strokeWidth={1.7} />}
    </button>
  );
}

function TopBar() {
  return (
    <header className="shrink-0 border-b border-border bg-background">
      <div className="flex h-[68px] items-center gap-7 px-4 sm:px-6 lg:px-8">
        <Logo />
        <Navigation />
        <SearchField />
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <button aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <Bell size={17} strokeWidth={1.7} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-peach" />
          </button>
          <ThemeToggle />
          <button aria-label="Settings" className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"><Settings size={17} strokeWidth={1.7} /></button>
        </div>
      </div>
      <div className="px-4 pb-2 md:hidden"><SearchField mobile /></div>
      <Navigation mobile />
    </header>
  );
}

function StatusBar() {
  return (
    <div className="hidden h-8 shrink-0 items-center gap-5 border-t border-border bg-chrome px-6 text-[10px] text-muted-foreground md:flex">
      <span><span className="font-medium text-foreground">338,170</span> titles</span>
      <span>{sites.length} sites</span>
      <div className="flex items-center gap-3">
        {sites.slice(0, 5).map((s) => <span key={s.name} className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${s.status === "healthy" ? "bg-success" : s.status === "slow" ? "bg-warning" : "bg-destructive"}`} />{s.name}</span>)}
        <Link to="/sites" className="text-primary-text hover:underline">+ {sites.length - 5} more</Link>
      </div>
      <span className="ml-auto">Synced 4 min ago</span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const reader = path.startsWith("/read");
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TitleBar />
      {reader ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <>
          <TopBar />
          <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</main>
          <StatusBar />
        </>
      )}
    </div>
  );
}
