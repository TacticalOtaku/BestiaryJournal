import test from "node:test";
import assert from "node:assert/strict";

import { DATA_VERSION, runMigrations } from "../scripts/foundry/migrations.js";
import { NEVER_TIER } from "../scripts/core/research-model.js";

/** A pre-0.2 world: one creature shown with a custom block list, and a world-wide detail level. */
function setupLegacyWorld({ failWrites = false } = {}) {
  const values = {
    dataVersion: 0,
    bestiaryData: { sections: [{ id: "s1", name: "Woods", creatures: [{ uuid: "Actor.wolf" }] }] },
    bestiaryKnowledge: {},
    creatureCustomDisplay: { "Actor.wolf": ["abilities", "actions"] },
    gmOnlyDetailToggle: true,
    creatureDetailLevels: { "Actor.wolf": "standard" }
  };
  const users = [{ id: "gm", name: "GM", isGM: true }, { id: "p1", name: "Ann", isGM: false }];
  globalThis.game = {
    users: { contents: users },
    settings: {
      get: (scope, key) => structuredClone(values[key]),
      set: async (scope, key, value) => {
        if (failWrites) throw new Error("disk full");
        values[key] = structuredClone(value);
      }
    }
  };
  return values;
}

test("a legacy world moves to block tiers and starting knowledge", async t => {
  t.mock.method(console, "info", () => {});
  const values = setupLegacyWorld();
  assert.equal(await runMigrations(), true);

  const entry = values.bestiaryData.sections[0].creatures[0];
  assert.equal(entry.blockTiers.biography, NEVER_TIER, "a block the GM had switched off becomes GM-only");
  assert.equal(entry.blockTiers.actions, undefined, "a shown block keeps the world default");
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.wolf"].tier, 2);
  assert.equal(values.bestiaryKnowledge.users.gm, undefined);
  assert.equal(values.dataVersion, DATA_VERSION);
  assert.equal(await runMigrations(), false, "runs once");
});

test("a failed migration leaves the world data and its version untouched", async t => {
  t.mock.method(console, "error", () => {});
  const values = setupLegacyWorld({ failWrites: true });
  const before = structuredClone(values);
  assert.equal(await runMigrations(), false);
  assert.deepEqual(values, before);
});
