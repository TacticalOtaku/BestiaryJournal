# Foundry v14 `ApplicationV2` Performance, Partial DOM & Store/Artwork Audit (`v0.7.1`)

> **Scope:** Primary-source performance and structural audit of `BestiaryJournal v0.7.1` against **Foundry VTT v14.367** (`ApplicationV2` / `HandlebarsApplicationMixin`), **dnd5e v5.3.3**, and native Web Platform primitives.
> **Ticket:** Wayfinder `#3` — *Research: Foundry v14 ApplicationV2 Performance, Partial DOM & Store/Artwork Bottlenecks* (informs Architecture Decisions `#5` and `#6`).
> **Target Compatibility:** Foundry VTT `14.367+`, `dnd5e 5.3.3+`, zero-build native ES modules (no bundler/framework).

---

## Executive Summary

At small world sizes (`10–30` creatures), `BestiaryJournal 0.7.1` feels responsive because Foundry serves local world actors synchronously and small DOM trees mask redundant work. At **500+ creatures across multiple collections** (especially when referencing compendium actors), the `0.7.1` architecture hits compounding CPU, memory, RPC, and layout bottlenecks:

1. **Unmemoized store normalization & $O(N^2)$ linear UUID scanning:** Every call to `getBestiaryData()`, `getBestiaryKnowledge()`, `selectVisibleSections()`, `getWorldResearchTiers()`, and `getBestiarySocial()` allocates fresh deep-normalized structures. Inside loops (`buildCreatureRows`, `_buildSectionCards`, `BestiaryKnowledgeBoard`), `getEntryContexts()` linearly scans every section and creature entry per UUID ($O(N \times \text{entries})$), while `getWorldMaxResearchTier()` / `getWorldResearchTiers()` re-parse world settings per row and per item.
2. **Eager full-world actor & compendium resolution (`rowInputs` + `extractCreatureData` + `enrichHTML`):** Opening `BestiaryApp`—even on the **Overview** tab—resolves **every visible creature UUID** across all collections via `fromUuid()`, triggering individual `CompendiumCollection.getDocument()` RPC fetches and full `dnd5e` item/activity/rollData extraction (`categorizeActorItems`, `extractDamageModifications`). Opening `BestiaryCreatureView` enriches *every* item description and biography via `TextEditor.enrichHTML` *before* knowledge-tier filtering or accordion expansion.
3. **Single-part monolithic Handlebars re-renders & $3\times$ DOM amplification:** `BestiaryApp` (`1,597`-line template), `BestiarySectionView` (`820`-line duplicate template), and `BestiaryCreatureView` (`475`-line template) each declare a single `PARTS` entry. Every tab switch, tip cycle, favorite toggle, comment edit, or socket sync destroys and re-parses the entire window DOM. Collection views simultaneously render **three copies** of every creature (`grid` cards + hidden `list` rows + `N` hidden quick-preview panels), reaching **~35,000–45,000 DOM nodes** at 500 creatures—plus an extra hidden copy of all `N` creatures on Library Overview for client search.
4. **Layout-thrashing DOM search/sort & duplicate window wrapper:** `CollectionWorkspaceController.applyClientState()` reads `element.dataset` from every card in both views and unconditionally calls `container.appendChild(child)` across all cards on every search keystroke, even when sort order has not changed. Legacy `BestiarySectionView` (`216` lines + `820`-line template) duplicates the collection workspace with zero instantiation call sites left in the codebase.
5. **Eager dual-`<canvas>` artwork baking & global `document` pointer listener:** `bindArtwork()` allocates two `<canvas>` bitmaps (up to `1024px` + `256px`), paints synchronously with `drawImage`, strips `img[src]`, and executes `fetch() -> blob() -> createObjectURL()` on hover/focus—for *every* non-silhouette image, including static PNG/WebP portraits. `ui-effects.js` attaches a permanent `document.addEventListener("pointermove", ...)` across the entire Foundry UI/canvas.
6. **Uncontained CSS across 10 files (`6,609` lines / `144 KB`):** Zero `content-visibility: auto` or `contain` isolation on long lists/grids; live CSS `filter: blur(18px)` and `backdrop-filter: blur(6px)` layers; universal `*` rules (`motion.css`, `frame.css`); 6 relational `:has()` selectors; and global `text-rendering: optimizeLegibility` on `.window-content`.

### Bottleneck Summary Matrix

| Subsystem | Primary `0.7.1` Locations | Root Cause | Scale Impact (`500+` Creatures) |
| --- | --- | --- | --- |
| **Store & Domain Lookups** | `scripts/foundry/bestiary-store.js`, `scripts/core/bestiary-domain.js`, `scripts/foundry/creature-display.js`, `scripts/foundry/note-store.js` | No revision/reference memoization; `selectVisibleSections` re-normalizes & clamps `maxTier=3`; linear `getEntryContexts` scans inside loops; full Journal scan per render | $O(N^2)$ scans + hundreds of full-tree allocations per render and per Foundry actor/combat hook |
| **Actor & HTML Extraction** | `scripts/ui/creature-rows.js`, `scripts/foundry/creature-cache.js`, `scripts/integrations/dnd5e.js`, `scripts/ui/comments.js` | `rowInputs` resolves all visible UUIDs via `fromUuid`; full item/activity extraction for card grids; `enrichHTML` run pre-filter & pre-expand | Up to `500` compendium `getDocument()` RPCs on Overview; `5,000–15,000+` unused item extractions; redundant `enrichHTML` DOM parses |
| **Templates & Rendering** | `scripts/ui/bestiary-app.js`, `scripts/ui/collection-workspace.js`, `scripts/ui/section-view.js`, `scripts/ui/creature-view.js`, `templates/*.hbs` | Single-part `PARTS`; $3\times$ creature DOM duplication; full re-render on tips/favorites/rail/comment-channel; unconditional DOM reorder on keystroke | `~35k–45k` DOM nodes in Collection view; full HTML re-parse + listener rebind on minor interactions; `1,036` lines of dead `SectionView` code |
| **Artwork & Pointer Effects** | `scripts/ui/artwork.js`, `scripts/ui/ui-effects.js` | Dual `<canvas>` baking + `Blob` cache for static images; $O(K^2)$ `states.find` in IO; global `document` `pointermove` | Hundreds of MB of decoded canvas backing store; continuous global pointer hit-testing over Foundry canvas |
| **Stylesheets & Paint** | `styles/*.css` (`10` files, `6,609` lines) | Zero `content-visibility: auto`; `filter: blur(18px)` per card; universal `*` rules; 6 `:has()` selectors; global `optimizeLegibility`; redundant `.bestiary-journal` class | Full style/layout/paint over all off-screen cards & rows; expensive compositor blur layers |

