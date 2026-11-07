# Yomi: restyle prompt for Lovable

Upload these files together with the prompt below:
- `yomi-logo-banner.webp` (brand banner with the logo)
- `screenshots/01-main-page.png` to `07-reader.png` (the app as it looks today)
- `current-main.css` and `current-base.css` (the current styles, so class names are known)

---

## Prompt (copy everything below)

```
I have a Windows desktop manga reader called "Yomi" (Electron + React). It works, but it looks like a plain dark purple prototype. I want you to design a complete visual theme for it, based on my logo.

ATTACHED
- yomi-logo-banner: my brand. Pure black background, crisp white lowercase "yomi" wordmark in a heavy rounded geometric sans, an open-book icon made of comic panels, and a bright electric-yellow comic "impact burst" behind the icon. The banner background is faded black-and-white manga panels (screentone, ink, panel gutters).
- 7 screenshots of the current app: main page, "Added by me" shelf, Sites screen, Downloads, Following, a series page, and the reader.
- current-main.css and current-base.css: the current styles.

THE FEEL I WANT
Bold, high-contrast, manga-native. Black and white like printed manga, with ONE loud accent: electric yellow (about #FFE600) used like the burst in the logo. Think comic panels, ink, halftone dots and screentone, sharp panel borders, a little speech-bubble and impact-burst energy. Confident and playful, not cutesy. It must still be calm to read in for hours: the reader screen stays quiet and distraction-free.

DESIGN RULES
- Palette: near-black base (#0A0A0B), a few ink-gray surface steps, white text, yellow as the only accent. Success green, warning amber and error red are allowed ONLY for status (Working / Needs a look / Broken, download progress). Give me exact hex tokens for dark, and a light "paper" variant (warm off-white paper, black ink, same yellow).
- Typography: a heavy rounded geometric sans like the wordmark for titles and buttons (Poppins, Nunito Black or similar from Google Fonts), a clean readable sans for body text. It must also look good with Arabic, Japanese and Korean titles in the same grid.
- Shapes: panel-style cards with a thin ink border and a slight hard offset shadow (like a comic panel), tight radii. Buttons: solid yellow with black text for primary actions, outlined white for secondary, and a pressed state that shifts the offset shadow.
- Details to include: a subtle halftone or screentone texture used sparingly (headers, empty states, hover), a yellow burst behind key moments (the "+N new chapters" badge, the Continue reading button), a bold focus ring in yellow, and tasteful hover and press motion (under 150 ms).
- Cover grid: covers are the stars. Keep them big, uncropped in character, with the title (two lines max) and the list of source sites underneath in small muted text.
- Density: this is a power tool with up to 15 sites and hundreds of thousands of titles. Keep controls compact and scannable. No big hero sections.

SCREENS TO RESTYLE (all of them, consistently)
1. Main page: search bar with Ctrl+K hint, "All sites" picker dropdown, sort select, Following / Downloads / Sites buttons, a collapsible site-chip bar, an "Add a site" input, following status line, shelves tabs ("All titles" / "Added by me"), "New chapters" strip with +N badges, "Continue reading" strip with progress, then the cover grid with a pagination bar.
2. "Added by me": a URL input with two buttons ("Add title", "Add + download all"), then cards with a remove (x) button on hover.
3. Sites screen: one row per site with a status dot, name, host, status text, title count, and Details / Re-scan titles / Re-check buttons.
4. Downloads: pause and offline toggles, concurrency select, export CBZ, per-series groups, per-chapter green progress bars, size and delete.
5. Following list.
6. Series page: big cover, title, "Read from" site tabs, description, Continue / Follow / Download buttons, chapter grid with per-chapter download button, read and current states.
7. Reader: vertical pages on a quiet dark (or paper) background, a slim auto-hiding top bar with title, chapter navigation and settings. Keep chrome minimal.
Also design: empty states (use the logo's burst), loading skeletons for covers, error messages, and a small app header with the Yomi logo mark.

WHAT I NEED BACK
1. A working React + Tailwind preview of all 7 screens (with fake data) so I can see the theme.
2. A DESIGN TOKENS section: colors (dark and paper), fonts, sizes, radii, shadows, spacing, motion.
3. IMPORTANT: my real app uses plain CSS with fixed class names, not Tailwind. So ALSO give me one complete drop-in replacement stylesheet (`main.css`) written in plain CSS with CSS variables, that styles exactly the class names found in current-main.css (.browse, .toolbar, .search, .sites, .chip, .grid, .card, .cover, .name, .from, .strip, .card.small, .cwrap, .cremove, .primary, .chapterwrap, .chapter, .dl, .mini, .pg, .shelves, and the rest). Do not rename or remove any class. You may add new classes. Keep it under ~600 lines and commented by section.
4. A 512px square app icon idea derived from the logo (just the book-in-burst mark, no text) described precisely enough to recreate as SVG.
```

---

## What happens next

1. Paste the prompt and upload the files in Lovable.
2. When you like the preview, send me the `main.css` it gives you, the tokens, and any font names.
3. I will drop it in, fix any screens that need small markup changes, add the Yomi name, window title and icon, and restart the app so you can see it for real.
