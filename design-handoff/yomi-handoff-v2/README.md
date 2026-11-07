# Yomi — design handoff package (v2)

Everything needed to rebuild Yomi's UI to this exact look in another tool, by another
person, or by Claude.

**This is the current design: black canvas, manga-yellow accent, the real logo, dark by
default with a light theme behind a switch.** The earlier `yomi-design-handoff.zip`
(vermilion red, serif mincho titles, a left sidebar) is the old direction — don't send it.

## What's here

```
YOMI_DESIGN_SPEC_v2.md    the design contract: colours (dark + light), fonts, spacing,
                          component recipes, all seven screen layouts, motion, copy
                          voice, hard rules, performance rules
CLAUDE_PROMPT_v2.md       the prompt to paste into Claude, plus tips
design/tokens.css         the exact token file (colours, radii, fonts, shadows,
                          content-visibility utilities)
brand/yomi-logo.png       the real logo, 360×144
brand/favicon.png         the 64×64 app/tab icon
screenshots/              every screen at 1280×800, in both themes
  1-discover              home: featured series, add-a-site, new chapters,
                          continue reading, cover grid
  2-series                series page: header band, source picker, chapter list
  3-reader                the reader, mid-scroll
  4-following             followed series with progress
  5-added                 Added by me
  6-sites                 site health dashboard
  7-downloads             download queue
  8-downloads-offline     offline library tab
reference-src/            the working implementation (React + Tailwind + TanStack Router)
  design tokens           styles.css
  shell                   components/yomi/Shell.tsx, Cover.tsx
  screens                 routes/*.tsx (7 screens + root)
  sample data             lib/data.ts
  artwork                 assets/ (resized covers, reader page, logo)
```

## Fastest path

1. Open `CLAUDE_PROMPT_v2.md`, copy the prompt block.
2. Paste it into Claude with this folder attached — at minimum the spec, `tokens.css`,
   `brand/yomi-logo.png` and the screenshots.
3. Build the shared frame first (title bar + top bar + status bar), then one screen at a
   time, checking each against its screenshot.

## Notes

- Colours are given twice: `oklch` (authoritative) and hex (for toolkits that can't do oklch).
- Dark is the default theme; light is the same layout with the `.light` token values,
  switched by an icon in the top bar and stored under `yomi-theme`.
- The single most common mistake when reproducing this: using the bright accent fill
  (`#dcbc33`) for small text. Accent *text* is a separate token (`primary-text`) and is
  much darker in light mode.
- All covers, titles, site names, counts and the reader's page art are invented sample
  content for the mockup. Replace with your real data.
- Fonts: Newsreader (titles) and DM Sans (everything else), both on Google Fonts. For a
  shipped desktop build, bundle them locally.
- The mockup's buttons are non-functional — it is a design prototype, not a working reader.