---

## 1. Primary-Source Audit of `0.7.1` Bottlenecks

### 1.1 Store Reads, Repeated Normalization & Linear UUID Scanning

#### Repeated full-tree normalization on every read
In Foundry VTT `v14.367`, `ClientSettings#get()` (`client/helpers/client-settings.mjs:212-230`) performs a linear `WorldSettings#getSetting` scan (`client/documents/collections/world-settings.mjs:35-37`) and returns `Setting.value` directly (an already-parsed JSON object cached on the `Setting` document).

Despite Foundry already holding that object in memory, `bestiary-store.js` re-allocates an entire normalized copy on every read:
- `getBestiaryData()` (`scripts/foundry/bestiary-store.js:56-58`) calls `normalizeBestiaryData(game.settings.get(MODULE_ID, "bestiaryData"), maxTier)` (`scripts/core/bestiary-domain.js:84-162`), allocating new arrays and objects for every section, family, creature entry, `blockTiers` map, and `itemTiers` map.
- `getBestiaryKnowledge()` (`scripts/foundry/bestiary-store.js:60-62`) calls `normalizeKnowledge(...)` (`scripts/core/bestiary-domain.js:164-199`), cloning and normalizing every `(userId, uuid)` record.
- `selectVisibleSections(data, viewer)` (`scripts/core/bestiary-domain.js:259-263`) calls **`normalizeBestiaryData(data)` a second time** on already-normalized `data`, and omits `maxTier`, silently clamping custom world tier overrides down to `MAX_RESEARCH_TIER` (`3`) in the returned section objects!
- `applyBestiaryCommand()` (`scripts/core/bestiary-domain.js:382-388`) calls `cloneState(currentState, ...)` (`lines 1049-1056`) which re-runs `normalizeBestiaryData`, `normalizeKnowledge`, and `normalizeSocial` immediately after `persistCommand()` (`scripts/foundry/bestiary-store.js:248`) already built `createBestiaryState(getBestiaryState(readMax), readMax)`.

#### Per-render & per-hook read amplification
A single `BestiaryApp._prepareContext()` (`scripts/ui/bestiary-app.js:222-299`) triggers multiple redundant normalizations:
1. `getBestiaryData()` (`line 223`) — full tree normalization #1.
2. `selectVisibleSections(data, game.user)` (`line 226`) — full tree normalization #2.
3. If `isCollection`: `prepareCollectionContext()` (`scripts/ui/collection-workspace.js:51`) calls `selectVisibleSections(data, game.user)` — full tree normalization #3.
4. `getBestiaryKnowledge()` (`line 224`) — full knowledge normalization.
5. `getWorldMaxResearchTier()` (`scripts/foundry/creature-display.js:33-35`) and `getWorldResearchTiers()` (`lines 22-24`) call `normalizeResearchTiers(game.settings.get("bestiary-journal", "researchTiers"))` inside **per-creature and per-section loops**:
   - `buildCreatureRows()` (`scripts/ui/creature-rows.js:70`) calls `getWorldMaxResearchTier()` **once per creature row**, and `buildPartyBadge()` (`scripts/ui/knowledge-ui.js:60`) calls it **a second time per creature row**.
   - `_buildSectionCards()` (`scripts/ui/bestiary-app.js:353-373`) calls `buildCreatureRows([section], inputs)` for every visible section (recomputing rows already built at `line 234`), and `summarizeRows()` (`scripts/ui/creature-rows.js:105`) re-normalizes `getWorldResearchTiers()` per section card and per family group (`scripts/ui/section-model.js:50`).
   - `buildStatblock()` -> `decorateItem()` (`scripts/ui/creature-statblock.js:222, 282, 284`) calls `getWorldMaxResearchTier()` per accordion section and `describeTier()` + `localizedTierChoices()` (re-normalizing `researchTiers` and rebuilding localized choice arrays) for **every single item** on a GM-viewed creature sheet.
6. `getBestiarySocial()` -> `readJournalSocial()` (`scripts/foundry/note-store.js:179-201`) scans every `JournalEntry` in `game.journal`, filters `isNoteStoreJournal`, iterates every embedded `JournalEntryPage`, runs `normalizeSocial({ comments: [raw] })` **once per page**, merges legacy `bestiarySocial`, and sorts all comments globally—on **every** `BestiaryApp._prepareContext()` (`line 259`, solely for `notesCount` when not on the Notes tab) and on **every** `BestiaryCreatureView._prepareContext()` (`scripts/ui/creature-view.js:207, 238`, even when `comments` is not the active rail!).

#### $O(N \times \text{entries})$ linear UUID scans instead of indexed lookups
`getEntryContexts(data, uuid)` (`scripts/core/bestiary-domain.js:288-296`) sorts `data.sections` (`toSorted`) and iterates through **every section and every creature entry** to match `entry.uuid === uuid`. It has no UUID index map:
- `buildCreatureRows()` (`scripts/ui/creature-rows.js:74`) calls `playerEntryContexts(data, uuid)` -> `getEntryContexts(data, uuid)` for every creature row. At `500` unique creatures across `10` sections (`~700` entries), `BestiaryApp._prepareContext()` executes `buildCreatureRows` once for all sections (`500` calls) plus once per section in `_buildSectionCards` (`700` calls) = **`1,200 × 700 = ~840,000` entry comparisons** per render, alongside `isCreatureEntryVisible()` linearly searching `section.families.find(...)` (`bestiary-domain.js:255`).
- `BestiaryKnowledgeBoard._prepareContext()` (`scripts/ui/knowledge-board.js:124`) calls `isCreatureLocked(data, uuid)` -> `getEntryContexts(data, uuid)` for every row.
- `creature-cache.js` (`lines 64-82`) hooks `updateActor`, `deleteActor`, `createItem`, `updateItem`, `deleteItem`, `createActiveEffect`, `updateActiveEffect`, and `deleteActiveEffect`. Every embedded item/effect/HP change on **any** actor in the world (including player characters in combat!) triggers `getEntryContexts(getBestiaryData(), uuid)`—re-normalizing the entire bestiary and linearly scanning every entry just to test membership.
- `encounter.js` (`lines 40, 53, 81, 113-132`) and `chat-links.js` (`lines 40-49`) similarly re-normalize `getBestiaryData()` and run `getEntryContexts()` on every combat round/token update and every `bestiaryJournalRefresh`.

