import test from "node:test";
import assert from "node:assert/strict";

const handlers = {};
const refreshes = [];
globalThis.Hooks = { on: (name, fn) => (handlers[name] = fn), callAll: (name, payload) => refreshes.push({ name, payload }) };
globalThis.game = {
  settings: {
    get: (scope, key) => (key === "bestiaryData" ? { sections: [{ id: "s1", creatures: [{ uuid: "Actor.wolf" }] }] } : {})
  }
};
// The cache binds its Foundry hooks on import, so the stand-ins have to exist first.
await import("../scripts/foundry/creature-cache.js");

test("editing a bestiary actor, or anything inside it, redraws the windows showing it", () => {
  handlers.updateActor({ documentName: "Actor", uuid: "Actor.wolf" });
  handlers.updateItem({ documentName: "Item", parent: { documentName: "Actor", uuid: "Actor.wolf" } });
  handlers.updateActor({ documentName: "Actor", uuid: "Actor.stranger" });

  const refresh = { name: "bestiaryJournalRefresh", payload: { changed: { creatures: true }, uuids: ["Actor.wolf"] } };
  assert.deepEqual(refreshes, [refresh, refresh], "an actor outside the bestiary redraws nothing");
});
