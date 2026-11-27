# Portable Typography, Color & Fluid `clamp()` Foundation (Cyrillic + Latin)

> [!NOTE]
> **Track:** [Wayfinder Research Ticket #2](https://github.com/TacticalOtaku/BestiaryJournal/issues/2) · **Parent Map:** [Road to 8.0 (#1)](https://github.com/TacticalOtaku/BestiaryJournal/issues/1)  
> **Target Runtime:** Foundry VTT `v14.367+` (`Electron 40+ / Chromium 144+` through `14.371` `Electron 45.3.4 / Chromium 156`), `dnd5e 5.3.3+`, zero CSS preprocessor/bundler  
> **Feeds Decision:** [Issue #4 — Portable Design System Contract, Naming & Bestiary Theme Adapter](https://github.com/TacticalOtaku/BestiaryJournal/issues/4)

---

## Executive Summary

1. **Recommended OFL Tri-Font Stack (Cyrillic + Latin):**
   - **Display Serif:** **`Literata`** (Variable `opsz: 7–72`, `wght: 200–900`, Upright + True Italic; Cyrillic by Vera Evstafieva; SIL OFL 1.1) — Runner-up: **`Source Serif 4`** (`opsz: 8–60`, `wght: 200–900`, SIL OFL 1.1). Disqualified: **`Newsreader`** (no Cyrillic in standard release) and **`Cormorant Garamond`** (high-contrast hairlines shimmer on dark surfaces below `24px`).
   - **UI Sans:** **`Inter`** (v4.1+, Variable `opsz: 14–32`, `wght: 100–900`, split Roman + True Italic; SIL OFL 1.1; `tnum` + `cv05` disambiguation) — Runner-up: **`IBM Plex Sans`** (harmonized Cyrillic/Latin metrics + Bulgarian `locl`, SIL OFL 1.1). Disqualified as primary UI Sans: **`Golos Text`** (`wght: 400–900` upright only; `METADATA.pb` lists zero italic face, forcing synthetic obliquing on rich `dnd5e` descriptions/notes).
   - **Data Monospace:** **`JetBrains Mono`** (Variable `wght: 100–800`, Upright + True Italic; `1000` UPM / `550` x-height; SIL OFL 1.1; `font-variant-ligatures: none` for literal dice/DC strings) — Runner-up: **`IBM Plex Mono`** (SIL OFL 1.1; static 7-weight distribution on Fontsource). Disqualified: **`Roboto Mono`** (Apache 2.0, not OFL).
   - **Bundle Footprint Discipline:** Bundling only the 4 required subsets (`cyrillic`, `cyrillic-ext`, `latin`, `latin-ext` — excluding Greek/Vietnamese) mirrors the current local `assets/fonts/onest-*.woff2` split (`88,612 B` / `86.5 KiB` across 4 upright variable slices) and avoids full multi-script npm package bloat (e.g., `@fontsource-variable/inter` is `1.8 MB` unpacked across all scripts/axes).
2. **Fluid Typography & Spacing (`REM + clamp()` + `@container`):**
   - Foundry `v14.367+` (`Electron 40+ / Chromium 144+`) supports `@container`, `cqi`, `clamp()`, `@layer`, `@scope`, `oklch()`, `color-mix()`, and `light-dark()` natively.
   - Replace viewport-coupled `vw` rules (e.g., `styles/creature.css` `clamp(1.6rem, 3vw, 2.2rem)`) with `rem`-anchored `cqi` interpolation (`minWidth = 30rem` to `maxWidth = 75rem`) evaluated on unregistered custom properties inside `container: ds-window / inline-size` so Foundry `uiConfig` root scaling (`rem`) and window resizing both work cleanly, with W3C `css-contain-3` fallback to small viewport inline size (`svi`) outside query containers (e.g., chat cards).
3. **Anti-Liquid Glass & WCAG 2.1 AA/AAA Color Architecture:**
   - Replace AIM's navy-slate `"Nocturne"` (`#0e1016` / `#151821`) and yellow `"Parchment"` (`#efe8d8`), all 6 accent-picker overrides, `.bestiary-spot` cursor glow, and translucent overlays (`rgb(... / 72%)`, `% transparent`) with two strictly opaque presets: **Dark Graphite Ink** (`#0e0e0d`–`#252522`) and **Warm Archival Paper** (`#dad4c6`–`#f7f4ec`), with derived states mixed strictly into opaque `var(--ds-surface)` via `color-mix(in oklab, ...)`.
   - Every text, semantic, accent, and Bestiary tier token is mathematically verified at `>= 4.91:1` (Light) and `>= 5.67:1` (Dark) across **all four** opaque surface tiers (`bg`, `surface`, `raised`, `sunken`) and `>= 5.00:1` over `12%` self-tinted opaque badges, with primary copy `>= 12.2:1` (AAA), muted copy `>= 7.19:1` (AAA), and interactive control boundaries `>= 3.11:1` (SC 1.4.11).
   - Auto-switching follows Foundry's `.theme-dark` / `.theme-light` hierarchy via `@scope (.theme-dark) to (.theme-light)` and `@scope (.theme-light) to (.theme-dark)` plus explicit `forced-colors: active` `<system-color>` mappings.
4. **Native CSS `@layer` Cascade Isolation:**
   - Foundry v13/v14 wraps `module.json` `"styles"` via `@import "..." layer(modules)` on top of `reset < variables < elements < blocks < applications < compatibility < layouts < system < modules < exceptions`.
   - Declaring internal sub-layers (`@layer ds-tokens, ds-reset, ds-base, ds-layout, ds-components, ds-adapter, ds-states;`) inside the `modules` layer nests them as `modules.ds-*`, automatically beating `dnd5e` (`system`) and Foundry `elements.forms` / `applications` with zero `!important` escalation while staying portable outside Foundry as standalone top-level `@layer ds-*` stylesheets.

---

## 1. Current Repository Baseline & Constraints

Inspection of the `main` (`v0.7.1`) codebase establishes the starting constraints that `0.8.0` replaces or updates:

- **Typography & Bundle Baseline (`styles/tokens.css`, `assets/fonts/`, `tools/live-check.js`):**
  - Currently bundles a single unified sans-serif family (`"Bestiary Onest"`, SIL OFL 1.1, `assets/fonts/OFL-onest.txt`) across 4 upright variable `.woff2` slices (`100 900`):
    - `onest-cyrillic-ext-wght-normal.woff2`: `10,540 B`
    - `onest-cyrillic-wght-normal.woff2`: `15,860 B`
    - `onest-latin-ext-wght-normal.woff2`: `28,452 B`
    - `onest-latin-wght-normal.woff2`: `33,760 B`
    - **Total current font payload:** `88,612 B` (`86.5 KiB`) — upright only (synthetic italic where used).
  - `tools/live-check.js` hardcodes `const FACES = ["Bestiary Onest"];` and flags any text rendered in another face.
  - `styles/frame.css` overrides `#tooltip.bestiary-tooltip` explicitly because Foundry renders tooltips in `Signika` (which lacks Cyrillic coverage).
- **Palette & Theme Architecture (`styles/tokens.css`, `styles/content.css`, `scripts/core/theme.js`, `scripts/foundry/theme-root.js`, `tests/theme-contrast.test.js`):**
  - Currently mirrors AIM ("Nocturne & Parchment") with 6 selectable accents (`brass`, `embers`, `arcane`, `forest`, `frost`, `rose`), translucent `--suite-accent-soft: color-mix(in oklab, var(--suite-accent) 16%, transparent)`, translucent chat card surface (`--bj-chat-paper: rgb(248 244 234 / 72%)`), and subtle borders (`rgb(255 255 255 / 8%)`, ~`1.15:1` contrast).
  - `tests/theme-contrast.test.js` parses hex custom properties directly out of `styles/tokens.css` using regex `--([\w-]+):\s*(#[\da-f]{6})\s*;` and verifies `>= 4.5:1` WCAG AA contrast across all 4 surfaces in Node without a browser engine.
- **Cascade & Responsiveness Debt (`styles/frame.css`, `styles/creature.css`, `styles/motion.css`, `styles/density.css`, `tools/check-project.mjs`):**
  - `styles/creature.css` mixes `container: bestiary-sheet / size` with viewport units (`font-size: clamp(1.6rem, 3vw, 2.2rem);`), causing heading size to scale with the monitor rather than the resizable Foundry window.
  - `styles/frame.css` uses `:where(.bestiary-app .window-content) button` to counter Foundry's `elements.forms` `--button-size` pinning, plus `!important` rules for `[hidden]`, `.minimized`, `.aim-theme-fade`, and `styles/motion.css`.
  - `tools/check-project.mjs` checks `manifest.styles` entries with `existsSync(join(root, path))` assuming string paths (so any future `{ src, layer }` object entry in `module.json` would require updating `entry.src ?? entry` in `check-project.mjs`).

---

## 2. OFL-Licensed Tri-Font Evaluation (Cyrillic + Latin)

### 2.1 Evaluation Criteria

Every candidate must satisfy five non-negotiable engineering requirements:

1. **License:** Verified **SIL Open Font License 1.1 (`OFL`)** per `google/fonts` `METADATA.pb` and upstream license files (compatible with Foundry module redistribution and GPL-3.0 package bundling; Apache-2.0 fonts are excluded).
2. **Complete Cyrillic + Latin Script Coverage:** Both `cyrillic` (`U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`) and `cyrillic-ext` (`U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`) alongside `latin` and `latin-ext`, ensuring Russian, Ukrainian, Belarusian, Bulgarian, Serbian, and archaic/transliterated glyphs render cleanly without system fallback flashes.
3. **True Italic & Weight Coverage:** Separate or variable italic geometry so Cyrillic cursive forms (`г`, `д`, `и`, `п`, `т`) are authentic rather than slanted obliques (`font-synthesis: style`).
4. **Tactical & Numerical Legibility:** Support for tabular figures (`tnum` / `font-variant-numeric: tabular-nums`), unambiguous `0`/`O`, `1`/`l`/`I`, and `3`/`З`, balanced x-height harmony across the 3-font pair, and disabling code ligatures on dice/stat formulas.
5. **Foundry Module `.woff2` Footprint:** Split via `unicode-range` subsets so only `cyrillic`, `cyrillic-ext`, `latin`, and `latin-ext` ship inside `assets/fonts/` (`tools/package-files.mjs`).

### 2.2 Display Serif Candidates (Headings, Creature Titles, Collection Headers)

| Font Family | License / Upstream | Subsets (`METADATA.pb`) | Axes & Styles | Cyrillic Provenance & Metrics | Trade-offs | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Literata** | OFL 1.1 · `googlefonts/literata` (TypeTogether) | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `greek`, `greek-ext`, `vietnamese` | Variable `opsz: 7–72`, `wght: 200–900` + True Italic (`ital` 0/1) | Cyrillic crafted by **Vera Evstafieva** (with Elena Novoselova); `tnum` support; `opsz` automatically thickens hairlines at `17–22px` subheads and sharpens editorial contrast at `24–36px` titles | Multi-axis (`opsz,wght`) variable files are heavier than single-axis fonts; keep only `cyrillic*` + `latin*` subsets (or italic limited to `400..700`) | **#1 Primary Pick** |
| **Source Serif 4** | OFL 1.1 · `adobe-fonts/source-serif` (Adobe) | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `greek`, `vietnamese` | Variable `opsz: 8–60`, `wght: 200–900` + True Italic | Full Cyrillic + localized Bulgarian (`locl`), `tnum` OpenType support, chiseled transitional proportions with compact horizontal set width | Slightly narrower/sharper serifs on low-DPI dark screens than Literata; still strong if denser header fit is preferred | **#2 Runner-up** |
| **Lora** | OFL 1.1 · `cyrealtype/Lora-Cyrillic` (Cyreal) | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese` | Variable `wght: 400–700` + True Italic | Native Russian/Cyrillic roots by Olga Karpushina & Alexei Vanyashin (Cyreal); very compact `.woff2` footprint | No `opsz` axis and `wght` capped at `400..700` (cannot reach `800` extra-bold editorial display contrast or `300` large deck subheads) | **#3 Lightweight Fallback** |
| **Spectral** | OFL 1.1 · `productiontype/spectral` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese` | Static-first on Fontsource (weights 200–800 + italics); variable builds upstream | Cyrillic designed by **Ilya Ruderman & Yury Ostromentsky** (CSTM Fonts); digital-first metrics | Static distribution requires shipping multiple individual weight `.woff2` files; less expressive display character than Literata | **Evaluated (Static-heavy)** |
| **Cormorant Garamond** | OFL 1.1 · `CatharsisFonts/Cormorant` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese` | Variable `wght: 300–700` + Italic | Cyrillic built with Alexei Vanyashin; explicit `tnum`/`onum`/`lnum`; relatively small x-height | Extreme hairline stroke contrast breaks up/shimmers on dark `Dark Graphite Ink` below `24px`, and small x-height jars next to UI Sans | **Rejected** |
| **Newsreader** | OFL 1.1 · `productiontype/Newsreader` | Latin Plus only | Variable `opsz`, `wght` | **No Cyrillic coverage** in standard Google Fonts / upstream release | Cannot render Russian UI | **Disqualified** |

### 2.3 UI Sans Candidates (Controls, Prose, Statblock Copy, Notes)

| Font Family | License / Upstream | Subsets (`METADATA.pb`) | Axes & Styles | Cyrillic Provenance & Metrics | Trade-offs | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Inter (v4.1+)** | OFL 1.1 · `rsms/inter` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `greek`, `greek-ext`, `vietnamese` | Variable `opsz: 14–32`, `wght: 100–900`; split Roman + True Italic (`v4+`) | Tall UI-tuned x-height; `tnum` tabular figures (`font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum" 1` per `rsms/inter#813`); `cv05` (tailed `l`) disambiguates `1`/`l`/`I`; true Cyrillic italics | Full `@fontsource-variable/inter` is `1.8 MB` unpacked across all scripts — **must** bundle only `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext` `.woff2` slices; when `tnum` is active, `1` renders with a baseline foot (`rsms/inter#557/#905`) | **#1 Primary Pick** |
| **IBM Plex Sans** | OFL 1.1 · `IBM/plex` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese` | Variable `wght: 100–700`, `wdth` + Italic | Bold Monday / IBM; localized Bulgarian Cyrillic (`locl`) + combining-mark tuning; deliberately harmonized x-height & `hhea`/`OS/2` metrics with IBM Plex Mono | Distinct industrial-technical voice; if shipping `wdth` + italic variable fonts together payload grows — restrict to standard width (`100`) | **#2 Runner-up** |
| **Commissioner** | OFL 1.1 · `kosbarts/Commissioner` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `greek`, `vietnamese` | Variable `wght`, `slnt`, `FLAR`, `VOLM` | Humanist sans with Cyrillic consultation by Maria Doreuli; `tnum` support | Uses `slnt` oblique rather than true cursive italic; `FLAR`/`VOLM` axes add unnecessary binary weight if unused | **Evaluated** |
| **Golos Text** | OFL 1.1 · `googlefonts/golos-text` (ParaType) | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext` | Variable `wght: 400–900` (`style: "normal"` **only** in `METADATA.pb`) | Crafted specifically for Russian digital UI by Alexandra Korolkova & Vitaly Kuzmin | **No true italic** (`METADATA.pb` lists `GolosText[wght].ttf` normal only); rich `dnd5e` descriptions/notes italicize spell/condition names and would suffer synthetic browser obliquing | **Disqualified (No Italic)** |
| **Onest** *(Retiring)* | OFL 1.1 · `simpals/onest` (`assets/fonts/`) | `cyrillic-ext`, `cyrillic`, `latin-ext`, `latin` | Variable `wght: 100–900` upright only | Local baseline: `88,612 B` (`86.5 KiB`) across 4 files | Explicitly retired per `Road to 8.0` to break from AIM identity | **Retire** |

### 2.4 Data Monospace Candidates (`CR`, `DC`, `HP`, `AC`, Modifiers, Dice Formulas, Tier Codes)

| Font Family | License / Upstream | Subsets (`METADATA.pb`) | Axes & Styles | Metrics & Tactical Legibility | Trade-offs | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **JetBrains Mono** | OFL 1.1 · `JetBrains/JetBrainsMono` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `greek`, `greek-ext`, `vietnamese` | Variable `wght: 100–800`, `ital: 0–1` | **`1000` UPM, `550` x-height** (55% — maximally readable at `11–13px` badges/cells); dotted `0` vs `O`, distinct `1`/`l`/`I` & `3`/`З`; inherent tabular metrics; Cyrillic Google Fonts slice ~`8.9 KB` (`cyrillic`) + ~`1.6 KB` (`cyrillic-ext`); full Fontsource variable `199 kB` | Ships coding ligatures enabled in some contexts — **must** set `font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0;` (or use the `NL` No-Ligatures build) so `1d8+4`, `->`, `>=`, `<=` never morph | **#1 Primary Pick** |
| **IBM Plex Mono** | OFL 1.1 · `IBM/plex` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese` | Static 7 weights (`100–700`, normal + italic) on Fontsource; variable upstream | Dotted zero, clean typewriter-ledger character for *Warm Archival Paper*, shares vertical metrics with IBM Plex Sans | Static-first packaging on Fontsource requires bundling discrete weight files (e.g., `400`, `600`, `700` upright) rather than one `wght` binary | **#2 Runner-up** |
| **Fira Code** | OFL 1.1 · `tonsky/FiraCode` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `greek`, `greek-ext`, `symbols2` | Variable `wght: 300–700` (no `ital` axis on Fontsource) | Full Cyrillic + box-drawing `symbols2` | No variable italic; ligature-centric design requires disabling `calt`/`liga` everywhere | **Evaluated** |
| **Martian Mono** | OFL 1.1 · `evilmartians/mono` | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext` | Variable `wght`, `wdth` (no native continuous italic on Fontsource) | Native Russian/Ukrainian/Belarusian design by Evil Martians | Brutalist/heavy geometric rhythm crowds tight `dnd5e` modifier cells unless width is condensed | **Evaluated** |
| **Roboto Mono** | Apache 2.0 · `google/fonts` | — | — | — | Not OFL-licensed | **Disqualified (License)** |

### 2.5 Canonical Tri-Font Stack & Bundling Strategy

- **Selected Stack:** **`Literata` (Display Serif) + `Inter` (UI Sans) + `JetBrains Mono` (Data Monospace)**, aliased in `@font-face` as `"BJ Literata"`, `"BJ Inter"`, and `"BJ JetBrains Mono"` to prevent collisions with locally installed OS fonts or Foundry theme overrides.
- **Fallback Stacks:**
  ```css
  --ds-font-display: "BJ Literata", Georgia, "Times New Roman", serif;
  --ds-font-sans: "BJ Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --ds-font-mono: "BJ JetBrains Mono", ui-monospace, "Cascadia Mono", "SFMono-Regular", monospace;
  ```
- **Packaging & Subsetting Rules (`assets/fonts/`):**
  - Bundle **strictly** the 4 required `unicode-range` subsets (`cyrillic-ext`, `cyrillic`, `latin-ext`, `latin`) per family/style; drop `vietnamese`, `greek`, `greek-ext`, and `menu`.
  - Keep `font-display: swap;` and `format("woff2")` (Chromium 144+ supports standard `format("woff2")` directly for variable fonts without legacy `woff2-variations` hacks, though `woff2` with `tech(variations)` or `format("woff2")` is baseline).
  - For **JetBrains Mono**, upright variable `[wght]` covering `400..700` (4 subset files) suffices for statblocks/badges/tables (omit italic mono unless code blocks need it).
  - For **Literata** and **Inter**, bundle both upright variable and italic variable subsets across `cyrillic*` + `latin*`, keeping accompanying `OFL-literata.txt`, `OFL-inter.txt`, and `OFL-jetbrains-mono.txt` license files in `assets/fonts/` per OFL Section 1 Condition 2.
  - Apply OpenType feature guards in base rules:
    - UI Sans numeric stability: `font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "cv05" 1;` (verify `cv05` does not alter Cyrillic glyphs; apply `"cv05"` selectively or validate RU rendering in `tools/live-check.js`).
    - Data Mono literal syntax: `font-variant-numeric: tabular-nums; font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0;`.
  - Update `tools/live-check.js` `FACES` array from `["Bestiary Onest"]` to `["BJ Literata", "BJ Inter", "BJ JetBrains Mono"]` (plus Font Awesome icon exclusions already present in `isIcon`).

---

## 3. Pure-CSS Container-Query Fluid Typography & Spacing (`REM + clamp()`)

### 3.1 Runtime Support & Architectural Rationale

Foundry VTT `v14.367` ships on **Electron 40+ / Chromium 144+** (and `v14.371` on **Electron 45.3.4 / Chromium 156**), while browser clients target evergreen Chrome/Firefox/Safari. Both `@container` / `cqi` (Chrome `105+`, Firefox `110+`, Safari `16+`) and `clamp()` (Chrome `79+`) are **Baseline Widely Available**.

Why `cqi + rem` replaces `vw + px`:
- Foundry `ApplicationV2` windows resize independently from `440px` (`min-width` in `styles/frame.css`) up to `1240px+`, and split internally into library + inspector panes. Using `vw` (as legacy `styles/creature.css` line 117 did: `clamp(1.6rem, 3vw, 2.2rem)`) scales headings by monitor width instead of window width.
- Using `rem` for the bounds and intercept respects Foundry's user-configured UI/font scale (`uiConfig`, `fontSize` / root `font-size`) and WCAG 2.1 SC 1.4.4 (200% text resize).

### 3.2 `css-contain-3` Rules & Subtle Traps to Avoid

1. **Always use `container-type: inline-size` (not `size`) for fluid flow containers:**
   - `container-type: size` applies block-size containment, which collapses an auto-height container to `0` unless its height is explicitly pinned (as `.creature-detail-wrapper` had to do with `height: 100%`). Use `container: ds-window / inline-size;` on `.ds-window-content` and `container: ds-pane / inline-size;` on side rails/inspector panes.
2. **Never query a container from itself (and never `@property`-type fluid `cqi` vars as `<length>` on the container):**
   - Per CSS Containment Module Level 3, `cqi` resolves against the **nearest ancestor** query container. Defining `--ds-*` tokens as standard **unregistered** CSS custom properties keeps them as token streams until `var(--ds-*)` is evaluated on descendant elements (like `h1`, `p`, `.ds-cell`), so they measure `.ds-window-content` (or a nested `.ds-pane`) accurately.
   - Registering a `cqi`-based token via `@property { syntax: "<length>"; }` on `.ds-window` would freeze its pixel computation on `.ds-window` itself against the *viewport*! Keep fluid `cqi` tokens unregistered.
3. **Clean Fallback Outside Query Containers (`css-contain-3` normative behavior):**
   - When a portable component (e.g., a Bestiary chat card inside `.chat-log` or a standalone dialog snippet) has **no** ancestor with `container-type: inline-size`, `css-contain-3` dictates: *"If no eligible query container is available, then use the small viewport size for that axis"* (`svi`). Because every token is clamped between `min_rem` and `max_rem`, `clamp()` stays strictly bounded and readable everywhere with zero media-query fallbacks required.

### 3.3 Exact `REM + clamp()` Scale (`30rem` → `75rem` Container Width)

Using linear interpolation across container inline widths $w_{\min} = 30\,\text{rem}$ (`480px` at `16px` root) to $w_{\max} = 75\,\text{rem}$ (`1200px` at `16px` root):

$$\text{slope}_{cqi} = \frac{y_{\max} - y_{\min}}{w_{\max} - w_{\min}} \times 100, \qquad \text{intercept}_{rem} = y_{\min} - \frac{\text{slope}_{cqi}}{100} \times w_{\min}$$

| Token | Role | Min (`<=30rem`) | Max (`>=75rem`) | Pure-CSS `clamp()` Value | Line Height / Notes |
| --- | --- | --- | --- | --- | --- |
| `--ds-text-display-xl` | Dossier H1 (Creature name) | `1.5rem` (`24px`) | `2.25rem` (`36px`) | `clamp(1.5rem, 1.0000rem + 1.6667cqi, 2.25rem)` | `1.12`, `text-wrap: balance` |
| `--ds-text-display-lg` | Collection / Section H2 | `1.25rem` (`20px`) | `1.625rem` (`26px`) | `clamp(1.25rem, 1.0000rem + 0.8333cqi, 1.625rem)` | `1.18`, `text-wrap: balance` |
| `--ds-text-display-md` | Subhead / Family / Block H3 | `1.0625rem` (`17px`) | `1.25rem` (`20px`) | `clamp(1.0625rem, 0.9375rem + 0.4167cqi, 1.25rem)` | `1.24` |
| `--ds-text-body` | UI Sans primary prose & controls | `0.875rem` (`14px`) | `0.9375rem` (`15px`) | `clamp(0.875rem, 0.8333rem + 0.1389cqi, 0.9375rem)` | `1.50` (`1.60` in prose) |
| `--ds-text-sm` | Secondary UI labels, metadata | `0.75rem` (`12px`) | `0.8125rem` (`13px`) | `clamp(0.75rem, 0.7083rem + 0.1389cqi, 0.8125rem)` | `1.40` |
| `--ds-text-xs` | Micro kickers, table column headers | `0.6875rem` (`11px`) | `0.75rem` (`12px`) | `clamp(0.6875rem, 0.6458rem + 0.1389cqi, 0.75rem)` | `1.30`, `letter-spacing: 0.06em` |
| `--ds-text-mono` | Statblock `CR`, `DC`, `HP`, `AC`, rolls | `0.8125rem` (`13px`) | `0.875rem` (`14px`) | `clamp(0.8125rem, 0.7708rem + 0.1389cqi, 0.875rem)` | `1.35`, `tnum`, `ligatures: none` |
| `--ds-text-mono-sm` | Compact mono chips, tier tags, dice | `0.6875rem` (`11px`) | `0.75rem` (`12px`) | `clamp(0.6875rem, 0.6458rem + 0.1389cqi, 0.75rem)` | `1.25`, `tnum`, `ligatures: none` |
| `--ds-space-1` | Hairline/tight gutter | `0.25rem` (`4px`) | `0.25rem` (`4px`) | `0.25rem` | Static `4px` base unit |
| `--ds-space-2` | Control inner gap | `0.375rem` (`6px`) | `0.5rem` (`8px`) | `clamp(0.375rem, 0.2917rem + 0.2778cqi, 0.5rem)` | — |
| `--ds-space-3` | Ledger cell padding / compact gap | `0.5rem` (`8px`) | `0.75rem` (`12px`) | `clamp(0.5rem, 0.3333rem + 0.5556cqi, 0.75rem)` | — |
| `--ds-space-4` | Panel padding / card gutter | `0.75rem` (`12px`) | `1rem` (`16px`) | `clamp(0.75rem, 0.5833rem + 0.5556cqi, 1rem)` | — |
| `--ds-space-5` | Window section gap | `1rem` (`16px`) | `1.5rem` (`24px`) | `clamp(1rem, 0.6667rem + 1.1111cqi, 1.5rem)` | — |
| `--ds-space-6` | Outer dossier margin | `1.25rem` (`20px`) | `2rem` (`32px`) | `clamp(1.25rem, 0.7500rem + 1.6667cqi, 2rem)` | — |

- **Density Adaptation Without `styles/density.css` Bloat:** Instead of 111 lines of selector overrides (`styles/density.css`), introduce `--ds-density: 1` (comfortable) vs `--ds-density: 0.75` (compact) applied selectively to padding/gap tokens (`calc(var(--ds-space-4) * var(--ds-density))`), while keeping typography tokens (`--ds-text-*`) untouched so compact mode never drops below legible font minimums.
- **Structural Breakpoints (`@container`):** Combine fluid tokens with explicit layout reflow queries on `ds-window` (e.g., `@container ds-window (inline-size < 45rem)` collapses multi-column inspector rails cleanly without horizontal overflow).

---

## 4. WCAG 2.1 AA/AAA Contrast & Anti-Liquid Glass Color Architecture

### 4.1 Design Rules (Strict Anti-Liquid Glass)

1. **Zero Translucent Blur Over Content:** No `backdrop-filter: blur(...)`, no semi-transparent card/header backgrounds (`rgb(... / 72%)`), and no cursor spotlight overlays (`.bestiary-spot`). Every surface tier is a solid, opaque sRGB hex token.
2. **Opaque Derived Tints Only:** Hover, selected, and tier-tinted backgrounds mix into `var(--ds-surface)` — **never** `transparent`:
   ```css
   --ds-accent-tint: color-mix(in oklab, var(--ds-accent) 12%, var(--ds-surface));
   --ds-hover-surface: color-mix(in oklab, var(--ds-text) 6%, var(--ds-surface));
   ```
   Because both operands are opaque, WCAG contrast remains mathematically deterministic on every screen.
3. **Rule vs. Control Boundary Separation (WCAG 2.1 SC 1.4.11):**
   - Purely decorative structural hairline grids (`1px solid var(--ds-rule)`) stay restrained (~`1.2:1–1.5:1`) so dense tabular ledgers feel crisp without visual clutter.
   - Active UI control boundaries (inputs, selects, outlined buttons, checkboxes, toggle switches) use `--ds-border-control`, engineered strictly to `>= 3.0:1` across all 4 surface stops (`SC 1.4.11`).
4. **Static Verification Compatibility:** Canonical palette stops remain concrete 6-digit hex values inside explicit theme blocks so `tests/theme-contrast.test.js` validates every contrast pair in plain Node.js without browser emulation.

### 4.2 Verified Palettes & Computed WCAG 2.1 Contrast Matrix

All contrast ratios below were computed against the W3C WCAG 2.1 relative luminance formula ($L = 0.2126 R + 0.7152 G + 0.0722 B$ with sRGB linearization threshold `0.04045`, ratio $(L_1 + 0.05)/(L_2 + 0.05)$) across all 4 opaque surfaces plus an opaque `12%` self-tint over `--ds-surface`.

#### A. Preset 1: **Dark Graphite Ink** (Canonical Dark — Warm Neutral Carbon, Zero Blue Slate)

- **Surfaces:** `--ds-sunken: #0e0e0d` · `--ds-bg: #141413` · `--ds-surface: #1c1c1a` · `--ds-raised: #252522`
- **Structural Rules:** `--ds-rule: #2f2e2b` (`1.13:1–1.42:1`) · `--ds-rule-strong: #484640` (`1.63:1–2.05:1`)

| Token | Hex | `bg` | `surface` | `raised` | `sunken` | `min` | `12% tint` | WCAG Level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--ds-text` | `#f2efe9` | `16.06:1` | `14.87:1` | `13.39:1` | `16.83:1` | **`13.39:1`** | `10.68:1` | **AAA** (`>=7:1`) |
| `--ds-text-muted` | `#c2bdb3` | `9.85:1` | `9.12:1` | `8.21:1` | `10.32:1` | **`8.21:1`** | `7.16:1` | **AAA** (`>=7:1`) |
| `--ds-text-subtle` | `#9f998e` | `6.51:1` | `6.03:1` | `5.43:1` | `6.83:1` | **`5.43:1`** | `5.00:1` | **AA** (`>=4.5:1`) |
| `--ds-border-control` | `#737068` | `3.73:1` | `3.45:1` | `3.11:1` | `3.91:1` | **`3.11:1`** | `3.07:1` | **AA Non-Text** (`>=3:1`) |
| `--ds-accent` *(Steel Cobalt)* | `#76b7f4` | `8.65:1` | `8.01:1` | `7.21:1` | `9.06:1` | **`7.21:1`** | `6.39:1` | **AAA** (`>=7:1`) |
| `--ds-on-accent` | `#0b1622` | — | — | — | — | **`8.55:1`** *(on accent)* | — | **AAA** (`>=7:1`) |
| `--ds-positive` | `#5cc88b` | `8.86:1` | `8.20:1` | `7.38:1` | `9.28:1` | **`7.38:1`** | `6.53:1` | **AAA** (`>=7:1`) |
| `--ds-warning` | `#e5ab42` | `8.98:1` | `8.32:1` | `7.49:1` | `9.41:1` | **`7.49:1`** | `6.64:1` | **AAA** (`>=7:1`) |
| `--ds-danger` | `#f27970` | `6.80:1` | `6.29:1` | `5.67:1` | `7.12:1` | **`5.67:1`** | `5.26:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-unknown` *(Adapter)* | `#a8a296` | `7.26:1` | `6.72:1` | `6.06:1` | `7.61:1` | **`6.06:1`** | `5.50:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-rumors` *(Adapter)* | `#e49650` | `7.70:1` | `7.13:1` | `6.42:1` | `8.07:1` | **`6.42:1`** | `5.80:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-studied` *(Adapter)* | `#56bcc9` | `8.28:1` | `7.67:1` | `6.90:1` | `8.68:1` | **`6.90:1`** | `6.21:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-mastered` *(Adapter)* | `#e2b84f` | `9.83:1` | `9.11:1` | `8.20:1` | `10.30:1` | **`8.20:1`** | `7.12:1` | **AAA** (`>=7:1`) |
| `--bj-tier-never` *(Adapter)* | `#ec7c91` | `6.90:1` | `6.39:1` | `5.75:1` | `7.23:1` | **`5.75:1`** | `5.29:1` | **AA** (`>=4.5:1`) |

#### B. Preset 2: **Warm Archival Paper** (Canonical Light — Unbleached Rag Paper & Iron-Gall Ink)

- **Surfaces:** `--ds-surface: #f7f4ec` · `--ds-bg: #ede9df` · `--ds-raised: #e3ded2` · `--ds-sunken: #dad4c6`
- **Structural Rules:** `--ds-rule: #d0c9ba` (`1.12:1–1.50:1`) · `--ds-rule-strong: #aba393` (`1.69:1–2.28:1`)

| Token | Hex | `bg` | `surface` | `raised` | `sunken` | `min` | `12% tint` | WCAG Level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--ds-text` | `#181613` | `14.89:1` | `16.43:1` | `13.45:1` | `12.22:1` | **`12.22:1`** | `12.81:1` | **AAA** (`>=7:1`) |
| `--ds-text-muted` | `#403c35` | `9.04:1` | `9.97:1` | `8.17:1` | `7.42:1` | **`7.42:1`** | `8.15:1` | **AAA** (`>=7:1`) |
| `--ds-text-subtle` | `#575148` | `6.47:1` | `7.14:1` | `5.85:1` | `5.31:1` | **`5.31:1`** | `5.96:1` | **AA** (`>=4.5:1`) |
| `--ds-border-control` | `#6e675d` | `4.61:1` | `5.08:1` | `4.16:1` | `3.78:1` | **`3.78:1`** | `4.36:1` | **AA Non-Text** (`>=3:1`) |
| `--ds-accent` *(Blueprint Cobalt)* | `#16558f` | `6.34:1` | `7.00:1` | `5.73:1` | `5.21:1` | **`5.21:1`** | `5.82:1` | **AA** (`>=4.5:1`) |
| `--ds-on-accent` | `#f7f4ec` | — | — | — | — | **`7.00:1`** *(on accent)* | — | **AAA** (`>=7:1`) |
| `--ds-positive` | `#146038` | `6.28:1` | `6.92:1` | `5.67:1` | `5.15:1` | **`5.15:1`** | `5.76:1` | **AA** (`>=4.5:1`) |
| `--ds-warning` | `#784b00` | `6.18:1` | `6.81:1` | `5.58:1` | `5.07:1` | **`5.07:1`** | `5.71:1` | **AA** (`>=4.5:1`) |
| `--ds-danger` | `#a82119` | `5.98:1` | `6.60:1` | `5.40:1` | `4.91:1` | **`4.91:1`** | `5.42:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-unknown` *(Adapter)* | `#524d44` | `6.92:1` | `7.63:1` | `6.25:1` | `5.68:1` | **`5.68:1`** | `6.36:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-rumors` *(Adapter)* | `#88400c` | `6.22:1` | `6.86:1` | `5.62:1` | `5.10:1` | **`5.10:1`** | `5.70:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-studied` *(Adapter)* | `#125b62` | `6.42:1` | `7.08:1` | `5.80:1` | `5.27:1` | **`5.27:1`** | `5.91:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-mastered` *(Adapter)* | `#684a07` | `6.74:1` | `7.43:1` | `6.08:1` | `5.53:1` | **`5.53:1`** | `6.20:1` | **AA** (`>=4.5:1`) |
| `--bj-tier-never` *(Adapter)* | `#8a2243` | `7.25:1` | `7.99:1` | `6.54:1` | `5.95:1` | **`5.95:1`** | `6.54:1` | **AA** (`>=4.5:1`) |

> [!TIP]
> Note how `--bj-tier-never` shifts to muted wine/rose (`#ec7c91` / `#8a2243`) rather than aliasing `--ds-danger` (`#f27970` / `#a82119`), distinguishing GM-only redacted knowledge from roll failure/destructive actions while remaining clearly distinguishable under common color-vision deficiencies via paired iconography and text labels.

### 4.3 Automatic Foundry Color-Scheme Switching & `forced-colors`

In Foundry VTT v13/v14, `uiConfig.colorScheme.interface` drives `.theme-dark` or `.theme-light` on `document.body`, `uiConfig.colorScheme.applications` drives `.themed.theme-dark` or `.themed.theme-light` on `ApplicationV2` windows, and `.chat-log` / `.chat-message` can declare `.theme-light` inside a `.theme-dark` interface (`styles/content.css`, `scripts/foundry/theme-root.js`).

- **Pure-CSS Nested Theme Matching (Zero Module Theme Settings Needed):**
  Using CSS `@scope` (supported in Chrome `118+`, native in Foundry v14's Electron `40+`), the nearest `.theme-dark` or `.theme-light` ancestor wins automatically without any JS `MutationObserver` or `data-theme` setting:
  ```css
  /* Default Dark Graphite Ink fallback + explicit dark scope */
  .ds-root {
    color-scheme: dark;
    /* ... Dark Graphite Ink hex tokens ... */
  }

  @scope (.theme-light) to (.theme-dark) {
    :is(.ds-root, .ds-chat-card) {
      color-scheme: light;
      /* ... Warm Archival Paper hex tokens ... */
    }
  }

  @scope (.theme-dark) to (.theme-light) {
    :is(.ds-root, .ds-chat-card) {
      color-scheme: dark;
      /* ... Dark Graphite Ink hex tokens ... */
    }
  }
  ```
  *(Standalone non-Foundry HTML prototypes simply attach `class="theme-light"` or `class="theme-dark"` on the wrapper or `<body>`.)*

- **`light-dark()` Complementary Usage:** For secondary derived variables that do not need static regex parsing (e.g., scrollbar thumbs or elevation hairlines when `color-scheme` is already set), `light-dark(<light-val>, <dark-val>)` is Baseline in Chrome `123+` (`Electron 40+`). Keeping canonical hex pairs inside `.ds-root` / `@scope` ensures both `light-dark()` native controls (scrollbars, `<select>` popups) and Node static contrast tests work together seamlessly.

- **Strict `@media (forced-colors: active)` Compliance:**
  Because hairline structural grids rely on low-contrast rules (`--ds-rule`) and flat fills, Windows High Contrast / `forced-colors: active` strips author backgrounds and colors:
  ```css
  @media (forced-colors: active) {
    .ds-root {
      --ds-bg: Canvas;
      --ds-surface: Canvas;
      --ds-raised: Canvas;
      --ds-sunken: Canvas;
      --ds-text: CanvasText;
      --ds-text-muted: CanvasText;
      --ds-text-subtle: GrayText;
      --ds-rule: ButtonText;
      --ds-border-control: ButtonText;
      --ds-accent: LinkText;
      --ds-on-accent: HighlightText;
    }
    .ds-root :is(button, input, select, textarea, .ds-card, .ds-ledger, .ds-badge) {
      border: 1px solid ButtonText;
    }
    .ds-root :is(.is-active, .is-selected, [aria-selected="true"], [aria-current="true"]) {
      background-color: Highlight;
      color: HighlightText;
      forced-color-adjust: none;
    }
    .ds-root :focus-visible {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
  ```

---

## 5. Native CSS `@layer` Cascade Architecture & Foundry v14 Isolation

### 5.1 Foundry VTT v14 & `dnd5e` Cascade Mechanics

Per Foundry VTT v13/v14 core architecture and `foundryvtt.com` documentation, Foundry declares ten top-level cascade layers in ascending priority order:

```css
@layer reset, variables, elements, blocks, applications, compatibility, layouts, system, modules, exceptions;
```

Foundry loads package stylesheets via `<style>` tags executing `@import "<path>" layer(<target>);`:
- `dnd5e` (`foundryvtt/dnd5e/system.json` `"styles": ["dnd5e.css"]`) enters the **`system`** layer.
- Any module stylesheet listed as a string in `module.json` `"styles"` automatically enters the **`modules`** layer (or an explicit `{ "src": "...", "layer": "..." | null }` object).

Per **W3C CSS Cascading and Inheritance Level 5 (`css-cascade-5`)**:
1. **Normal declarations:** `reset < ... < system < modules < exceptions < (unlayered normal)`. A rule in `modules` **always** beats any rule in `elements`, `applications`, `layouts`, or `system` (`dnd5e`), regardless of selector specificity (`(0,0,0)` `:where(...)` in `modules` beats `#dnd5e-sheet .window-content button` in `system`).
2. **`!important` declarations (Inversion Rule):** Layer precedence **reverses** under `!important`:
   `reset !important > ... > system !important > modules !important > exceptions !important > unlayered !important`.
   Thus, Foundry's `exceptions` `[hidden] { display: none !important; }` or any `!important` in `dnd5e` (`system !important`) overrides normal `modules` rules — and unlayered `!important` is the **lowest** `!important` priority overall!

### 5.2 Recommended Portable `@layer` Architecture

Keep `module.json` entries inside Foundry's default `modules` layer (no `"layer": null` hijacking of Foundry's global `exceptions`), and declare an explicit **internal sub-layer order** at the very top of the entry stylesheet (`styles/ds-entry.css` or the first file in `module.json`):

```css
/* Inside Foundry: @import "styles/ds-entry.css" layer(modules) nests these as modules.ds-*
   Standalone prototype: creates top-level @layer ds-* with identical internal precedence. */
@layer ds-tokens, ds-reset, ds-base, ds-layout, ds-components, ds-adapter, ds-states;
```

| Sub-Layer | Responsibility | Portability Boundary | Specificity Strategy |
| --- | --- | --- | --- |
| `ds-tokens` | `@font-face` (`BJ Literata/Inter/JetBrains Mono`), fluid `clamp()` scales, **Dark Graphite Ink** + `@scope` **Warm Archival Paper** hex tokens | **Design System Core** (domain-free) | `:where(.ds-root)` / `@scope` |
| `ds-reset` | Neutralize Foundry `elements.forms` button sizing (`height: auto; min-height: 0;`), heading borders/margins, list resets inside `.ds-root` | **Design System Core** | `:where(.ds-root) ...` `(0,0,0)` so components win effortlessly |
| `ds-base` | Tri-font element defaults, tabular figures, `ligatures: none` on mono, `:focus-visible` ring, scrollbars | **Design System Core** | Low-specificity class/element rules |
| `ds-layout` | Window container (`container: ds-window / inline-size`), hairline `1px` grid shells, split panes, `@container` reflows | **Design System Core** | Single-class selectors |
| `ds-components` | Domain-free primitives: ledgers, buttons, badges, search fields, tabs, disclosures, context menus | **Design System Core** | Single-class + state modifiers |
| `ds-adapter` | Bestiary semantic tokens (`--bj-tier-*`, `--bj-cr-*`, `--bj-dc-*`), statblock typography, knowledge ladder, chat cards, `Actor`/`Token HUD` hooks | **Bestiary Theme Adapter** | Maps `--bj-*` onto `--ds-*` |
| `ds-states` | Density multiplier (`--ds-density`), motion suppression (`[data-motion="off"]`, `prefers-reduced-motion: reduce`), `forced-colors` overrides, `[hidden]` invariants | **Core + Adapter** | Placed last for normal state overrides; reserves `!important` strictly for `[hidden]` & reduced-motion guarantees |

### 5.3 Concrete Isolation Defenses (Zero `!important` Sprawl)

- **Defeating Foundry's `elements.forms` & `applications` styles:** Because `modules.ds-reset` and `modules.ds-components` sit above `elements` and `applications`, `:where(.ds-root) button { height: auto; min-height: 0; min-width: 0; }` cleanly beats Foundry's core `button` rules while preserving zero internal specificity `(0,0,0)` so `.ds-btn` inside `ds-components` styles every button variant cleanly without `!important`.
- **Defeating `dnd5e` (`system`) stylesheet leaks in enriched HTML & statblocks:** Any `dnd5e` rule inside `@layer system` loses to `modules.ds-base` / `modules.ds-adapter`. Wrap enriched descriptions (`.content-embed`, `a.content-link`, `table`) inside `ds-adapter` rather than relying on unlayered specificity hacks.
- **Preventing `ds-entry.css` from leaking out onto Foundry / `dnd5e`:** Every rule in `ds-reset`, `ds-base`, `ds-layout`, and `ds-components` must be rooted under `.ds-root` (or `.bestiary-app` / `.ds-chat-card`), except explicit tooltip overrides (`#tooltip.bestiary-tooltip`) that opt into our font stack.
- **Single-Manifest Compatibility Check (`tools/check-project.mjs`):** Keep `module.json` `"styles"` as string paths (`["styles/ds-entry.css"]` using native CSS `@import url("./...") layer(ds-...)` or explicit ordered files with the `@layer` declaration on line 1 of the first file). String paths automatically target `layer(modules)` in Foundry v14 and remain valid under existing `tools/check-project.mjs` path validation (`existsSync(join(root, path))`).
- **Two Legitimate Uses of `!important` Only:**
  1. `[hidden]` visibility invariant (`:where(.ds-root) [hidden] { display: none !important; }`) so `display: flex`/`grid` component rules never reveal hidden panels.
  2. Motion-off safety (`prefers-reduced-motion: reduce` / `[data-motion="off"]`) on `animation: none !important` and spatial `transition-property` suppression. Remember that if countering a third-party `@layer` `!important` rule, `css-cascade-5` gives *earlier* layers higher `!important` priority (`modules !important` already beats `exceptions !important`).

---

## 6. Implications for Downstream Wayfinder Decisions

- **For Decision #4 (`Design System Contract, Naming & Bestiary Theme Adapter`):**
  - Lock `--ds-*` as the domain-free Portable Design System Core namespace and `--bj-*` as the Bestiary Theme Adapter namespace.
  - Retire `uiTheme` ("Nocturne / Parchment / Like AIM") and `uiAccent` (6-accent picker) settings; follow Foundry `.theme-dark` / `.theme-light` automatically via `@scope`.
  - Update `tests/theme-contrast.test.js` to validate both Dark Graphite Ink and Warm Archival Paper hex tokens against all 4 surfaces + `on-accent`, plus `border-control >= 3.0:1` (`SC 1.4.11`).
- **For Prototype #7 (`Interactive Editorial Tactical Dossier`):**
  - Prototype CSS can use the exact `@layer ds-tokens, ...;` + `.theme-light` / `.theme-dark` `@scope` contract standalone in any modern Chromium browser with zero build step, then drop directly into Foundry `v14` under `"styles": ["styles/ds-entry.css"]`.

---

## Primary Sources Cited

- **Local Repository Files:**
  - `styles/tokens.css`, `styles/frame.css`, `styles/content.css`, `styles/creature.css`, `styles/density.css`, `styles/motion.css`
  - `assets/fonts/OFL-onest.txt`, `assets/fonts/onest-*.woff2`
  - `scripts/core/theme.js`, `scripts/foundry/theme-root.js`, `scripts/foundry/settings.js`, `scripts/ui/bestiary-app.js`
  - `tests/theme-contrast.test.js`, `tests/theme.test.js`, `tools/check-project.mjs`, `tools/live-check.js`, `tools/package-files.mjs`, `module.json`, `docs/architecture.md`
- **Google Fonts & Upstream OFL Font Repositories:**
  - Google Fonts Catalog Repository: <https://github.com/google/fonts>
  - Literata: <https://github.com/googlefonts/literata> · <https://github.com/google/fonts/tree/main/ofl/literata>
  - Source Serif 4: <https://github.com/adobe-fonts/source-serif> · <https://github.com/google/fonts/blob/main/ofl/sourceserif4/METADATA.pb>
  - Lora: <https://github.com/cyrealtype/Lora-Cyrillic> · <https://github.com/google/fonts/blob/main/ofl/lora/METADATA.pb>
  - Spectral: <https://github.com/productiontype/spectral> · <https://github.com/google/fonts/tree/main/ofl/spectral>
  - Cormorant Garamond: <https://github.com/CatharsisFonts/Cormorant> · <https://github.com/google/fonts/blob/main/ofl/cormorantgaramond/METADATA.pb>
  - Newsreader: <https://github.com/productiontype/Newsreader>
  - Inter: <https://github.com/rsms/inter> · <https://rsms.me/inter/> · <https://github.com/google/fonts/blob/main/ofl/inter/METADATA.pb>
  - IBM Plex (Sans & Mono): <https://github.com/IBM/plex> · <https://github.com/google/fonts/blob/main/ofl/ibmplexsans/METADATA.pb> · <https://github.com/google/fonts/blob/main/ofl/ibmplexmono/METADATA.pb>
  - Golos Text: <https://github.com/googlefonts/golos-text> · <https://github.com/google/fonts/blob/main/ofl/golostext/METADATA.pb>
  - Commissioner: <https://github.com/kosbarts/Commissioner> · <https://github.com/google/fonts/blob/main/ofl/commissioner/METADATA.pb>
  - JetBrains Mono: <https://github.com/JetBrains/JetBrainsMono> · <https://www.jetbrains.com/lp/mono/> · <https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/METADATA.pb>
  - Fira Code & Martian Mono: <https://github.com/tonsky/FiraCode> · <https://github.com/evilmartians/mono> · <https://github.com/google/fonts/blob/main/ofl/martianmono/METADATA.pb>
  - Fontsource Registry (variable package axis/size checks): <https://fontsource.org>
- **Foundry VTT, `dnd5e` & Electron Runtime:**
  - Foundry VTT Official Releases (`v13.332` `@layer`, `v13.336–13.337` Electron 33–34 / Chromium 122–132, `v14.355` Electron 40, `v14.367` Stable 9, `v14.371` Electron 45.3.4): <https://foundryvtt.com/releases/>
  - Foundry VTT Module Development & AI Policy: <https://foundryvtt.com/article/module-development/> · <https://foundryvtt.com/article/ai-policy/>
  - Foundry VTT Package Layer & Theme Architecture: <https://github.com/foundryvtt/foundryvtt> · <https://foundryvtt.com/api/>
  - D&D 5e System Repository: <https://github.com/foundryvtt/dnd5e>
  - Electron Releases (Electron 40 -> Chromium `144.0.7559.60`, Electron 45 -> Chromium `156.0.8078.48`): <https://www.electronjs.org>
- **W3C Specifications & MDN Web Docs:**
  - CSS Cascading and Inheritance Level 5 (`@layer`, sub-layers, `!important` reversal): <https://drafts.csswg.org/css-cascade-5/> · <https://developer.mozilla.org/en-US/docs/Web/CSS/@layer>
  - CSS Containment Level 3 (`@container`, `cqi` fallback to `svi`): <https://drafts.csswg.org/css-contain-3/> · <https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries>
  - CSS Values and Units Level 4 (`clamp()`): <https://drafts.csswg.org/css-values-4/> · <https://developer.mozilla.org/en-US/docs/Web/CSS/clamp>
  - CSS Color Module Level 4 & 5 (`oklch()`, `color-mix()`, `light-dark()`, `color-scheme`, `forced-colors`, `<system-color>`): <https://drafts.csswg.org/css-color-4/> · <https://drafts.csswg.org/css-color-5/> · <https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark> · <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors>
  - WCAG 2.1 Contrast Criteria (SC 1.4.3, SC 1.4.6, SC 1.4.11 & relative luminance): <https://www.w3.org/WAI/WCAG21/Understanding/>
