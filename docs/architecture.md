# Bestiary Journal architecture

A map of the code for anyone extending it. Supported platform: Foundry VTT 14.367, dnd5e 5.3.3.

## Layers

```text
scripts/
  main.js            composition root: settings, menus, keybindings, Handlebars helpers, hooks
  core/              pure logic — no game/ui/Hooks access, unit tested in plain Node
    research-model.js    knowledge tiers: blocks, thresholds, visibility of blocks and single items
    knowledge-lens.js    what one viewer (GM, player, party) knows of one creature; every page asks it
                         (thresholds across collections: docs/adr/0001)
    bestiary-domain.js   normalisation, selectors, the command reducer (which also decides who may run a command)
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
    bestiary-store.js    world state, command relay to the authoritative GM over the module socket
    research-authority.js  GM-side check of a research roll
    research.js, migrations.js, transfer.js, creature-cache.js, creature-display.js,
    client-preferences.js, command-feedback.js, knowledge-watch.js, encounter.js
  ui/                ApplicationV2 windows and view helpers: view-model preparation and DOM only
    creature-rows.js     the creature rows of the library and of a collection, their count and progress
    bestiary-app.js      the library; section-view.js a collection (family groups and filters in section-model.js);
    creature-view.js     a creature's card (its statblock, cut down to what the viewer knows, in creature-statblock.js);
    knowledge-board.js   the GM's party knowledge table; api.js the public API (API.md)
```

The dependency direction is one-way: `ui` → `foundry` / `integrations` → `core`. `core/` must stay importable in
plain Node; if it needs something from the runtime, pass it in as an argument.

## World state and commands

World state lives in three world settings so a note does not rewrite the whole structure: `bestiaryData`
(structure), `bestiaryKnowledge` (player knowledge) and `bestiarySocial` (notes). Each carries a
`revision`; `dataVersion` drives `foundry/migrations.js`, which keeps the original data when a migration fails.

Changes are serialised through the authoritative active GM (`isAuthorityGm`). Player commands travel as a
server-persisted user flag that the GM clears after handling, so replaying a request changes nothing. The socket
message only names a request; it never carries authority by itself.

Whether a user may run a command is decided in one place, the reducer (`applyBestiaryCommand`): GM-only commands,
the sharing rules (from facts the store passes in) and the rights over creatures and notes. A refusal throws a
`BestiaryCommandError` with a localisation key that reaches the requester; a command that finds nothing left to
change (a note already deleted, a locked creature) changes nothing quietly. The store is transport only, and the
authority's own commands take the same path as relayed ones.

Research rolls are judged by the GM (`foundry/research-authority.js`): the chat message, the character's owner, the
skill, freshness and single use are checked there; the player never reports a result.

## Window look

The windows share AIM: Actor Window's design system without copying its layouts. Tokens live on `.bestiary-app`
in `styles/tokens.css`: «Ночь» is the default palette, `data-theme="parchment"` overrides every colour, and the six
accents are named (`data-accent`), each with its own value per theme. The user picks theme and accent (scope `user`)
and the motion level (scope `client`); «Авто» follows Foundry's colour scheme and «Как в AIM» borrows AIM's own
theme and accent. `foundry/theme-root.js` stamps the attributes on render and restamps open windows when a choice,
Foundry's scheme or AIM's settings change. The OS «reduce motion» caps the level at «off», Foundry's
`performance-low` at «reduced». `tests/theme-contrast.test.js` keeps text and tier colours at 4.5:1 on every surface
in both themes. Type follows AIM too: the interface is Onest (OFL, `assets/fonts`, copied from AIM), the
display face is Palatino for Latin only (`local()`, nothing downloaded), and Cyrillic headings fall through to Onest.
Cards, ability tiles, the row accent edge, the tab ink, the art sweep and the cursor light (`.bestiary-spot`,
`ui/ui-effects.js`) are AIM's recipes.

Stylesheets, in the order `module.json` loads them: `tokens.css` (type, palettes, accents), `frame.css` (every
window: frame, resets, artwork, shared controls, the context menu), `library.css`, `collection.css`, `creature.css`,
`editors.css` (forms, bulk import and research, world tiers, dialogs), `motion.css` (motion levels, last so they
override every component) and `content.css` (cards posted to chat).

## Localisation

`lang/en.json` and `lang/ru.json`. `ru` also carries `BESTIARY.Data.*` overrides of dnd5e labels;
`localizeDndLabel` falls back to `CONFIG.DND5E` when a key is absent, so `en` does not need them.

## Checks

`npm run check` runs ESLint, `tools/check-project.mjs` (syntax, JSON, manifest paths, imports, localisation keys,
unique application ids) and the `node --test` suite. The release check in a running Foundry is in
`docs/live-check.md`, with `tools/live-check.js` for fonts, clipping, overflow and unlabelled buttons.