---

### 1.2 Eager Actor Resolution, Full Extraction & `TextEditor.enrichHTML` Costs

#### `rowInputs` resolves every visible creature upfront
In `scripts/ui/creature-rows.js:33-48`:
```js
const uuids = new Set(
  sections.flatMap((section) => selectVisibleCreatureEntries(section, viewer).map((entry) => entry.uuid)),
);
...
creatures: await getCreatureDataMany([...uuids]),
```
1. **Unconditional full-world scope:** Both `BestiaryApp._prepareContext()` (`bestiary-app.js:232`) and `BestiarySectionView._prepareContext()` (`section-view.js:160`) call `rowInputs(visibleSections, ...)`, resolving **every creature in every visible collection**—even when `BestiaryApp` is showing `overview` (only 8 recent cards + collection counts), `notes`, `favorites`, or a single `collection`!
2. **Full compendium document RPCs:** `getCreatureDataMany()` (`scripts/foundry/creature-cache.js:34-46`) invokes `getCreatureData(uuid, { enrich: false })` (`lines 19-31`), which calls `globalThis.fromUuid(uuid)`. In Foundry `v14.367` (`client/utils/helpers.mjs:161-172`), for any `Compendium.*` UUID, `fromUuid` calls `await collection.getDocument(id)`—fetching the **full Actor document JSON** (all items, descriptions, activities, effects, biography) over WebSocket/DB per creature! For `500` compendium creatures, opening `BestiaryApp` fires **500 `getDocument()` calls in parallel**. (Compare `bulk-import.js:147-149`, which batches pack reads via `pack.getIndex({ fields: [...] })`.)
3. **Eager unknown-creature resolution:** Even when a player has Tier `0` (`Unknown`) and `KnowledgeLens` hides `name`, `type`, `cr`, `ac`, `hp`, `speed`, and `portrait`, `rowInputs` still resolves and extracts the full actor (only using `!creature` on `creature-rows.js:69` to filter out deleted actors).
4. **Full statblock extraction for card thumbnails:** `extractCreatureData(actor, { enrich: false })` (`scripts/integrations/dnd5e.js:34-54`) unconditionally executes:
   - `extractAbilitiesAndSkills(system)` (`lines 56-80`)
   - `extractMovement(system)` (`lines 82-100`)
   - `extractTraitsAndSenses(system)` (`lines 102-118`, recursively walking `CONFIG.DND5E` via `_configEntry`, `lines 646-655`)
   - `extractDamageModifications(actor)` (`lines 125-146`, invoking `actor.getRollData({ deterministic: true })` and `simplifyDnd5eBonus()` for every damage type)
   - `categorizeActorItems(actor)` (`lines 172-222`) + `extractItemMeta(item)` (`lines 270-346`) + `extractItemActivities(item)` (`lines 348-373`) across **every embedded Item and Activity** on every actor (`500` actors $\times$ `10–30` items = `5,000–15,000+` item projections), even though library/collection rows and the Knowledge Board never read abilities, skills, traits, senses, damage modifications, items, activities, or biography!
5. **Dual cache key duplication:** `creature-cache.js:14-16` keys by `${uuid}|plain` and `${uuid}|rich`. Opening a `BestiaryCreatureView` (`enrich: true`) misses the `plain` entry, re-fetching `fromUuid(uuid)` and re-running `extractCreatureData` from scratch. Note also that `CompendiumCollection.CACHE_LIFETIME_SECONDS` is `300` (`compendium-collection.mjs:82`), whereas `creature-cache.js` never clears compendium entries on pack updates or TTL unless an in-world document hook fires.

#### Eager `TextEditor.enrichHTML` on hidden and collapsed content
In Foundry `v14.367`, `TextEditor.enrichHTML` (`client/applications/ux/text-editor.mjs:123-189`) constructs a temporary `<div>`, parses `innerHTML`, walks all DOM text nodes, runs `_primeCompendiums` (regex + `parseUuid` + `getDocuments`), and executes 5 sequential regex/DOM enrichment passes (`_enrichContentLinks`, `_enrichHyperlinks`, `_enrichInlineRolls`, `_enrichEmbeds`, custom enrichers).
- **`BestiaryCreatureView` (`scripts/ui/creature-view.js:203, 222`):** Calls `await getCreatureData(this.actorUuid, { enrich: true })`, which invokes `enrichCreatureData()` (`dnd5e.js:224-254`) to enrich **every item description across all 7 item buckets plus `biography` in `Promise.all` *before* `buildStatblock()` checks `KnowledgeLens`!**
  - A player at Tier 0 or 1 triggers dozens of `enrichHTML` DOM parses whose output is immediately discarded by `buildStatblock()`.
  - Even for a GM, `BestiaryCreatureView` starts with `spells`, `inventory`, `biography`, and **every single item row** collapsed (`creature-view.js:161-167`, `this._expandedItems = new Set()`), yet enriches all of them upfront on window open.
- **Comments & Notes (`scripts/ui/comments.js:37-128`):** `buildCommentThreads()` runs `renderCommentText()` (`enrichHtml`) on every comment across all 3 channels (`gm`, `party`, `private`) on every `BestiaryCreatureView` render—even when `_rail !== "comments"` (`creature-view.js:238`). `buildNotesFeed()` (`comments.js:74-87`) enriches up to `60` notes (`FEED_LIMIT`) on every Notes tab render with zero per-comment HTML cache.

---

### 1.3 Monolithic `ApplicationV2` Templates, $3\times$ DOM Amplification & Full Re-renders

#### Single-part `PARTS` architecture
Every primary application window uses **one** monolithic template part:
- `BestiaryApp.PARTS` (`scripts/ui/bestiary-app.js:189-199`): `{ main: { template: ".../bestiary-main.hbs" } }` — **`1,597` lines (`77,378` bytes)**.
- `BestiarySectionView.PARTS` (`scripts/ui/section-view.js:136-141`): `{ section: { template: ".../section-view.hbs" } }` — **`820` lines (`39,989` bytes)**.
- `BestiaryCreatureView.PARTS` (`scripts/ui/creature-view.js:147-152`): `{ creature: { template: ".../creature-view.hbs" } }` — **`475` lines (`32,424` bytes)**.
- `BestiaryKnowledgeBoard.PARTS` (`scripts/ui/knowledge-board.js:47-52`): `{ main: { template: ".../knowledge-board.hbs" } }` — **`119` lines (`6,386` bytes)**.

