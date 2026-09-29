import test from "node:test";
import assert from "node:assert/strict";

import { migrateClientPreferencesToUser } from "../scripts/client-preferences.mjs";

function memoryStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    removeItem: key => data.delete(key),
    has: key => data.has(key)
  };
}

function fakeSettings(initial = {}, { failOnSet = false } = {}) {
  const values = { favoriteCreatures: [], collapsedFamilies: [], ...initial };
  const writes = [];
  globalThis.game = {
    settings: {
      get: (namespace, key) => values[key],
      set: async (namespace, key, value) => {
        if (failOnSet) throw new Error("offline");
        writes.push([key, value]);
        values[key] = value;
      }
    }
  };
  return { values, writes };
}

test("local favorites move to the user and the local copy is dropped", async () => {
  const { values } = fakeSettings();
  const storage = memoryStorage({
    "bestiary-journal.favoriteCreatures": JSON.stringify(["Actor.a", "Actor.b"])
  });

  await migrateClientPreferencesToUser(storage);

  assert.deepEqual(values.favoriteCreatures, ["Actor.a", "Actor.b"]);
  assert.equal(storage.has("bestiary-journal.favoriteCreatures"), false);
});

test("a second browser merges into what the user already has", async () => {
  const { values } = fakeSettings({ favoriteCreatures: ["Actor.a"] });
  const storage = memoryStorage({
    "bestiary-journal.favoriteCreatures": JSON.stringify(["Actor.a", "Actor.c"])
  });

  await migrateClientPreferencesToUser(storage);

  assert.deepEqual(values.favoriteCreatures, ["Actor.a", "Actor.c"]);
});

test("nothing is written when the local copy adds nothing new", async () => {
  const { writes } = fakeSettings({ collapsedFamilies: ["sec:fam"] });
  const storage = memoryStorage({
    "bestiary-journal.collapsedFamilies": JSON.stringify(["sec:fam"])
  });

  await migrateClientPreferencesToUser(storage);

  assert.deepEqual(writes, []);
  assert.equal(storage.has("bestiary-journal.collapsedFamilies"), false);
});

test("a failed write keeps the local copy for the next attempt", async () => {
  fakeSettings({}, { failOnSet: true });
  const storage = memoryStorage({
    "bestiary-journal.favoriteCreatures": JSON.stringify(["Actor.a"])
  });

  await migrateClientPreferencesToUser(storage);

  assert.equal(storage.has("bestiary-journal.favoriteCreatures"), true);
});

test("an unreadable local value is discarded without touching the user's", async () => {
  const { values } = fakeSettings({ favoriteCreatures: ["Actor.a"] });
  const storage = memoryStorage({ "bestiary-journal.favoriteCreatures": "{not json" });

  await migrateClientPreferencesToUser(storage);

  assert.deepEqual(values.favoriteCreatures, ["Actor.a"]);
  assert.equal(storage.has("bestiary-journal.favoriteCreatures"), false);
});

test("browsers that never stored anything are left alone", async () => {
  const { writes } = fakeSettings();
  await migrateClientPreferencesToUser(memoryStorage());
  assert.deepEqual(writes, []);
});
