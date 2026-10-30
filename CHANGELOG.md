# Changelog

## 0.4.1

### Changed
- A creature in several collections shows players the same thing everywhere: each block and action opens at the lowest tier any of their collections sets. The GM's tier editor names the collection that opens a block earlier.
- A card posted «for the party» in a world without players shows only the silhouette.
- «Preview as» a player shows that player's collections and research panel (the roll stays theirs) instead of the GM's.
- A refused action says why: a note in the GM channel, someone else's note, a creature the player cannot open. These used to do nothing without a word.
- A creature in several collections has one research check: the lowest DC and every allowed skill among the collections the player sees. The collection a roll comes from no longer changes its DC.

### Fixed
- The GM's library lists creatures whose actor was deleted, marked like in collections, so its count matches the collection covers.
- A content block no tier reveals is marked «GM only» on the GM's card again.
- The research result in chat names the skill in the module's own translation, as the card does.

### Development
- What a viewer knows of a creature is one module, the knowledge lens (`core/knowledge-lens.js`); every page asks it. Reveal thresholds and the research check of a creature in several collections resolve to the most lenient one the player can see (`docs/adr/0001`, `docs/adr/0002`).
- The library and collection rows come from one module (`ui/creature-rows.js`), and the creature card passes on only the fields of blocks the viewer knows (a whitelist in `ui/creature-statblock.js`).
- The reducer decides who may run a command; the store is transport only. A research roll is judged by a pure function (`core/research-judge.js`), and dnd5e is read only through `integrations/dnd5e.js`.
- Snapshot import has its own module (`core/snapshot-import.js`); the plan the GM confirms is the import run on a copy.
- `GLOSSARY.md` and `docs/adr/` record the domain terms and the decisions behind them.

## 0.4.0

### Added
- A new look based on the AIM design system: **Night** and **Parchment** themes, six accents, the Onest interface font (bundled, with Cyrillic) and Palatino for Latin headings. Big collection covers, creature cards built from AIM's tiles and cards, tier tags with a tier ladder, and one form style across the editors.
- **Window look** drawer in the library: theme (Auto, Night, Parchment, or Like AIM), accent, density (comfortable or compact) and motion (full, reduced, off), chosen per user. The OS reduced-motion setting turns motion off; Foundry's low performance mode reduces it.
- **Party knowledge** board for the GM: creatures down, players across, a tier in each cell, and one tier for a whole selection after a confirmation. Locked creatures are skipped.
- **Bestiary…** in the actor directory's context menu, an NPC sheet's ⋮ menu and the token HUD: open the creature, add it to a collection, give the party a tier.
- **Encounter reveal** world setting: when a creature from the bestiary fights the party, players who do not know it get Rumours.
- Collection covers show progress: the player's own, or for the GM what the whole party knows.
- A «new» marker on creatures a player learned more about since they last looked, and a notification when their tier rises.
- **Party notes** in the library: every note about the creatures a player can open, newest first.
- An «Unidentified» group: a player sees a creature they cannot name there, not in its family, which would hint at what it is.
- A public API for macros and other modules, `game.bestiaryJournal` (see `API.md`).
- Empty lists say what to do next: create a collection, open the collections, or clear the search.

### Changed
- The research panel shows the DC only once the player knows the CR or the GM set the DC, and the skill only once they know the type or the GM set it. Chat results follow the same rule.
- Chat cards carry the tier they were posted at and follow Foundry's chat theme.
- Plural forms in every count («1 существо», «4 существа»).
- Confirmations name their action («Remove creature», «Delete collection») instead of Yes and No.
- Windows do not shrink below 540 × 420; narrow collection windows turn their toolbar into icons.

### Fixed
- Per-action tier lists showed «Unknown» instead of «Same as block» when there was no override.
- Languages showed dnd5e keys instead of their names.
- Broken artwork shows the silhouette, and a deleted actor shows no CR, AC or HP.
- Open windows refresh after an actor in the bestiary is edited.
- A collection or family cannot be saved without a name, and an editor stays open when saving fails, so nothing typed is lost.
- Exporting one creature says so.
- A chat card of an actor with no artwork showed a broken image.
- The closed filter panel of a collection could take keyboard focus off screen.
- Headings, context menus and tooltips no longer fall back to Foundry's fonts.

