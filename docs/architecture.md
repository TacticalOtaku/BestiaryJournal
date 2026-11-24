# Bestiary Journal architecture

A map of the code for anyone extending it. Supported platform: Foundry VTT 14.367, dnd5e 5.3.3.

## Layers

```text
scripts/
  main.js            composition root: menus, Handlebars helpers, refresh coalescing, lifecycle hooks
  core/              pure logic — no game/ui/Hooks access, unit tested in plain Node
    research-model.js    knowledge tiers: blocks, thresholds, visibility of blocks and single items
    research-judge.js    GM-side research roll verdict (author, character owner, skill, freshness, DC)
    knowledge-lens.js    what one viewer (GM, player, party) knows of one creature; every page asks it
                         (thresholds across collections: docs/adr/0001)
    bestiary-domain.js   normalisation, selectors, the command reducer (which also decides who may run a command);
                         a viewer is always `{ id, isGM }`
    snapshot-import.js   importing a bestiary snapshot, and the plan the GM confirms (the import run on a copy)
    guide-model.js       onboarding guide tabs, quick-start steps, and contextual quick tips
    display-names.js     splitting display names
    image-framing.js     image framing and focal point
    theme.js             window look rules: theme, accent and motion level with the OS and Foundry caps
    knowledge-progress.js  tier progress bars, tier rises, the "new to this viewer" rule
    collection-filter.js   search, filters and sort order of a collection window
    logger.js            the only console writer: "Bestiary Journal |" prefix, debug output behind the
                         client "debug" setting
  integrations/
    dnd5e.js         reading creature data from dnd5e actors, dnd5e labels (was helpers.mjs)
  foundry/           everything that touches the Foundry runtime
    foundry-runtime.js   thin adapter over Foundry/dnd5e globals (localize, fromUuid, enrichHTML, users)
    theme-root.js        stamps data-theme, data-accent and data-motion on every bestiary window
    settings.js          world/user/client settings and keybindings registration
    chat-links.js        clickable creature links in chat messages
    journal-directory.js Journals sidebar button and hiding internal note-store JournalEntries
    bestiary-store.js    world state, command relay to the authoritative GM over the module socket
    note-store.js        scoped JournalEntry / JournalEntryPage persistence for notes (GM, party, private)
    research-authority.js  GM-side check of a research roll
    research.js, research-skills.js, migrations.js, transfer.js, creature-cache.js,
    creature-display.js, client-preferences.js, command-feedback.js,
    knowledge-watch.js, encounter.js, sharing-window.js
  ui/                ApplicationV2 windows and view helpers: view-model preparation and DOM only
    bestiary-app.js      the library window; section-view.js a collection (groups/filters in section-model.js)
    creature-view.js     a creature's card (filtered statblock in creature-statblock.js)
    creature-rows.js     the creature rows of the library and of a collection, their count and progress
    creature-cards.js    view-model builder, name sort, and chat posting for creature cards
    knowledge-board.js   the GM's party knowledge table; knowledge-ui.js roster, sharing dialog and tier actions
    comments.js          note channel view-model, submission, and party notes feed
    entry-editor.js      creature entry, research DC/skills, and block/item reveal threshold editor
    tile-editor.js       collection and family editor dialog
    bulk-import.js       world-actor and compendium bulk import dialog
    bulk-research.js     batch research DC and allowed-skills editor
    tier-settings.js     custom world research tiers and global block threshold editor
    guide-app.js         role-aware interactive onboarding guide window (`BestiaryGuideApp`)
    actor-integration.js "Bestiary…" menus in Actor Directory, NPC sheet header, and Token HUD
    artwork.js           still poster frames and hover/focus animated GIF/WebP playback
    ui-effects.js        entrance/disclosure animations, ARIA tablist keys, context menus, cursor light
    api.js               the public API `game.bestiaryJournal` (API.md)
```

The dependency direction is an acyclic hierarchy: `ui` → `foundry` → `integrations` → `core`, with
`foundry/foundry-runtime.js` serving as the zero-import adapter over Foundry/dnd5e globals shared by `ui`, `foundry`,
and `integrations`. `core/` must stay importable in plain Node; if it needs something from the runtime, pass it in as
an argument.

## World state and commands

