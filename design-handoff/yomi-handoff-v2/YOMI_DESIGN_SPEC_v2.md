# Yomi — Design Specification (v2)
### Codename: **Black & Manga Yellow**

This is the current, approved design. It replaces the earlier "Ink & Moonlight" spec
(vermilion red, serif mincho titles, a left sidebar) — that document is obsolete; do not
mix the two.

Written to be reproducible in **any** UI toolkit (WPF, WinUI 3, Avalonia, Electron, Tauri,
Qt, SwiftUI, web). Nothing here is optional. If a value is given, use that value.
The reference implementation in `reference-src/` is React + Tailwind; it is ground truth
for *proportions and behaviour*, not a requirement to use React.

---

## 1. The idea in one paragraph

Yomi is a dark room with one light. The canvas is black, the text is warm off-white, and
there is exactly **one** accent in the whole interface: the **manga yellow** lifted from the
app's own logo — the burst behind the open book. It appears as a small, confident stamp:
the primary button, the active tab underline, the "+2 new" badge, the progress fill, the
eyebrow above a heading. Everything else is a neutral grey ramp with no colour in it at
all. Type pairs a quiet literary serif (Newsreader) for titles and numbers with a plain,
open sans (DM Sans) for anything you have to read or click. The layout is horizontal and
editorial: a thin window chrome, one top bar of navigation, and content that sits on
hairline rules instead of floating cards. It should feel like a well-made reading object —
fast, quiet, and slightly Japanese.

**Two themes, one design.** Dark is the default. Light is the same components with a
different token block — paper-white canvas, charcoal ink, a deeper amber. No layout changes.

---

## 2. Colour tokens

oklch is authoritative; hex is the sRGB approximation for toolkits that can't do oklch.

### 2a. Dark (default)

| Token | oklch (exact) | hex | Used for |
|---|---|---|---|
| `background` | `oklch(0.08 0 0)` | `#020202` | Main app canvas, top bar, reader top bar. |
| `chrome` | `oklch(0.05 0 0)` | `#000000` | Title bar and status bar — the two window bookends. |
| `card` | `oklch(0.13 0 0)` | `#070707` | Panel/cover-card base fill. |
| `paper` | `oklch(0.12 0 0)` | `#060606` | Inputs, small panels, tag pills, secondary buttons. |
| `popover` | `oklch(0.13 0 0)` | `#070707` | Menus, dropdowns, tooltips. |
| `secondary` | `oklch(0.17 0 0)` | `#0f0f0f` | Row hover, site monogram tiles, series header band. |
| `muted` | `oklch(0.16 0 0)` | `#0d0d0d` | Progress troughs, icon-button hover, cover placeholder. |
| `accent` | `oklch(0.24 0.05 102)` | `#242000` | Selected/pressed fills, "up next" row tint. |
| `accent-foreground` | `oklch(0.82 0.11 95)` | `#dac46d` | Text on `accent`. |
| `foreground` | `oklch(0.95 0 0)` | `#eeeeee` | Primary text. Never pure white. |
| `muted-foreground` | `oklch(0.66 0 0)` | `#929292` | Secondary text, captions, timestamps, placeholders. |
| `primary` | `oklch(0.8 0.15 95)` | `#dcbc33` | **The accent.** Fills only: primary buttons, active tab underline, progress fill, focus ring, "Up next" pill. |
| `primary-foreground` | `oklch(0.12 0 0)` | `#060606` | Text/icons on `primary`. |
| `primary-text` | `oklch(0.82 0.16 95)` | `#e5c226` | Accent **text**: eyebrows, Japanese kickers, active tab labels, "+N more" links, download %, site monograms. |
| `gold` | `oklch(0.78 0.14 95)` | `#d3b63b` | Reserved/decorative. |
| `peach` | `oklch(0.78 0.14 95)` | `#d3b63b` | Notification dot. |
| `peach-soft` | `oklch(0.26 0.05 102)` | `#292503` | Badge fills, the "save a title" invite panel, Follow-active fill. |
| `peach-foreground` | `oklch(0.78 0.13 95)` | `#d1b64a` | Badge text on `peach-soft`. |
| `success` | `oklch(0.7 0.09 155)` | `#6faf86` | Healthy site dot, read-chapter tick. |
| `warning` | `oklch(0.75 0.09 70)` | `#d3a46e` | Slow site dot. |
| `destructive` | `oklch(0.65 0.14 25)` | `#d76963` | Down site dot, failed download, close-window hover. |
| `border` | `oklch(0.24 0 0)` | `#1f1f1f` | Every hairline, divider, outline, input border. |
| `input` | `oklch(0.24 0 0)` | `#1f1f1f` | Empty-field outline. |
| `ring` | `oklch(0.8 0.15 95)` | `#dcbc33` | Focus ring. |
| `reader` | `oklch(0.04 0 0)` | `#000000` | Reader backdrop behind the page column. |
| `shadow-cover` | — | `0 10px 24px -14px rgb(0 0 0 / 0.6)` | Cover images. |