### Development
- The collection window's search, filters and sort order are a pure module with tests (`core/collection-filter.js`); the collection view model and the creature statblock moved out of their windows.
- `docs/live-check.md` and `tools/live-check.js`: the release check in a running Foundry, with a script for fonts, clipping, overflow and unlabelled buttons.
- The stylesheet is split into tokens, frame, library, collection, creature, editors, board, density, motion and content, with a contrast test for both themes.

## 0.3.3

### Fixed
- A creature that sits in several collections is read through the same collection everywhere: the first one on display. Before, after collections were reordered, a library tile and the card it opens could follow different reveal settings.
- Removing a creature from a collection is blocked only by a lock in that collection, not by a lock on the same creature elsewhere.
- Bulk import with **Copy into world** creates all actors in one request (20 monsters in about half a second) and says so when the copy fails, instead of only writing to the console.

### Changed
- Sharing knowledge no longer keeps a separate share log in the world settings. Nothing displayed it, and it grew with every share; the knowledge record still notes who shared it.

### Development
- Tests for the creature card (nothing an unknown creature hides reaches the card) and for the pre-0.2 data migration (a failed write leaves the world untouched).
- The entry lookup no longer re-normalises the whole bestiary on every call.
- Removed unused exports.

## 0.3.2

### Fixed
- **To chat** from a player's creature card posts only what the whole party knows, so it no longer reveals a creature past the sharing rules.
- Actions read dnd5e 5.3 activities correctly: saving throws name their abilities instead of "[OBJECT SET]", attacks show their full to-hit and their kind, damage shows the resolved formula and damage types instead of "@mod".
- A description that fails to enrich is left empty instead of showing its raw text, GM secret blocks included.
- Bulk import no longer lists the previous compendium when the source is switched while it is still loading.
- Switching collections clears the type and size filters along with the family filter.
- Players no longer see or count entries of deleted actors in a collection; the GM still does, to clean them up.
- `npm run deploy` finds the Foundry Data folder on macOS without `FOUNDRY_DATA`.

