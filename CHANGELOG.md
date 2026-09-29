# Changelog

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