Every `this.render()` executes the full `HandlebarsApplicationMixin` pipeline (`client/applications/api/handlebars-application.mjs:118-223`): full template compilation/evaluation into one HTML string, full `tempEl.innerHTML` parsing, `_preSyncPartState`, destructive `element.replaceWith(htmlElement)` of the entire window body, `_syncPartState`, and `_onRender()` re-binding hundreds of DOM listeners + tearing down and recreating `bindArtwork()` + re-triggering entrance checks.

#### $3\times$ DOM duplication inside `bestiary-main.hbs` and `section-view.hbs`
Inspection of `templates/bestiary-main.hbs` reveals massive hidden DOM duplication:
1. **Overview mode (`lines 1121-1433`):** Alongside `sections` (`1252-1328`) and `recentCreatures` (`1353-1423`), `.library-search-results` (`1155-1241`, hidden via `display: none` in `styles/library.css:617-619`) renders **all `N` creatures** (`overview: creatures` at `bestiary-app.js:241`) into the DOM solely for instant search fallback.
2. **Collection mode (`lines 460-1118`, duplicated in `templates/section-view.hbs:273-815`):** Simultaneously renders **three complete copies** of every creature in the collection:
   - **Grid cards:** `.collection-grid-view` (`lines 647-763`) renders all `N` `<article class="creature-card">` trees.
   - **List rows:** `.collection-list-view` (`lines 778-827`) renders all `N` `<div class="collection-list-row">` trees (hidden with `.is-hidden { display: none }`).
   - **Quick Preview panels:** `.collection-preview-panel` (`lines 950-1114`) renders **`N` complete `<div class="creature-preview-content" data-uuid="...">` subtrees** (each containing a `.bestiary-art` portrait, vitals, 6 tool buttons, a `<select class="preview-family-select">` with all family `<option>`s, and `.preview-party-chips`), all hidden via `display: none` (`styles/collection.css:712-720`) until `.is-active` is toggled on one creature!
   - At `N = 500` creatures, one collection render inserts **`1,500` creature DOM subtrees (~35,000–45,000 HTML elements)** plus `bindArtwork` state objects and `querySelectorAll` listener bindings.

#### Full re-renders on trivial local UI state & per-keystroke DOM thrashing
- **Trivial full-window `this.render()` calls:**
  - `BestiaryApp`: `_onStepTip()` (`bestiary-app.js:317-320`), `dismissTipBanner()` (`lines 109-112` — **double-renders**, once via `this.render()` and once via setting `onChange` -> `onRefreshCards` -> `scheduleBestiaryRefresh`), `_onToggleFavorite()` (`lines 643-649`), `_onSetLibraryView()` (`lines 575-581`), and `refreshFromExternalUpdate()` (`lines 405-416`, which re-renders on `changed.seen` from `knowledge-watch.js:69` and on any `changed.social` note change).
  - `BestiaryCreatureView`: `_onSetRail()` (`creature-view.js:438-445`), `_onSetCommentChannel()` (`lines 457-468`), `_onEditComment()` (`lines 525-535`), `_onCancelEdit()` (`lines 537-542`), and `_onToggleFavorite()` (`lines 433-436`) each trigger a full window `render()`, rebuilding the entire statblock, portrait, and all GM item/block `<select>` elements (`templates/creature-view.hbs:235, 461`) just to switch a side-rail tab or open a comment editor.
  - `BestiaryKnowledgeBoard`: Every individual cell `<select>` change (`knowledge-board.js:252-287`) triggers `main.js:144-145` -> full `board.render()`, recreating `N × (players + 1)` `<select>` elements (`12,500+` `<option>` elements at 500 creatures × 4 players).
- **Layout-thrashing keystroke loop (`scripts/ui/collection-workspace.js:334-401`):** On every `input` event in `.collection-search-input` or CR inputs, `applyClientState()` reads `element.dataset` across `2N` elements and then unconditionally executes (`lines 345-350`):
  ```js
  for (const container of this.element.querySelectorAll(".family-grid, .collection-list-body")) {
    [...container.children]
      .filter((child) => child.matches("[data-creature-entry]"))
      .toSorted((a, b) => compareCollectionCards(a.dataset, b.dataset, this.state.sortMode))
      .forEach((child) => container.appendChild(child));
  }
  ```
  Moving every card via `container.appendChild(child)` on every keystroke—even when `sortMode` did not change—forces DOM detachment/re-insertion, style/layout invalidation, and resets CSS transitions/artwork hover state.
- **Per-element listener loops:** Instead of delegating on `this.element`, `_onRender` loops `querySelectorAll` to attach individual listeners on every card/row (`bestiary-app.js:478-500`, `collection-workspace.js:222-309`, `creature-view.js:402-423`, `knowledge-board.js:242-287`).

#### Legacy duplication & redundant window classes
- `BestiarySectionView` (`scripts/ui/section-view.js`, `216` lines) and `templates/section-view.hbs` (`820` lines) are **never instantiated** anywhere in `scripts/` or `tests/` (only imported in `scripts/main.js:3, 137-139` for `_instances` refresh iteration), yet duplicate `1,036` lines of collection logic and markup.
- All 11 `ApplicationV2` classes (`scripts/ui/*.js`) pass `classes: ["bestiary-journal", "bestiary-app", "bestiary-<name>"]`, even though `.bestiary-journal` has **zero** CSS rules or JS selectors anywhere in `styles/`, `scripts/`, `templates/`, or `tests/` (while Foundry v14 automatically prepends `"application"` on framed windows: `application.mjs:460`).

---

### 1.4 Artwork Pipeline & Global Pointer Tracking

#### `scripts/ui/artwork.js`: Eager dual-canvas baking & `Blob` duplication
`bindArtwork(root)` (`scripts/ui/artwork.js:8-233`) runs after every `_onRender` on `BestiaryApp`, `BestiarySectionView`, and `BestiaryCreatureView` for every `.bestiary-art:not(.is-silhouette)` element (including hidden overview search cards and hidden collection preview portraits):
1. **Static images pay animated-GIF penalties:** Every loaded image—even static `.webp`, `.png`, or `.jpg` portraits—triggers `loaded()` (`lines 132-170`), which synchronously creates **two `<canvas>` elements** (`bestiary-art-poster` up to `1024px` + `bestiary-art-backdrop` up to `256px`), calls `context.drawImage(...)` twice on the main thread, removes `img[src]` (`line 161`), and leaves CSS `filter: blur(18px) saturate(0.8)` (`styles/frame.css:284`) active on `.bestiary-art-backdrop`.
2. **Memory footprint:** At up to `1024×1024×4` bytes (`4 MB`) + `256×256×4` bytes (`256 KB`) per card, `200` loaded portraits retain hundreds of megabytes of uncompressed canvas bitmaps alongside browser-cached image decodes.
3. **Eager hover/focus `Blob` duplication:** On `pointerenter` or `focusin`, `preparePlayback()` (`lines 25-58`) calls `fetch(src, { cache: "force-cache" })` -> `response.blob()` -> `URL.createObjectURL(blob)` and keeps `state.blob` pinned in memory until teardown, even for static images with no animation frames.
4. **Non-lazy `IntersectionObserver` + $O(K^2)$ lookup:** `IntersectionObserver` (`lines 196-207`) only toggles `state.visible` to pause playback; it does **not** defer canvas allocation or image decoding, and its callback searches `states.find((item) => item.frame === entry.target)` linearly per entry.

