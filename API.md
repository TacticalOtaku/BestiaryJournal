# Bestiary Journal API

For macros and other modules. Available after Foundry's `ready` hook as `game.bestiaryJournal`, and as
`game.modules.get("bestiary-journal").api`.

`uuid` is an actor UUID as the bestiary stores it: a world actor (`Actor.…`) or a compendium actor
(`Compendium.dnd5e.monsters.Actor.…`). A collection (`sectionRef`) is named by its id or by its exact name.

Every change goes through the authoritative GM, like a change made in the windows. A call the current user has
no right to make rejects with a `BestiaryCommandError`; its `key` is a localisation key.

## Windows

| Call | What it does |
| --- | --- |
| `open()`, `close()`, `toggle()` | The library window. |
| `openCreature(uuid, { sectionId, rail })` | A creature's card. `rail` is `"knowledge"`, `"comments"` or `"config"`. Warns and returns nothing when the user may not open it. |
| `openCollection(sectionRef)` | A collection's window, or `null` when there is no such collection. |
| `openKnowledgeBoard(sectionRef?)` | GM: the party knowledge board, on one collection or on all of them. |

## Reading

| Call | Returns |
| --- | --- |
| `isInBestiary(uuid)` | Whether the actor has an entry in any collection. |
| `canView(uuid)` | Whether the current user may open the creature. |
| `getTier(uuid, userId = game.user.id)` | The user's tier: `0` unknown, `1` rumours, `2` studied, `3` mastered. |

## Changing (GM)

| Call | What it does |
| --- | --- |
| `grantKnowledge(uuids, userIds, tier)` | Sets `tier` for one creature or an array, for one user id, an array, or `"party"` (every player). Locked creatures are skipped. |
| `addToCollection(uuid, sectionRef)` | Adds the actor to the collection. `{ changed: false }` when it is already there, the collection is locked or either is missing. |

Both resolve to `{ changed, stores }` as the GM applied them.

## Example

```js
// Everyone who fought the goblins now knows them well.
const api = game.modules.get("bestiary-journal").api;
await api.grantKnowledge("Compendium.dnd5e.monsters.Actor.TjWQOgI3A4UAl7lC", "party", 2);
api.openCreature("Compendium.dnd5e.monsters.Actor.TjWQOgI3A4UAl7lC");
```

## Hook

`bestiaryJournalRefresh` is called on every client after a change, with `{ changed, uuids }`: `changed` names the
stores that changed (`data`, `knowledge`, `social`, and locally `creatures` and `seen`), `uuids` the creatures
involved or `null` for any.