World state splits structure and knowledge across `bestiaryData` (structure) and `bestiaryKnowledge` (player
knowledge), while notes live in hidden, permission-scoped `JournalEntry` / `JournalEntryPage` documents
(`foundry/note-store.js`): one GM-only store (`default: NONE`), one party store (`default: OBSERVER`) for shared
notes, and one private store per author (`default: NONE`, `[authorId]: OBSERVER`). On startup, `foundry/migrations.js`
migrates any legacy `bestiarySocial` comments into these `JournalEntry` stores and clears the setting. Each world
store carries a `revision`; `dataVersion` drives legacy `0.1.x` schema migration (`foundry/migrations.js`), while
`researchTiers` stores customizable tier definitions (`tierSchemaVersion` upgrades legacy `4` "GM only" values to
`NEVER_TIER`, and `REMAP_TIER_VALUES` atomically shifts stored thresholds and knowledge on tier changes). Before
migration writes, `migrationBackup` holds the raw structure, knowledge and version. A failed write restores those
originals, including a write whose acknowledgement failed after saving. If storage also refuses rollback, the
recovery copy is retained and a retry refuses to overwrite it with partial data. A GM must inspect that copy and any
subsequent world changes before recovery: restore structure and knowledge first, then the original version, and clear
the backup only after verifying them. Successful migration clears the recovery copy; a cleanup failure does not undo
the completed migration.

Changes are serialised through the authoritative active GM (`isAuthorityGm`). Player commands travel as a
server-persisted user flag that the GM clears after handling, so replaying a request changes nothing. The socket
message only names a request; it never carries authority by itself.

Whether a user may run a command is decided in one place, the reducer (`applyBestiaryCommand`): GM-only commands,
the sharing rules (from facts the store passes in) and the rights over creatures and notes. A refusal throws a
`BestiaryCommandError` with a localisation key that reaches the requester; a command that finds nothing left to
change (a note already deleted, a locked creature) changes nothing quietly. The store is transport only, and the
authority's own commands take the same path as relayed ones.

Research rolls are judged by the GM: `foundry/research-authority.js` reads the chat message (through
`integrations/dnd5e.js`) and the world, and the pure `core/research-judge.js` decides — the message's author, the
character's owner, the skill, freshness and single use, then the DC; the player never reports a result. The DC and
skills of a creature in several collections resolve like reveal thresholds (`docs/adr/0002`).

## Window look

The windows share AIM: Actor Window's design system without copying its layouts. Tokens live on `.bestiary-app`
in `styles/tokens.css`: «Ночь» is the default palette, `data-theme="parchment"` overrides every colour, and the six
accents are named (`data-accent`), each with its own value per theme. The user picks theme, accent and density
(scope `user`), and collection cover size and motion level per device (scope `client`); «Авто» follows Foundry's colour
theme and accent. `foundry/theme-root.js` stamps the attributes on render and restamps open windows when a choice,
Foundry's scheme or AIM's settings change. The OS «reduce motion» caps the level at «off», Foundry's
`performance-low` at «reduced». `tests/theme-contrast.test.js` keeps text and tier colours at 4.5:1 on every surface
in both themes. Type follows AIM too: the interface is Onest (OFL, `assets/fonts`, copied from AIM), the
display face is Palatino for Latin only (`local()`, nothing downloaded), and Cyrillic headings fall through to Onest.
Cards, ability tiles, the row accent edge, the tab ink, the art sweep and the cursor light (`.bestiary-spot`,
`ui/ui-effects.js`) are AIM's recipes.

Stylesheets, in the order `module.json` loads them: `tokens.css` (type, palettes, accents), `frame.css` (every
window: frame, resets, artwork, shared controls, the context menu), `library.css`, `collection.css`, `creature.css`,
`editors.css` (forms, bulk import and research, world tiers, dialogs), `board.css` (party knowledge board),
`density.css` (compact density overrides), `motion.css` (motion levels, after components so they override them) and
`content.css` (cards posted to chat).

## Localisation

`lang/en.json` and `lang/ru.json`. `ru` also carries `BESTIARY.Data.*` overrides of dnd5e labels;
`localizeDndLabel` falls back to `CONFIG.DND5E` when a key is absent, so `en` does not need them.

## Checks

`npm run check` runs ESLint, `tools/check-project.mjs` (syntax, JSON, manifest paths, imports, localisation keys,
unique application ids) and the `node --test` suite. The release check in a running Foundry is in
`docs/live-check.md`, with `tools/live-check.js` for fonts, clipping, overflow and unlabelled buttons.