> [!IMPORTANT]
> **Security Invariant (Must Be Preserved):**
> In `scripts/core/image-framing.js:24-40`, `scripts/ui/creature-cards.js:29`, `scripts/ui/artwork.js:90`, `tests/artwork.test.js:139-144`, and `docs/live-check.md:55`, when `!lens.show("portrait")`, the view-model emits **only** `SILHOUETTE_PLACEHOLDER` (`modules/bestiary-journal/assets/unknown-creature.svg`) with `.is-silhouette`. The real `actor.img` or `prototypeToken` URL must **never** reach the DOM (`src`, `data-*`, fallback text) or trigger a network fetch/preload for an unrevealed creature.

#### `scripts/ui/ui-effects.js`: Permanent document-level `pointermove`
Lines `13-27` register a module-load listener on `document`:
```js
document.addEventListener("pointermove", (event) => {
  const card = event.target.closest?.(".bestiary-spot");
  if (!card || spotFrame) return;
  spotFrame = requestAnimationFrame(() => {
    ...
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  });
}, { passive: true });
```
- Runs `event.target.closest(".bestiary-spot")` on **every pointer movement across the entire Foundry canvas, sidebar, and unrelated sheets**, even when zero Bestiary windows are open.
- Forces `getBoundingClientRect()` + inline style mutation on every animation frame while hovering ability cards, even when `data-motion="off"` or `"reduced"` disables the visual spotlight in CSS (`styles/frame.css:402-404`).

---

### 1.5 CSS Load, Selector Cost & Layout Containment

`module.json` (`lines 30-40`) loads 10 global stylesheets totaling **`6,609` lines (`144,004` bytes)**:

| Stylesheet | Lines | Bytes | Key Performance / Hygiene Observations |
| --- | ---: | ---: | --- |
| `styles/tokens.css` | 162 | 5,983 | Font faces + Night/Parchment/Accent tokens on `.bestiary-app` |
| `styles/frame.css` | 1,037 | 24,339 | Global `text-rendering: optimizeLegibility` on `.window-content` (`L40`); `.bestiary-art-backdrop { filter: blur(18px) }` (`L284`); `.suite-badge { backdrop-filter: blur(6px) }` (`L674`); `.aim-theme-fade *` universal rule (`L985`) |
| `styles/library.css` | 1,477 | 29,057 | 3 `:has()` selectors (`L57`, `L1079`, `L1390`) including per-card `:has(+ .is-lock)` |
| `styles/collection.css` | 1,005 | 19,315 | `.family-header-bg img { filter: blur(8px) saturate(1.1) }` (`L323`); zero `content-visibility` |
| `styles/creature.css` | 1,296 | 27,073 | 2 `:has(select:focus-visible)` selectors (`L61`, `L669`) duplicating `:focus-within` |
| `styles/editors.css` | 971 | 21,506 | 1 `:has(input:checked)` (`L240`) |
| `styles/board.css` | 235 | 4,997 | Uncontained table (`500+` rows $\times$ `(players+1)` selects) |
| `styles/density.css` | 111 | 3,058 | Dead `.recent-card` selector (`L16`) |
| `styles/motion.css` | 32 | 1,194 | Universal `.bestiary-app[data-motion="off"] *, *::before, *::after` (`L13-15`); dead `.recent-card` (`L27`) |
| `styles/content.css` | 283 | 7,482 | Chat cards & enriched embed styles |
| **Total** | **6,609** | **144,004** | **0 `content-visibility` / `contain` rules; 6 `:has()`; 5 `*` rules; 3 `blur()` + 2 `backdrop-filter`** |

---

## 2. Foundry VTT v14 `ApplicationV2` Native & Zero-Build Patterns

All recommendations below are verified directly against Foundry VTT `v14.367` (`client/applications/api/application.mjs`, `handlebars-application.mjs`, `client/utils/helpers.mjs`) and standard browser APIs (Chrome/Chromium used by Foundry Electron & modern desktop browsers).

### 2.1 Multi-Part `PARTS` & Scoped `_preparePartContext`

In Foundry `v14.367`, `HandlebarsApplicationMixin` (`client/applications/api/handlebars-application.mjs:51-284`) supports independent partial template rendering via `render({ parts: [...] })`:

1. **Split monolithic templates into coarse structural parts (never `root: true`):**
   - Look at `handlebars-application.mjs:76`:
     `if ( options.parts && options.parts.some(id => this.#partDescriptors[id]?.root) ) options.parts = undefined;`
     Marking any part `root: true` disables partial rendering and forces **all** parts to re-render. Instead, render sibling parts inside `.window-content`:
     - **Consolidated Library/Collection Workspace (`BestiaryApp`):** `sidebar`, `header`, `workspace`, `inspector` (optional single-slot quick preview).
     - **Creature Dossier (`BestiaryCreatureView`):** `topbar`, `profile`, `statblock`, `rail` (or `railBody` inside `rail`).
     - **Knowledge Board (`BestiaryKnowledgeBoard`):** `controls`, `table`.
2. **Move heavy preparation out of `_prepareContext()` into `_preparePartContext(partId, context, options)`:**
   - Look at `application.mjs:539`: `ApplicationV2##render` **always** awaits `this._prepareContext(options)` before calling `_renderHTML(context, options)`.
   - Therefore, `_prepareContext(options)` should prepare only cheap shared metadata (or check `const parts = new Set(options.parts)`), while `_preparePartContext(partId, context, options)` (`handlebars-application.mjs:153-156`) builds heavy data **only for the requested `partId`**:
     - `render({ parts: ["rail"] })` on `BestiaryCreatureView` skips `buildStatblock()`, `buildEntryTierMatrix()`, and `getCreatureData(..., { enrich: true })`.
     - `render({ parts: ["workspace"] })` on `BestiaryApp` leaves `sidebar` untouched.
     - `render({ parts: ["inspector"] })` updates only the quick preview pane when `selectedUuid` changes.