### 2b. Light

| Token | oklch (exact) | hex | Used for |
|---|---|---|---|
| `background` | `oklch(0.976 0.005 95)` | `#f8f7f3` | Canvas — warm paper white, not pure white. |
| `chrome` | `oklch(0.945 0.008 95)` | `#eeede7` | Title bar, status bar. |
| `card` / `popover` / `paper` | `oklch(0.995 0.004 95)` | `#fefdfa` | Panels, inputs, small panels. |
| `secondary` | `oklch(0.94 0.01 95)` | `#edebe4` | Row hover, monogram tiles, header band. |
| `muted` | `oklch(0.905 0.014 95)` | `#e2e0d5` | Progress troughs, icon-button hover. |
| `accent` | `oklch(0.9 0.055 95)` | `#e9deb5` | Selected/pressed fills, up-next tint. |
| `accent-foreground` | `oklch(0.34 0.1 85)` | `#4f3100` | Text on `accent`. |
| `foreground` | `oklch(0.24 0.012 90)` | `#211f19` | Primary text — charcoal ink. |
| `muted-foreground` | `oklch(0.46 0.015 90)` | `#5b584f` | Secondary text. |
| `primary` | `oklch(0.74 0.155 88)` | `#d3a300` | Accent fills. |
| `primary-foreground` | `oklch(0.18 0.02 90)` | `#151107` | Text on `primary`. |
| `primary-text` | `oklch(0.52 0.13 82)` | `#8d5f00` | Accent **text** — a deep amber, because the bright fill is unreadable on cream. |
| `gold` | `oklch(0.56 0.13 82)` | `#9a6b00` | Reserved/decorative. |
| `peach` | `oklch(0.7 0.15 88)` | `#c59700` | Notification dot. |
| `peach-soft` | `oklch(0.885 0.07 90)` | `#ebd8a4` | Badge fills, invite panel, Follow-active fill. |
| `peach-foreground` | `oklch(0.32 0.09 82)` | `#492c00` | Badge text. |
| `success` | `oklch(0.5 0.13 155)` | `#007840` | Healthy, read tick. |
| `warning` | `oklch(0.58 0.13 75)` | `#a66d00` | Slow. |
| `destructive` | `oklch(0.55 0.19 25)` | `#c92f33` | Down, failed. |
| `border` / `input` | `oklch(0.845 0.012 95)` | `#ceccc4` | Hairlines. |
| `ring` | `oklch(0.74 0.155 88)` | `#d3a300` | Focus ring. |
| `reader` | `oklch(0.955 0.008 95)` | `#f2f0ea` | Reader backdrop. |
| `shadow-cover` | — | `0 10px 24px -14px rgb(0.25 0.02 90 / 0.35)` | Cover images. |

### 2c. Colour law

- One accent hue only: the yellow family (oklch hue ≈ 88–102). No blue, no purple, no
  vermilion, no green as decoration. Green/amber/red exist **only** as status colours
  (`success` / `warning` / `destructive`) and only on dots, ticks, bars and failure text.