### Development
- Tests for the GM command relay (replayed, forged and GM-only requests, research rolls) and for dnd5e activity parsing.
- Chat links read the bestiary once per refresh instead of once per link.
- Removed unused helpers; one shared `escapeHTML` (Foundry's), speed label and name sort.

## 0.3.1

### Added
- **When players may share** world setting: always, out of combat (default) or after a rest. A player whose character is in a started combat cannot share; in "after a rest" worlds the character must take a short or long rest after their last combat round. The authoritative GM records rests and fights and enforces the rule.
- **To chat (what players know)** in the creature menu of a collection: the GM posts a creature card without opening it, showing only what every player already knows.
- Perception is offered as a research skill.
- **Damage modification** block (tier 3 by default): flat amounts dnd5e adds to or removes from incoming damage, shown as "All damage −3" when one amount covers every type.

### Changed
- Defensive traits are split into damage and condition immunities. Damage chips carry their kind: full shield for immunity, half shield for resistance, arrows for damage modification, a cracked heart for vulnerability; protection is green, weakness red.
- The research settings window opens on the DC and skills already in force for the chosen scope, and says when the entries differ.

### Fixed
- After importing a bestiary, text fields such as a new family's name accepted typing again: the file picker now lives in the document like Foundry's own, so the desktop app gets its keyboard focus back.
- The import and share dialogs are wider and resizable, and their buttons wrap instead of overlapping.
- A creature card posted to chat keeps its 52 px portrait when the module is disabled.

## 0.3.0

### Added
- **Debug logging** client setting: detailed diagnostics in the browser console, off by default.

### Changed
- The window honours the operating system's reduce-motion preference for its CSS transitions and entrance animation too.
- The manifest caps compatibility at Foundry 14 until the next core generation is tested.

### Development
- Scripts are layered into `core/`, `foundry/`, `integrations/` and `ui/`; `scripts/main.js` is the entry point; `.mjs` files became `.js`; `languages/` became `lang/`. See `docs/architecture.md`.
- One logger (`scripts/core/logger.js`) replaces direct console calls with three different prefixes.
- ESLint and Prettier; `npm run check`, `deploy`, `package` and `release` as in the other TacticalOtaku modules; the archive goes to `dist/`.
- Font Awesome classes use the current `fa-solid` / `fa-regular` names.

## 0.2.5

### Changed
- **Favourites and collapsed families belong to the user, not the browser.** They are stored on the server and are the same on every device a player uses. Existing favourites move over automatically on first login; marks from several browsers are merged.

### Fixed
- Toggling "Allow sharing between players" and "Research by roll" updates open cards at once: the share and roll buttons appear or disappear without reopening the window.
- The version in `package.json` matches the module manifest.

### Development
- Tests for the preference move: merging, a retry after a failed write, a damaged local value.

## 0.2.4

### Security
- Knowledge tiers apply across the whole interface: the library, collection, quick view, filters, search and sorting no longer reveal a name, portrait, type, CR, AC or hit points beyond what the viewer knows. That data does not reach hidden page attributes either.
- The GM checks research rolls. The player makes a regular dnd5e check; the GM verifies the chat message (author, character owner, skill, freshness, single use), computes the DC and the result, and posts the outcome. A client can no longer report "success" or get around single-attempt mode.
- A player's request to the GM is cleared once handled and a replayed socket message is ignored, so someone else's command cannot be run again.
- "Send to chat" and the research result in chat show only what the sender knows: an unknown creature is sent as an unnamed silhouette.
- Sharing knowledge accepts only players of the world; notes and sharing work only for bestiary creatures available to the author.
- Hiding a collection or a creature takes effect at once in windows players already have open.

### Fixed
- The bestiary button appears again in the header of the Journal tab (Foundry v13+ hook).
- The biography falls back to the main text when the public version is empty.
- Bulk import from world actors: the list scrolls again, the Import button no longer slides off the window, and loading shows a progress indicator.
- "Copy to world" uses the regular compendium import and recognises actors already copied by their source, not by name.
- The entry editor no longer loses unsaved edits when the image source changes and no longer turns an automatic skill into an explicit one.
- The research panel and the roll take the DC from the same entry.
- Editing a note can be cancelled; switching the channel cancels editing.
- Activation time and item type labels no longer show raw localisation keys; a creature's special speed appears on the card.
- JSON import: "replace" keeps locked collections; "merge" matches collections by id first and repairs duplicate ids and creatures. Before applying, the dialog shows what will be merged, created and deleted.
- Exporting one collection archives knowledge about its creatures only.
- Every action reports an error (no GM, timeout, lock) instead of failing silently.

### Changed
- Navigation: Overview, All creatures (by name), Recent, Favourites. Search in the overview covers every creature.
- The layout follows the window's width, not the monitor's; in a narrow window the sidebar folds into an icon strip and the quick view slides over the list.
- Fixed in the interface: a filter badge showing "0", list rows shifting without a knowledge badge, spacing in the collection editor and dialogs, a sticky drag highlight, the strip of a closed preview panel, collapsed families going out of sync, the background of open filters, the window's dark theme.
- Search, the selected creature and panel scrolling survive updates from other players.
- Window titles update when the collection changes or a name is revealed.
- The context menu closes on Esc, scrolling and focus loss and works from the keyboard; action cards expand from the keyboard.
- Creature data is cached and recomputed only when the actor or its items change; actors load in parallel.
- Updates are batched and windows redraw only for changes that concern them. The double redraws after every action are gone.

### Development
- Removed deprecated calls: `enrichHTML({ async })`, positional `rollSkill`, the global `FilePicker` and `saveDataToFile`, `render(true)`.
- New modules: `research-authority`, `creature-cards`, `creature-cache`, `command-feedback`.
- Store tests with a Foundry stand-in: replayed and forged requests, roll checks.

### Known limitation
- Foundry world settings are readable by every client, so a player with the console can read other players' knowledge and notes. See the README.

## 0.2.3 and earlier

History before 0.2.4 was not kept in this file.