3. **Preserve scroll, focus, and disclosure cleanly:**
   - `HandlebarsApplicationMixin#_preSyncPartState` (`handlebars-application.mjs:235-259`) preserves scroll offsets listed in `part.scrollable`, `<details data-sync="...">` open state, and focus **only for elements with an `id` or `[name]` attribute** (`lines 239-245`). Any tab button or sidebar link expected to survive a part swap should carry a deterministic `id` (scoped with `this.id`) or be updated via targeted DOM patching rather than full part HTML replacement.

### 2.2 Lightweight Keyed DOM Diffing, `_replaceHTML` & Window-Level Event Delegation

`ApplicationV2` (`application.mjs:44-45, 811-823`) allows any subclass—with or without `HandlebarsApplicationMixin`—to implement or override `_renderHTML(context, options)` and `_replaceHTML(result, content, options)` (as Foundry core does in `JournalEntrySheet#_replaceHTML`, `journal-entry-sheet.mjs:654-678`).

For **high-frequency or large-list UI updates** (search typing, filter toggles, sorting, favorites, single-row knowledge grants, comment edits, tip cycling):

1. **Zero-build Keyed DOM Reconciliation (`patchKeyedList`):**
   - For lists/grids (`500+` creature cards, collection list rows, Knowledge Board `<tr>` rows, comment items):
     - Maintain a `Map<key, HTMLElement>` (or index existing `container.children` by `data-uuid` / `data-comment-id`).
     - Compute the active ordered items in pure JS from in-memory view-model state (never reading `element.dataset` from DOM nodes).
     - Reuse existing keyed nodes, patch only changed subfields (e.g., tier badge, favorite star, lock/hidden flag) when an item's revision/state changed, remove filtered-out or deleted nodes (or toggle visibility via in-memory filter without reordering!), and **reposition DOM nodes only if their actual sequence index changed**—eliminating `applyClientState()`'s unconditional `appendChild` thrashing on every keystroke (`collection-workspace.js:345-350`).
2. **Eliminate $3\times$ DOM duplication:**
   - Render **only the active workspace mode** (`overview` OR `collection:grid` OR `collection:list` OR `collection:families` OR `notes`)—never keep hidden `500`-card search mirrors or dual grid+list DOM trees mounted simultaneously.
   - Replace the `N` hidden `.creature-preview-content` blocks (`bestiary-main.hbs:950-1114`) with **one** active inspector pane rendered on demand for `selectedUuid` (`0` hidden portraits when no creature is selected, `1` when selected).
3. **Single-bind event delegation in `_onFirstRender`:**
   - Foundry's `DEFAULT_OPTIONS.actions` already delegates `[data-action]` clicks at `this.#element` (`application.mjs:1879, 1918-1922`).
   - Bind `input`, `change`, `dblclick`, `contextmenu`, and `dragstart` **once** on `this.element` (or the stable part wrapper) using `event.target.closest(...)` instead of looping `querySelectorAll` after every `_onRender`.
4. **In-place mutations for micro-interactions:**
   - Tip stepping (`nextTip`/`prevTip`), banner dismissal (remove redundant direct `this.render()`), favorite toggles (`toggleFavorite`), and accordion disclosures should patch the affected DOM node(s) or re-render only a small `part`, never triggering a full-window `rowInputs()` + template re-render.

### 2.3 Revision-Memoized Store Snapshots, `BestiaryIndex` & Two-Tier Lazy Actor Resolution

1. **Memoize normalized world stores by reference + `maxTier` (`bestiary-store.js` & `creature-display.js`):**
   - Because Foundry's `WorldSettings#getSetting` returns the same `Setting.value` object reference until `Setting._onUpdate` replaces it (`client-settings.mjs:225-229`, `setting.mjs:48-52`), caching `{ raw, maxTier, normalized, index }` in `bestiary-store.js` and invalidating on `updateSetting` / `createSetting` (plus checking `raw === cachedRaw && maxTier === cachedMaxTier`) drops per-render normalization cost from $O(\text{world})$ to $O(1)$ reference comparison.
   - Cache `getWorldResearchTiers()` and `getWorldBlockTiers()` the same way.
   - Fix `selectVisibleSections(data, viewer)` (`bestiary-domain.js:259-263`) to accept pre-normalized `data` (or pass `maxTier`) instead of re-normalizing with default `maxTier = 3`.
   - Avoid double normalization inside `applyBestiaryCommand()` (`bestiary-domain.js:388`) when called with an already-normalized state from `persistCommand()`.
2. **Precomputed `BestiaryIndex` (`O(1)` UUID & collection lookups):**
   - Build a read-only index once per `bestiaryData` revision:
     - `sectionsSorted`: sections pre-sorted by `sort`
     - `sectionById`: `Map<sectionId, section>`
     - `familiesBySection`: `Map<sectionId, Map<familyId, family>>`
     - `contextsByUuid`: `Map<uuid, Array<{ section, entry }>>` (already in section display order)
     - `knownUuids`: `Set<uuid>`
   - `getEntryContexts`, `canViewCreature`, `isCreatureLocked`, `playerEntryContexts`, `creature-cache.js` hook filtering (`invalidate`), `encounter.js`, and `chat-links.js` all drop from $O(S \times E)$ scans to **`O(1)` `Map`/`Set` lookups**.
3. **Memoize `note-store.js` & enriched comment HTML:**
   - Cache `readJournalSocial()` output (plus per-UUID index and party notes count) and invalidate strictly in `registerNoteStoreHooks` (`note-store.js:326-358`) and `syncJournalSocialChanges`.
   - Cache `renderCommentText()` output in a `Map` keyed by `${comment.id}:${comment.editedAt ?? comment.createdAt}:${comment.text}` so unrelated renders do not re-run `TextEditor.enrichHTML` for unchanged notes.