- **Fill vs text is a hard split.** `primary` is for fills. Any accent-coloured *text*
  (eyebrow, active tab label, Japanese kicker, "+N more", download %, monogram letters)
  uses `primary-text`. In light mode this matters most: the fill `#d3a300` on cream fails
  contrast; the text must be `#8d5f00`.
- `primary` fills must stay small — a button, an underline, a badge, a bar. Never a
  background wash, never a gradient.
- Tints of the accent for fills are their own tokens (`accent`, `peach-soft`), not
  hand-written alphas.
- Dark mode never uses pure `#ffffff` text (`#eeeeee`) and light mode never pure `#000000`
  text (`#211f19`).

---

## 3. Typography

| Role | Font | Weights | Notes |
|---|---|---|---|
| `display` | **Newsreader**, fallback `Georgia, serif` | 400 / 500 / 600 | Every title, section heading, page number, stat number, Japanese kicker. Optical size 6–72. |
| `sans` | **DM Sans**, fallback `system-ui` | 400 / 500 / 600 / 700 | Body, labels, buttons, tables, inputs, captions, badges. |

One request, both families:
```
https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap
```
Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`. For a shipped desktop build,
**bundle the two font files locally** instead of fetching them.

Newsreader is used at **font-weight 500 (medium)** for headings, not bold. The elegance
comes from the serif itself, not from weight.

### Type scale (px / weight / tracking)

| Element | Font | Size | Weight | Tracking / leading |
|---|---|---|---|---|
| Page title (Discover, Following, Sites…) | display | 42–46 | 500 | -0.02em, line-height 1 |
| Hero / series title | display | 36 → 48 (responsive) | 500 | -0.02em, line-height 1.05–1.08 |
| Section heading | display | 28 | 500 | -0.02em, leading tight |
| Card title in list (Following) | display | 20 | 500 | -0.02em, leading tight |
| Invite-panel title | display | 24 | 500 | — |
| Number stat | display | 24 | 500 | — |
| Big stat (Sites counters) | display | 36 | 500 | — |
| Reader "up next" | display | 30 | 500 | -0.02em |
| Body / synopsis | sans | 14 | 400 | line-height 1.6–1.71 |
| Cover card title | sans | 14 | 500 | leading-snug, max 2 lines |
| Nav item | sans | 13 | 500 | — |
| Button / control label | sans | 12 | 500–600 | — |
| Meta / caption / timestamp | sans | 11–12 | 400 | `muted-foreground` |
| Micro badge ("+2 new") | sans | 10 | 600 | — |
| Eyebrow / kicker (uppercase) | sans | 10 | 600 | +0.18em, `primary-text` |
| Wide eyebrow (hero, table header) | sans | 10 | 600 | +0.2em / +0.14em |
| Tiny type tag on cover | sans | 9 | 600 | +0.12em, uppercase |
| Japanese kicker above page titles | display | 14 | 400 | `primary-text` |
| Title bar text | sans | 11 | 400 | wide, `muted-foreground` |
| Status bar text | sans | 10 | 400 | `muted-foreground` |

### Japanese is part of the brand
Short Japanese lines sit above page titles and in the window chrome. Fixed strings:

- Title bar: `Yomi / 読み`
- Following: **追跡中** · Added by me: **私の追加** · Sites: **サイト** · Downloads: **ダウンロード**
- End of a chapter: **終 · End of chapter N**

They must render (Newsreader covers them; otherwise fall back to a CJK serif, never a box).
They are decoration — the English beside them must stand alone.

---

## 4. Geometry & spacing

**Corner radius base `--radius = 6px`** → `sm` 4px · `md` 6px · `lg` 8px · `xl` 10px · `2xl` 12px

- **4px** (`rounded-sm`): cover images, badges, tag pills, inputs, small panels, the
  reader page column, monogram tiles.
- **6px** (`rounded-md`): every button (primary and secondary), icon buttons, the
  "Ch. N" pill.
- Nothing is a full pill in this design. Buttons are 6px-rounded rectangles.

**Window frame — horizontal, no sidebar**
```
┌──────────────────────────────────────────────────────────────┐
│ title bar                                32px  bg chrome     │
├──────────────────────────────────────────────────────────────┤
│ logo  Discover Following Added…   [search]      🔔 ☾ ⚙       │
│ top bar                                  68px  bg background │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   main content — scrolls, padding 20 / 32 / 40px             │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ 338,170 titles · 8 sites · ● ● ● ● ● +3 more   Synced 4 min  │
│ status bar                               32px  bg chrome     │
└──────────────────────────────────────────────────────────────┘
```
- **Title bar:** 32px, `chrome`, bottom hairline, 16px left padding, 11px
  `muted-foreground`. Text `Yomi / 読み` (the slash in `border` colour). Right: three
  44×32 hit areas (minimise, maximise, close); icons 13px (10px for the square), stroke
  1.5. Hover `muted` + `foreground`; close hover `destructive` + `destructive-foreground`.
- **Top bar:** 68px, `background`, bottom hairline, horizontal padding 16 / 24 / 32px
  (responsive), gap 28px between logo · nav · search · icons.
- **Status bar:** 32px, `chrome`, top hairline, 24px horizontal padding, 10px
  `muted-foreground`. Hidden below ~768px width.
- **Main content:** scrolls independently (`overflow-y-auto`), thin scrollbar.
  Page max-widths: Discover 1600px, series 1500px, sites/added 1500px, following 1450px,
  downloads 1400px. Padding 20px / 32px / 40px (sm / md / lg).
- **Reader:** no top bar, no status bar, no sidebar — the reader owns the whole window.

**Vertical rhythm:** sections are separated by a full-width `border` hairline and 40px of
padding above/below (hero sections 40–48px). Grid gaps: 16px columns / 32px rows for cover
grids; 32px column gap for the new-chapters and following lists. Standard control gaps
10px; chip gaps 6px.

**Cover aspect ratio is always 5:7.** Never square, never 2:3.

---

## 5. Elevation & effects

| Name | Value | Where |
|---|---|---|
| `shadow-cover` | `0 10px 24px -14px rgb(0 0 0 / 0.6)` | Cover images only. |
| Hairline | 1px `border` | Every divider, card outline, input, table row. |
| Focus ring | 2px `ring`, offset 3px, keyboard-visible only | Every interactive element. |
| Selection | `accent` fill, `accent-foreground` text | Text selection. |
| Scrollbar | thin, thumb `border`, track transparent | All scroll areas. |
| No scrollbar | `scrollbar-width: none` | Continue-reading rail, mobile nav. |
| Blur | none | Nothing in this design is glassmorphic. |

The design gets its structure from **rules and whitespace, not shadows or cards**. A cover
grid on black with hairlines between sections *is* the layout.

---

## 6. Component recipes

### 6.1 Logo
The real logo image (`brand/yomi-logo.png`, 360×144) — yellow burst behind a black-and-white
open book, then "yomi" in bold white lowercase. Displayed at **36px tall**, width auto,
nothing beside it. It is the only place the burst yellow appears as artwork. Do not
recolour, redraw, re-typeset or add a drop shadow to it. Tab icon: `brand/favicon.png` (64×64).

### 6.2 Nav item (top bar, horizontal)
Full-height, bottom-anchored 2px underline. 13px / 500, icon 15px stroke 1.7 + label, gap
8px, horizontal gap between items 24px.
- Rest: `muted-foreground`, transparent underline.
- Hover: text `foreground`.
- Active: underline `primary`, text `foreground`, **icon `primary-text`**.
- Optional count after the label: 10px, tabular numerals, `muted-foreground` (or
  `primary-text` when active).
- Mobile: same items in a horizontal-scroll row, 12px, py 12px, no visible scrollbar.

### 6.3 Search field
Not a box — an **underline**. 36px tall, max width 310px, bottom hairline `border`,
16px search icon, 12px input, 12px `muted-foreground` placeholder ("Search 338,170 titles
across all your sites…"), right: `Ctrl K` key hint in a 4px box (9px text) on wide screens.
**On focus the underline becomes `primary`.**

### 6.4 Primary button
6px radius, `primary` fill, `primary-foreground` text 12px/600, padding 10px vertical /
20px horizontal, optional 14px leading icon. Hover: `primary` at 90%. No glow, no shadow.

### 6.5 Secondary button
6px radius, transparent or `paper` fill, 1px `border`, 12px/500 text (`foreground`, or
`muted-foreground` for low-emphasis controls). Hover: `muted` fill + `foreground` text.
Padding 8–10px vertical / 12–16px horizontal, 13–14px icon.

### 6.6 Icon button
36×36, 6px radius, transparent, icon 17px stroke 1.7 `muted-foreground`. Hover: `muted`
fill, `foreground` icon. Notification dot: 6px circle `peach`, top-right.

### 6.7 Cover card
- Image 5:7, 4px radius, 1px `border`, `muted` base fill, `shadow-cover`.
- Top-right badge (new chapters): 4px radius, `peach-soft` fill, 10px/600
  `peach-foreground`, "+N new", padding 8px×4px.
- Bottom-left type tag: 4px radius, `background` at 95%, 9px/600 uppercase `+0.12em`,
  `muted-foreground`, the type.
- Optional bottom progress bar: 4px tall, trough `background` at 80%, fill `primary`,
  minimum 4%.
- Below the image: title 14px/500 `foreground`, max 2 lines, margin-top 12px; meta 11px
  `muted-foreground`, margin-top 4px.
- Hover: card lifts **4px**, ring → `primary` at 45%, image scales **1.025** over 500ms
  (card transition 300ms), title → `primary-text`.

### 6.8 Section heading
Eyebrow 10px/600 uppercase `+0.18em` `primary-text` → title 28px/500 display
`-0.02em`. Optional right-aligned action group (checkbox, buttons, filter tabs),
bottom-aligned to the title. Margin below 20px.

### 6.9 Page header
Japanese kicker 14px display `primary-text` → title 42px/500 display `leading-none`
`-0.02em` → description 14px `muted-foreground`. Right side holds page actions. Full-width
`border` rule below, 28px padding under the text, 32px gap to content.

### 6.10 Tag pill (genres, type, status)
4px radius, 1px `border`, `paper` (or `background`) fill, 10px `muted-foreground`,
padding 10px×4px.

### 6.11 Filter tabs (All / Manga / Manhwa / Manhua, Queue / Offline library)
Row of text buttons sitting on a shared bottom hairline; each has its own 2px bottom
border. 12px/500, padding 8px vertical / 12px horizontal.
- Selected: border `primary`, text `primary-text`.
- Unselected: transparent border, `muted-foreground`, hover `foreground`.

### 6.12 Source picker (series page)
Small 4px pills, 11px/500, padding 12px×6px.
- Selected: `accent` fill, `accent-foreground` text, no border.
- Unselected: 1px `border`, `background` fill, `muted-foreground` text, hover `foreground`.

### 6.13 Chapter row
Single rows inside one container bounded by top+bottom hairlines; rows separated by
`border` hairlines. Padding 14px vertical / 8–16px horizontal, 14px text, transparent
fill; hover `secondary` at 70%.
- "Chapter N" label 96px (112px on wide), 500 weight. Read rows → `muted-foreground`.
- "Up next" row: whole row tinted `accent` at 45%, plus a `primary` pill 9px uppercase
  `primary-foreground` "UP NEXT".
- New chapters: `peach-soft` pill, `peach-foreground` 9px uppercase "NEW".
- Right side: source + age 11px `muted-foreground`, then a `success` check (15px) for read
  rows, then a download icon that is **invisible until hover**.

### 6.14 Progress bar
4px tall, square-ended, trough `muted`, fill `primary`. Failed = `destructive` fill.
Right-aligned state label 11px/500: `N%` in `primary-text`, "Waiting" in
`muted-foreground`, "Failed — site not responding" in `destructive`.

### 6.15 Site status
6px dot: healthy `success`, slow `warning`, down `destructive`. Label 12px/500 tinted to
the same colour. Latency bar: 56×4px, trough `muted`, fill = the status colour.

### 6.16 Data table (Sites)
One container bounded by top+bottom hairlines; header strip 10px/600 uppercase
`+0.14em` `muted-foreground`, padding 12px vertical / 16px horizontal. Rows: 14px text,
16px vertical padding, hover `secondary` at 65%.
Columns `2fr 1fr 1fr 1.2fr 1fr 40px`, 16px gaps. Site cell = 36×36 `secondary` monogram
tile (4px radius, 1px `border`, 10px/600 `primary-text`) + name 14px/500 + URL 12px
`muted-foreground`.
Below ~768px the table becomes stacked cards: monogram + name + ⋯ on one line, then a
2-column grid of status / titles / response / sync.

### 6.17 Invite panel (Added by me)
6px radius, **dashed** 1px border of `primary` at 40%, `peach-soft` at 45% fill,
padding 20px / 36px, centred: link icon 25px `primary-text` → title 24px/500 display →
14px `muted-foreground` description → input + primary **Save title** button (stacked on
narrow, inline in a bordered `paper` strip on wide).

### 6.18 Stat cell (Sites counters, series stats)
No card. Just a hairline-bounded strip: dot + 11px `muted-foreground` label, then a
36px/500 display number. Series-page stats: 24px/500 display number over a 10px uppercase
`+0.05em` `muted-foreground` label, 32px apart.

---

## 7. Screen specs

### 7.1 Discover (home)
Max width 1600px. Sections in order, each bounded by a hairline:
1. **Header.** Eyebrow "YOUR COMBINED CATALOG" (10px, +0.2em, `primary-text`) → "Discover"
   46px/500 display → "One quiet place for every series you follow." 14px
   `muted-foreground`. Right: "338,170 titles · 8 sites", the number in `foreground`.
2. **Add-a-site bar.** Text left ("**Add a site** — paste any manga site's address and it
   joins your catalog."), then a bordered `paper` strip containing the input and a `primary`
   **Add** button (4px radius, `+` icon) sitting inside it on the right.
3. **Featured series.** Three columns: `130px | 1fr | 240px` (stacked on smaller screens).
   - Left: the cover, **capped at 140px wide** (this is deliberate — the preview must stay
     small), 5:7, 4px radius, hairline, `shadow-cover`.
   - Middle: eyebrow "CONTINUE · CHAPTER N" (`peach-foreground`) → title 36→48px/500
     display, line-height 1.05 → tag pills → synopsis 3 lines, 14px, line-height 1.71 →
     [▶ Read now `primary`] [Details `paper`+border].
   - Right (wide screens only): a hairline-separated numbered list "01…06" of featured
     series; the selected row is `primary-text`, others `muted-foreground` hover
     `foreground`. This list **switches the hero**.
   - Narrow screens: the list becomes a horizontal row of 44×64 thumbnails, selected has a
     2px `primary` border, others 55% opacity.
4. **New chapters.** Section head (eyebrow "FOLLOWING · CHECKED 24 MIN AGO"); right side:
   "Auto-download" checkbox (accent `primary`) + **Check now** secondary button.
   Two/three-column list of wide rows: 56×80 cover, title, "Chapter N · just now",
   `peach-soft` "+N new" pill, ▶ icon that turns `primary-text` on hover. Row hover
   `secondary` at 60%.
5. **Continue reading.** Horizontal scroll rail, no visible scrollbar, 144–160px cover
   cards **with progress bars**, sub-line "Ch. X of Y · P%".
6. **All titles.** Section head (eyebrow "183,898 titles"); right side: filter tabs
   (§6.11) + two dropdown chips ("All sites (8)", "Latest update"). Grid
   `2 / 3 / 4 / 5 / 7` columns responsive, 16px column gap, 32px row gap. Footer line
   centred 12px `muted-foreground`: "Scroll to load more · page 1 of 3,065".

### 7.2 Series page
- **Header band**, `secondary` at 55% fill, bottom hairline, padding 28–36px: "← Back to
  Discover" 12px/500 `muted-foreground` (hover `primary-text`) → row of cover + details.
  Cover column 144 → 192 → 208px wide. Details: tag pills → title 36→48px/500 display →
  synopsis (max 672px) → "Read from" + source pills (§6.12) → action row: [Continue ·
  Chapter N / Start reading `primary`], [★ Follow] (active = `peach-soft` fill,
  `peach-foreground` text, `peach` at 50% border, filled star), [⤓ Download unread (N)] →
  three stats (§6.18).
- **Chapters.** Eyebrow = the chosen source; "Chapters" 28px/500. Right: "Newest first /
  Oldest first" toggle + "Check for new". Then the chapter list (§6.13), 30 rows shown.

### 7.3 Reader
Full window, `reader` backdrop, no top bar / status bar.
- **Top bar** 56px, `background` at 95%, bottom hairline, padding 12–20px: back circle →
  title 12→14px/500 + "Chapter N · source" 10–12px `muted-foreground` → right cluster:
  ‹ › chapter arrows (36×36), a "Ch. N" pill (border + `paper`, 11px, list icon), a 1px
  divider, − / width-in-px / + page-width control (480–1100px, step 80), download,
  fullscreen, theme switch.
- **Progress line** 2px directly under the bar, `primary` fill on a `border` trough,
  tracks scroll.
- **Pages:** centred column at the chosen width, `paper` fill, 1px side hairlines,
  `shadow-cover`, pages stacked edge-to-edge with no gaps and no chrome.
- **Bottom-right:** a small 4px pill showing scroll %, `background` at 95% + hairline,
  10px tabular `muted-foreground`.
- **End of chapter:** centred — "終 · End of chapter N" 14px display `primary-text` →
  "Up next: Chapter N+1" 30px/500 display → [Next chapter `primary`] [All chapters
  `paper`+border].
- Nothing else is on screen: no ads, no recommendations, no comments, no site chrome.

### 7.4 Following
Page header (追跡中, "18 series · last checked 24 minutes ago") with "Auto-download new
chapters" checkbox + `primary` **Check now**. Two columns on wide screens, 48px column
gap. Row: hairline above, 24px padding; 104×144 cover; title 20px/500 display (hover
`primary-text`); `peach-soft` bell pill "+N" top-right; "Manga · source, source" 11px
`muted-foreground` clamped to 2 lines; then bottom-anchored: "Ch. X / Y" + "N unread"
11px, a 4px progress bar, then "▶ Continue chapter N" 12px/500.

### 7.5 Added by me
Page header (私の追加), then the invite panel (§6.17), then a cover grid
`2 / 3 / 4 / 6` columns with "from SOURCE · N ch." as the meta line.

### 7.6 Sites
Page header (サイト, "8 sites · 338,170 titles merged") with **Re-check all** +
`primary` **Add site**. Three stat cells in one hairline-bounded strip (§6.18). Then the
table (§6.16).

### 7.7 Downloads
Page header (ダウンロード, "3 in queue · 4 chapters offline · 81.3 MB used") with the
Queue / Offline library tabs (§6.11).
- **Queue:** rows in a hairline-bounded container — 56×80 cover, title 14px/500,
  "Chapter N · P pages · size" 12px, then the progress bar + state label (§6.14). Right:
  pause / ✕, or **Retry** for failures.
- **Offline library:** same rows, no bar; actions **Read**, **Export CBZ**, trash icon.

---

## 8. Motion & feel

- Standard transition **300ms ease**; cover-image zoom **500ms ease** at scale **1.025**.
- Hover lift is **4px**, on cover cards only.
- Nothing animates on page load. No staggered fade-ins, no pulsing skeletons.
- The only continuous motion is the reader's progress line.
- Focus ring: 2px `ring`, offset 3px, keyboard-visible only.
- Cursor: pointer on all rows/cards, not just their icons.

---

## 9. Copy voice

Short, plain, a little dry. Sentence case, never shouty.
- Numbers are always specific: "338,170 titles", "synced 4 min ago", "page 1 of 3,065",
  "81.3 MB used".
- Buttons are verbs: **Read now**, **Add**, **Save title**, **Check now**, **Download
  unread**, **Export CBZ**, **Retry**.
- Empty states explain what to do in one line, then show the control that does it.
- Japanese lines are decoration, never load-bearing.

---

## 10. Hard rules (the "never" list)

1. Never a second accent hue. No blue, no purple, no indigo, no vermilion, no teal.
2. Never use the `primary` fill colour for text — use `primary-text`.
3. Never a square cover. Always 5:7.
4. Never pure `#ffffff` text on dark or pure `#000000` text on light.
5. Never a default system font, Inter, Poppins, or a serif substitute for Newsreader.
6. Never put the accent yellow behind body text, or use it as a gradient or background wash.
7. Never a glassmorphic/blurred surface. Never a glow under a button.
8. Never show a scrollbar in the continue-reading rail or the mobile nav.
9. Never let the reader show ads, recommendations, comment threads, or site chrome.
10. Never use all-caps above 12px.
11. Never animate on load.
12. Never hardcode a colour — always reference a token name from §2.
13. Never recolour, redraw or re-typeset the logo.
14. Never add a left sidebar; navigation is horizontal in the top bar.

