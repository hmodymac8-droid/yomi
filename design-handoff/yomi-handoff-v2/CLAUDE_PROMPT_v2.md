# Prompt for Claude — Yomi, current design (black + manga yellow)

Paste the block below into Claude (Claude Code, or claude.ai with the files attached),
then attach this folder — at minimum `YOMI_DESIGN_SPEC_v2.md`, `design/tokens.css`,
`brand/yomi-logo.png`, and the `screenshots/` images.

---

```text
You are building the UI of "Yomi", a Windows desktop app for reading manga, manhwa and
manhua. I am giving you a finished design system, the real logo, screenshots of every
screen, and a working mockup. Your job is to make my app match it exactly — same colours,
same fonts, same spacing, same components, same feel. Do not invent a new style, do not
"improve" the palette, do not substitute fonts.

Read these first, in this order:
1. YOMI_DESIGN_SPEC_v2.md — the contract. Every value in it is mandatory.
2. design/tokens.css      — the exact token definitions (dark is the default theme).
3. screenshots/*.png      — what each screen must end up looking like (dark and light).
4. brand/yomi-logo.png    — the real logo. Use it as-is; do not recolour or redraw it.
5. reference-src/         — a working implementation of all seven screens you can copy from.

The app has these screens:
- Discover (home): featured series with a small cover and a numbered switcher, add-a-site
  bar, new chapters, continue reading rail, the full cover grid with All/Manga/Manhwa/Manhua
  filters.
- Series page: cover, tags, synopsis, source picker, Continue / Follow / Download unread,
  chapter list with read + up-next + new markers.
- Reader: full-window vertical scroll, slim top bar with chapter arrows and a page-width
  control, a 2px scroll progress line, "up next" block at the end.
- Following, Added by me, Sites, Downloads (Queue + Offline library tabs).

The look, in one line: a black canvas, warm off-white text, and exactly one accent —
the manga yellow taken from the logo. No purple, no blue, no second accent colour.

Rules you must not break:
- Colours come only from the token table in §2 of the spec. Dark is the default theme;
  the light theme is the same components with the .light token values.
- `primary` (#dcbc33 dark / #d3a300 light) is for fills, rings and progress. Accent TEXT
  (eyebrows, active tabs, Japanese kickers, badges) uses `primary-text` (#e5c226 dark /
  #8d5f00 light) — never the raw fill colour on a dark or cream background.
- Titles use Newsreader; everything else uses DM Sans. Load both from Google Fonts, or
  embed them if this is a native app.
- Covers are always 5:7. Corners are tight: 4px on covers/badges/inputs, 6px on buttons.
- Window frame: 32px title bar, 68px top bar with horizontal nav (no sidebar), 32px status
  bar at the bottom, content padded 20/32/40px.
- Transitions 300ms; hover lift 4px max; cover image zoom 500ms at 1.025 scale; nothing
  animates on page load.
- The Japanese strings (読み, 追跡中, 私の追加, サイト, ダウンロード, 終) must render
  correctly and stay in place.
- Stay lightweight: artwork ships resized to its displayed size and compressed, every
  image is loading="lazy" + decoding="async", and off-screen rows carry a
  content-visibility utility so they skip layout and paint.

Before you write any code: tell me which toolkit you're targeting and list the tokens and
components you'll create. Then build screen by screen, starting with the shared frame
(title bar + top bar + status bar), and check each screen against its screenshot before
moving on. Where my existing code already works, keep it and restyle it — don't rewrite
the logic.
```

---

## Tips that make the result much better

1. **Attach the screenshots.** Claude reproduces a look far more faithfully when it can
   see it than when it only reads a description. Attach both the `-dark` and `-light`
   versions so it builds the theme switch properly.
2. **Attach `reference-src/`** if you're rebuilding in React/web. If you're rebuilding in
   WPF / WinUI 3 / Avalonia, attach `design/tokens.css` + the spec + screenshots instead
   and skip the React files — otherwise Claude may pull React code into a native project.
3. **Go one screen at a time.** Frame first, then Discover, then the rest. One mega-prompt
   for all seven screens tends to blur the details.
4. **Ask for a check.** After each screen: "compare your result against
   screenshots/2-series-dark.png and list every difference you can find, then fix them."
5. **Watch the accent text rule.** The single most common mistake is using the bright
   fill yellow for small text. On black it must be `primary-text`; on cream it must be
   the much darker amber. If Claude writes `text-primary`, tell it to use `primary-text`.
6. **Keep the logo's own colours.** The yellow accent is sampled from the logo's burst —
   don't let Claude "modernise" the logo or shift the accent toward orange or gold.