4. **Two-tier actor projection (`Summary` vs `Full`) + batched index reads + lazy `enrichHTML`:**
   - **Card / Row Summary (`extractCreatureSummary`):** Only extracts `{ name, img, prototypeToken, cr, creatureType, creatureTypeKey, size }` (plus `ac`, `hp`, `speeds` only if a preview needs them)—completely skipping `extractAbilitiesAndSkills`, `extractTraitsAndSenses`, `extractDamageModifications` (`getRollData`), `categorizeActorItems`, and `extractItemActivities`.
   - **Synchronous world reads + batched compendium index reads:**
     - World actors (`Actor.<id>`) resolve synchronously via `fromUuidSync(uuid)` (`client/utils/helpers.mjs:188-210`) with zero network cost.
     - Compendium actors (`Compendium.<pack>.Actor.<id>`) check `fromUuidSync(uuid)` first (which returns the cached document OR the in-memory `pack.index` entry at `0 ms`!), and fetch missing summary index fields via **one batched `pack.getIndex({ fields })` call per pack** (mirroring `bulk-import.js:147-149`), avoiding 500 individual `pack.getDocument()` RPC calls!
     - Only resolve the active view's UUIDs (`overview`: only section counts + top 8 recent; `collection`: only the active section; `all`: paginated/viewport-hydrated window or summary index).
   - **Knowledge-gated & lazy enrichment on `BestiaryCreatureView`:**
     - Maintain one base unenriched `extractCreatureData(actor)` object per `actorUuid` (invalidated by actor/item/effect hooks) instead of separate `plain`/`rich` fetches.
     - Apply `KnowledgeLens` visibility **before** calling `TextEditor.enrichHTML`.
     - Defer `enrichText()` for collapsed accordions (`spells`, `inventory`, `biography`) and collapsed items until `_onToggleSection` / `_onExpandItem` opens them, caching enriched descriptions per `(actorUuid, itemId, rawText)`.

### 2.4 `IntersectionObserver` Lazy Hydration & CSS `content-visibility: auto`

1. **CSS `content-visibility: auto` + `contain-intrinsic-size`:**
   - Supported natively in Chromium / Foundry v14 Electron. Skipping off-screen style, layout, and paint work on large grids and lists directly cuts initial render and resize time:
     ```css
     .creature-card {
       content-visibility: auto;
       contain-intrinsic-size: auto 260px;
     }
     .collection-list-row {
       content-visibility: auto;
       contain-intrinsic-size: auto 52px;
     }
     .knowledge-board-table tbody tr {
       content-visibility: auto;
       contain-intrinsic-size: auto 44px;
     }
     .creature-item,
     .notes-feed-item {
       content-visibility: auto;
       contain-intrinsic-size: auto 58px;
     }
     ```
   - Using the `auto <length>` syntax lets the browser remember each element's measured height after first paint, minimizing scrollbar jitter.
   - **Placement constraint:** Apply `content-visibility: auto` to leaf cards/rows inside scroll containers (`.creature-card`, `.collection-list-row`, `.notes-feed-item`, `.creature-item`), never on outer elements that host fixed-position drawers or overflow popouts (note that `.bestiary-context-menu` mounts on `document.body` via `showPopover()`, and Foundry tooltips mount on `#tooltip` on `document.body`, so card-level containment does not clip them).