---

## 11. Performance rules (these are design requirements, not optimisations)

The app must stay light on RAM, CPU and the browser.

- **Artwork ships at its displayed size.** Covers are **340×474** (displayed at 92–208px
  wide), reader pages **760×1140**. Exported at ~71–72 quality, progressive, stripped of
  metadata. Six covers ≈ 228 KB total; the whole mockup's image budget is ~232 KB.
- **Every image** carries `loading="lazy"` (except the first reader page and the hero) and
  `decoding="async"`, plus real `width`/`height` so nothing reflows.
- **Off-screen rows skip layout and paint:** `.cv` (cover cards, `auto 300px`) and
  `.cv-sm` (list rows, `auto 96px`) from `tokens.css`. Apply them to every repeated row.
- **Logo** is a 360×144 indexed PNG (~9 KB), not the 600 KB master.
- **Fonts** are two families only; bundle them locally in the shipped build.
- No heavy libraries, no animation runtimes, no image carousels. If a screen can be built
  with hairlines and grid layout, build it that way.

---

## 12. Theme switching

- Theme is stored under the key `yomi-theme` with values `"dark"` | `"light"`.
- Applied by adding that class to the document root **before first paint** (inline script
  in the HTML head) so there is no flash. Default when unset: **dark**.
- The switch is a 36×36 icon button (sun ⇄ moon) in the top bar's right-hand icon group,
  and again in the reader's top bar.
