# Bestiary Journal architecture

A map of the code for anyone extending it. Supported platform: Foundry VTT 14.367, dnd5e 5.3.3.

## Layers

```text
scripts/
  main.js            composition root: settings, menus, keybindings, Handlebars helpers, hooks
  core/              pure logic — no game/ui/Hooks access, unit tested in plain Node
    research-model.js    knowledge tiers: blocks, thresholds, visibility of blocks and single items
    bestiary-domain.js   normalisation, selectors, the command reducer, rights for notes and sharing
    display-names.js     splitting display names
    image-framing.js     image framing and focal point
    logger.js            the only console writer: "Bestiary Journal |" prefix, debug output behind the
                         client "debug" setting
  integrations/
    dnd5e.js         reading creature data from dnd5e actors, dnd5e labels (was helpers.mjs)
  foundry/           everything that touches the Foundry runtime
    foundry-runtime.js   thin adapter over Foundry/dnd5e globals (localize, fromUuid, enrichHTML, users)
    bestiary-store.js    world state, command relay to the authoritative GM over the module socket
    research-authority.js  GM-side check of a research roll
    research.js, migrations.js, transfer.js, creature-cache.js, creature-display.js,
    client-preferences.js, command-feedback.js
  ui/                ApplicationV2 windows and view helpers: view-model preparation and DOM only
```

The dependency direction is one-way: `ui` → `foundry` / `integrations` → `core`. `core/` must stay importable in
plain Node; if it needs something from the runtime, pass it in as an argument.

## World state and commands

World state lives in three world settings so a note does not rewrite the whole structure: `bestiaryData`
(structure), `bestiaryKnowledge` (player knowledge) and `bestiarySocial` (notes and the sharing log). Each carries a
`revision`; `dataVersion` drives `foundry/migrations.js`, which keeps the original data when a migration fails.

Changes are serialised through the authoritative active GM (`isAuthorityGm`). Player commands travel as a
server-persisted user flag that the GM clears after handling, so replaying a request changes nothing. The socket
message only names a request; it never carries authority by itself.

Research rolls are judged by the GM (`foundry/research-authority.js`): the chat message, the character's owner, the
skill, freshness and single use are checked there; the player never reports a result.

## Localisation

`lang/en.json` and `lang/ru.json`. `ru` also carries `BESTIARY.Data.*` overrides of dnd5e labels;
`localizeDndLabel` falls back to `CONFIG.DND5E` when a key is absent, so `en` does not need them.

## Checks

`npm run check` runs ESLint, `tools/check-project.mjs` (syntax, JSON, manifest paths, imports, localisation keys,
unique application ids) and the `node --test` suite.
