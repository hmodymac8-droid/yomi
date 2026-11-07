// Small line icons (lucide shapes), drawn with the current text colour.
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9v12h14V9',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15.5-3.5 1z',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 19h16',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  minus: 'M5 12h14',
  square: 'M6 6h12v12H6z',
  x: 'M6 6l12 12M18 6 6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
}

export function Icon({ name }: { name: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