2. **`IntersectionObserver` for viewport-scoped hydration:**
   - Use a single shared `IntersectionObserver` per scroll viewport (`root: scrollContainer, rootMargin: "200px 0px"`) backed by a `WeakMap`/`Map<Element, EntryState>` (eliminating `artwork.js:199`'s $O(K^2)$ `states.find`).
   - Hydrate deferred compendium summary rows or optional animated-GIF posters only when elements approach the viewport, and `unobserve` once hydrated.

### 2.5 Zero-Canvas Native `<img>` Pipeline (Preserving the Unknown-Creature Invariant)

1. **Replace dual-`<canvas>` baking with native `<img>` for static art:**
   - Modern Foundry portraits (`.webp`, `.png`, `.jpg`, `.avif`, `.svg`) require **zero** `<canvas>` wrapping or `fetch() -> Blob` duplication.
   - Render directly:
     ```html
     <img src="{{this.image.src}}" alt="{{this.name}}" loading="lazy" decoding="async" style="{{this.image.imageStyle}}" />
     ```
   - Native CSS `object-fit: contain | cover` and `object-position: <focusX>% <focusY>%` (`image-framing.js:38`) handle all aspect ratios and focal points on the GPU without allocating `1024px` + `256px` canvases or running CSS `filter: blur(18px)` backdrops.
   - `decoding="async"` offloads image decoding from the main thread so scrolling large grids stays responsive.
2. **Optional animated GIF / animated WebP freeze-until-hover (if retained):**
   - If hover-to-play animation freezing is kept for `.gif` (or explicitly detected animated media), scope it *only* to animated extensions/headers instead of all images:
     - Defer first-frame extraction behind `IntersectionObserver` (`rootMargin: "200px"`).
     - Draw **one** poster canvas sized to the rendered box (`displayWidth * devicePixelRatio`, e.g., `~352px` rather than `1024px`), dropping the blurred backdrop canvas entirely.
     - Use `createImageBitmap(img)` (off-main-thread decode) when available, and track state in a `Map<HTMLElement, State>`.
3. **Unknown-creature security invariant checklist:**
   - When `!lens.show("portrait")`, `buildImageView()` **must** continue returning `SILHOUETTE_PLACEHOLDER` + `.is-silhouette` and omit the real `actor.img` / `prototypeToken` URL from template context, `data-*` attributes, JS preload queues, and `IntersectionObserver` targets.
   - Non-GM clients at Tier `0` must never call `fromUuid` / `fetch` / `new Image()` on hidden portrait paths (`docs/live-check.md:55`, `tests/artwork.test.js:139-144`, `tests/creature-rows.test.js:75-80`).

### 2.6 CSS & Interaction Hygiene

1. **Eliminate global `document` `pointermove` (`ui-effects.js:13-27`):** Retire `.bestiary-spot` cursor tracking (aligned with `docs/roadmap/road-to-8.0.md:17`), or if any pointer effect is ever scoped in `0.7.x`, bind strictly on the open window element only when `data-motion="full"` and unbind on `_onClose`.
2. **Eliminate compositor blur & universal `*` selectors:**
   - Drop `.bestiary-art-backdrop` (`filter: blur(18px)`), `.family-header-bg` (`filter: blur(8px)`), and `.suite-badge` (`backdrop-filter: blur(6px)`), using opaque tonal surfaces per `road-to-8.0.md` §1.7.
   - Replace `.bestiary-app[data-motion="off"] *, *::before, *::after` (`styles/motion.css:13-15`) and `.aim-theme-fade *` (`styles/frame.css:985`) with CSS custom-property duration overrides (`--suite-fast: 0ms`, etc.) and targeted component classes.
   - Move `text-rendering: optimizeLegibility` off `.window-content` (`styles/frame.css:40`) so dense lists and tables use fast text shaping.
   - Replace `:has(select:focus-visible)` (`styles/creature.css:61, 669`) with `:focus-within` and replace `:has(+ .is-lock)` (`styles/library.css:1079`) with a direct container modifier class.
3. **Retire legacy duplication & dead selectors:**
   - Remove `BestiarySectionView` (`scripts/ui/section-view.js` + `templates/section-view.hbs`, `1,036` lines), routing any legacy external entry points to `BestiaryApp#openCollection()`.
   - Remove the unused `"bestiary-journal"` class from all 11 `ApplicationV2` classes and dead `.recent-card` CSS selectors (`density.css:16`, `motion.css:27`).

---

## 3. Architectural Guidance for Wayfinder Tickets `#5` & `#6`

### For Ticket `#6` (Data Caching, Store Indexing & Module Decomposition)
- **Revision-memoized store + `BestiaryIndex`:** Memoize `normalizeBestiaryData` / `normalizeKnowledge` / `getWorldResearchTiers` / `getWorldBlockTiers` on raw setting reference + `maxTier`, and maintain an `O(1)` `BestiaryIndex` (`contextsByUuid`, `sectionById`, `familiesBySection`, `knownUuids`). Fix `selectVisibleSections()` so it never silently re-clamps to `maxTier=3`.
- **Two-tier actor cache (`Summary` vs `Full`) + lazy `enrichHTML`:** Split `dnd5e.js` into fast `extractCreatureSummary()` (using `fromUuidSync` + batched `pack.getIndex({ fields })`) vs `extractCreatureData()` (for `BestiaryCreatureView` only), and run `TextEditor.enrichHTML` strictly post-lens and on accordion/item expand with per-item/per-comment HTML caching.
- **Note-store caching:** Memoize `readJournalSocial()` in `note-store.js` against Foundry `JournalEntry`/`JournalEntryPage` hooks instead of rescanning `game.journal` on every UI render.

### For Ticket `#5` (Consolidated Workspace Flows & Partial DOM Architecture)
- **Multi-part `PARTS` + `_preparePartContext`:** Split `BestiaryApp` into `sidebar`, `header`, `workspace`, `inspector`, and `BestiaryCreatureView` into `topbar`, `profile`, `statblock`, `rail`. Keep `_prepareContext` minimal and guard per-part work inside `_preparePartContext`.
- **Single-copy DOM + keyed patching:** Eliminate `3×` creature DOM rendering (render only the active mode + single on-demand inspector), retire `BestiarySectionView` / `section-view.hbs`, and use a zero-build keyed reconciler + delegated window events for search/filter/sort/tier updates—pairing CSS `content-visibility: auto` + `contain-intrinsic-size: auto ...` on list/grid items with native `loading="lazy" decoding="async"` `<img>` tags and preserving the Unknown-creature silhouette security invariant.

---

## 4. Primary References

### Repository (`BestiaryJournal v0.7.1`)
- `scripts/main.js` (`L113-162`): refresh coalescing (`scheduleBestiaryRefresh`, `refreshBestiaryViews`) and legacy `BestiarySectionView` hookup
- `scripts/foundry/bestiary-store.js` (`L56-80`, `L242-296`): unmemoized reads & command persistence
- `scripts/core/bestiary-domain.js` (`L84-230`, `L251-341`, `L382-411`, `L1049-1056`): recursive normalization, `selectVisibleSections`, `getEntryContexts`, `cloneState`
- `scripts/foundry/creature-display.js` (`L22-167`): world tier settings reads & per-item `buildTierMatrix` / `localizedTierChoices`
- `scripts/foundry/note-store.js` (`L39-71`, `L179-201`, `L326-358`): `readJournalSocial` full scan
- `scripts/foundry/creature-cache.js` (`L12-82`): `plain`/`rich` dual cache keys & global document invalidation hooks
- `scripts/ui/creature-rows.js` (`L33-108`) & `scripts/integrations/dnd5e.js` (`L12-54`, `L125-373`, `L646-655`): eager `rowInputs`, full item/activity extraction, eager `enrichCreatureData`
- `scripts/ui/bestiary-app.js`, `scripts/ui/collection-workspace.js`, `scripts/ui/section-view.js`, `scripts/ui/creature-view.js`, `scripts/ui/creature-statblock.js`, `scripts/ui/comments.js`, `scripts/ui/knowledge-board.js`
- `scripts/ui/artwork.js` (`L8-233`), `scripts/core/image-framing.js` (`L11-55`), `scripts/ui/ui-effects.js` (`L13-27`)
- `templates/bestiary-main.hbs` (`1,597` lines), `templates/section-view.hbs` (`820` lines), `templates/creature-view.hbs` (`475` lines), `templates/knowledge-board.hbs` (`119` lines)
- `styles/*.css` (`10` files, `6,609` lines / `144,004` bytes)
- `tests/artwork.test.js`, `tests/creature-rows.test.js`, `docs/live-check.md` (`L55`): portrait & family privacy invariants

### Foundry VTT `v14.367` Primary Client Sources
- `client/applications/api/application.mjs`: `ApplicationV2` `#render` (`L513-603`), `#renderable` check (`L44-45`), `_attachFrameListeners` action delegation (`L1874-1965`), `Semaphore` render queue (`L233, 502`)
- `client/applications/api/handlebars-application.mjs`: `HandlebarsApplicationMixin` `PARTS` (`L13-28, 51`), `_configureRenderOptions` `root: true` behavior (`L72-78`), `_renderHTML` / `_preparePartContext` (`L118-156`), `_replaceHTML` (`L191-223`), `_preSyncPartState` / `_syncPartState` (`L235-284`)
- `client/applications/sheets/journal/journal-entry-sheet.mjs` (`L654-678`): core Foundry `_replaceHTML` incremental part management pattern
- `client/utils/helpers.mjs` (`L161-210`) & `client/documents/collections/compendium-collection.mjs` (`L53-82`): `fromUuid` async pack fetch vs `fromUuidSync` in-memory index lookup
- `client/helpers/client-settings.mjs` (`L212-230`) & `client/documents/collections/world-settings.mjs` (`L35-47`): `ClientSettings#get` reference return behavior
- `client/applications/ux/text-editor.mjs` (`L123-189`): `TextEditor.enrichHTML` multi-pass DOM parsing & `_primeCompendiums`

### Web Platform Standards (MDN)
- [`content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) & [`contain-intrinsic-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size)
- [`HTMLImageElement.decoding`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decoding), [`HTMLImageElement.loading`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/loading), and [`createImageBitmap()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
- [`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
