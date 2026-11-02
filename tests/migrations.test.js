import test from "node:test";
import assert from "node:assert/strict";

import { DATA_VERSION, runMigrations } from "../scripts/foundry/migrations.js";
import { NEVER_TIER } from "../scripts/core/research-model.js";

/** A pre-0.2 world: one creature shown with a custom block list, and a world-wide detail level. */
function setupLegacyWorld({ failWrites = false } = {}) {
  const values = {
    dataVersion: 0,
    migrationBackup: {},
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

for (const failedKey of ["bestiaryData", "bestiaryKnowledge", "dataVersion"]) {
  test(`migration restores originals when ${failedKey} fails after saving`, async t => {
    t.mock.method(console, "error", () => {});
    t.mock.method(console, "info", () => {});
    const values = setupLegacyWorld();
    const before = structuredClone(values);
    const save = game.settings.set;
    let failed = false;
    game.settings.set = async (scope, key, value) => {
      await save(scope, key, value);
      if (key === failedKey && !failed) {
        failed = true;
        throw new Error("acknowledgement lost after saving");
      }
    };

    assert.equal(await runMigrations(), false);
    assert.deepEqual(values, before, "all original stores and version are restored");
    assert.equal(await runMigrations(), true, "a recovered migration can be retried");
    assert.equal(values.dataVersion, DATA_VERSION);
    assert.deepEqual(values.migrationBackup, {});
  });
}

test("migration saves recovery data before touching either store", async t => {
  t.mock.method(console, "error", () => {});
  const values = setupLegacyWorld();
  const before = structuredClone(values);
  const save = game.settings.set;
  game.settings.set = async (scope, key, value) => {
    if (key === "migrationBackup") throw new Error("backup unavailable");
    return save(scope, key, value);
  };

  assert.equal(await runMigrations(), false);
  assert.deepEqual(values, before);
});

test("a failed rollback retains originals and prevents overwriting their recovery copy", async t => {
  t.mock.method(console, "error", () => {});
  const values = setupLegacyWorld();
  const before = structuredClone(values);
  const save = game.settings.set;
  let dataWrites = 0;
  game.settings.set = async (scope, key, value) => {
    if (key === "bestiaryKnowledge") throw new Error("knowledge write unavailable");
    if (key === "bestiaryData" && ++dataWrites > 1) throw new Error("rollback unavailable");
    return save(scope, key, value);
  };

  assert.equal(await runMigrations(), false);
  assert.deepEqual(values.migrationBackup.originals, {
    bestiaryData: before.bestiaryData,
    bestiaryKnowledge: before.bestiaryKnowledge,
    dataVersion: before.dataVersion
  });
  assert.notDeepEqual(values.bestiaryData, before.bestiaryData);
  const afterFailure = structuredClone(values);
  assert.equal(await runMigrations(), false);
  assert.deepEqual(values, afterFailure, "do not overwrite recovery data with partial state");
});

test("a recovery-copy cleanup failure does not roll back a completed migration", async t => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "info", () => {});
  const values = setupLegacyWorld();
  const before = structuredClone(values.bestiaryData);
  const save = game.settings.set;
  game.settings.set = async (scope, key, value) => {
    if (key === "migrationBackup" && !value.originals) throw new Error("cleanup unavailable");
    return save(scope, key, value);
  };

  assert.equal(await runMigrations(), true);
  assert.equal(values.dataVersion, DATA_VERSION);
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.wolf"].tier, 2);
  assert.deepEqual(values.migrationBackup.originals.bestiaryData, before);
  const migrated = structuredClone(values);
  assert.equal(await runMigrations(), false);
  assert.deepEqual(values, migrated);
});