- Light mode is *only* the `.light` token block — identical geometry, components and copy.

---

## 13. Porting notes

- **WPF / WinUI 3 / Avalonia:** §2 → a `ResourceDictionary` (with a `Light` theme
  dictionary for `.light`), §4 → `Thickness`/`CornerRadius` resources, §6 →
  `ControlTemplate`s. Use the hex column; oklch isn't supported. Embed Newsreader +
  DM Sans.
- **Electron / Tauri / web:** copy `design/tokens.css` verbatim — it is the exact token
  file used by the reference build.
- **Qt/QML:** tokens → a `QtObject` of `color` and `real` properties.
- Where a value exists in both oklch and hex, oklch is authoritative.

---

## 14. Files in this package

| File | What it is |
|---|---|
| `YOMI_DESIGN_SPEC_v2.md` | This document — the contract. |
| `CLAUDE_PROMPT_v2.md` | The prompt to paste into Claude, plus tips. |
| `design/tokens.css` | Exact colour, radius, font, shadow and performance utilities. |
| `brand/yomi-logo.png` | The real logo, 360×144, as used in the app. |
| `brand/favicon.png` | The 64×64 tab/app icon. |
| `screenshots/*-dark.png` | All seven screens, default theme. |
| `screenshots/*-light.png` | The same seven screens in the light theme. |
| `reference-src/` | The working React/Tailwind implementation of every screen. |
