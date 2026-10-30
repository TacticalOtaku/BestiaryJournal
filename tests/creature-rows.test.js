import test from "node:test";
import assert from "node:assert/strict";

import { GM_TIER } from "../scripts/core/research-model.js";

globalThis.Hooks = { on: () => {}, callAll: () => {} };
globalThis.game = {
  settings: { get: () => ({}) },
  i18n: { localize: key => key, has: () => false, format: key => key }
};
globalThis.CONFIG = { DND5E: {} };
// The creature cache binds its Foundry hooks on import, so the stand-ins have to exist first.
const { UNIDENTIFIED_ID, buildCreatureRows, summarizeRows } = await import("../scripts/ui/creature-rows.js");

const creature = name => ({
  name,
  img: "",
  creatureType: "Beast",
  creatureTypeKey: "beast",
  size: "Medium",
  cr: 1,
  ac: { value: 13 },
  hp: { value: 11, max: 11 },
  speeds: {}
});
const forest = {
  id: "forest",
  name: "Forest",
  sort: 1,
  families: [{ id: "fam-wolves", name: "Wolves" }],
  creatures: [
    { uuid: "Actor.wolf", familyId: "fam-wolves", addedAt: 10, image: {} },
    { uuid: "Actor.ghost", label: "Old ghost", addedAt: 20, image: {} }
  ]
};
const caves = {
  id: "caves",
  name: "Caves",
  sort: 2,
  families: [],
  creatures: [{ uuid: "Actor.wolf", addedAt: 30, image: {} }, { uuid: "Actor.bat", addedAt: 5, image: {} }]
};
const data = { sections: [forest, caves] };
const knowledge = { users: { anna: { "Actor.wolf": { tier: 1 } }, boris: { "Actor.wolf": { tier: 2 }, "Actor.bat": { tier: 1 } } } };
const players = [{ id: "anna" }, { id: "boris" }];
// Actor.ghost was deleted: no creature data.
const creatures = new Map([["Actor.wolf", creature("Wolf")], ["Actor.bat", creature("Bat")]]);

const inputs = (viewer, overrides = {}) => ({
  data, knowledge, worldTiers: {}, viewer, players, seenTiers: {}, favorites: new Set(), creatures, ...overrides
});
const gm = { id: "gm", isGM: true };
const anna = { id: "anna", isGM: false };
const byUuid = rows => Object.fromEntries(rows.map(row => [row.uuid, row]));

test("a player who cannot name a creature sees it as unidentified, never in its family", () => {
  const rows = buildCreatureRows([forest], inputs({ id: "carl", isGM: false }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].familyId, UNIDENTIFIED_ID);
  assert.ok(!JSON.stringify(rows).includes("fam-wolves"), "the real family leaked into a row");
});

test("a player who knows the name sees the creature in its family", () => {
  assert.equal(byUuid(buildCreatureRows([forest], inputs(anna)))["Actor.wolf"].familyId, "fam-wolves");
});

test("a deleted actor stays listed for the GM and counts, but is nothing to learn; players never see it", () => {
  const gmRows = buildCreatureRows([forest], inputs(gm));
  assert.equal(byUuid(gmRows)["Actor.ghost"].isMissing, true);
  const summary = summarizeRows(gmRows);
  assert.equal(summary.count, 2);
  assert.equal(summary.progress.total, 1, "only the wolf is in the progress");
  assert.equal(byUuid(buildCreatureRows([forest], inputs(anna)))["Actor.ghost"], undefined);
});

test("a creature in two collections is one library row naming both, added when it last was", () => {
  const wolf = byUuid(buildCreatureRows([forest, caves], inputs(anna)))["Actor.wolf"];
  assert.equal(wolf.collectionLabel, "Forest, Caves");
  assert.equal(wolf.addedAt, 30);
});

test("the GM's library lists every creature its collections count", () => {
  const each = new Set([forest, caves].flatMap(section => buildCreatureRows([section], inputs(gm)).map(row => row.uuid)));
  assert.equal(buildCreatureRows([forest, caves], inputs(gm)).length, each.size);
});

test("progress is the player's own, the party's for the GM, and none for a GM without players", () => {
  assert.deepEqual(byUuid(buildCreatureRows([caves], inputs(anna)))["Actor.bat"].progressTier, 0);
  const gmRows = byUuid(buildCreatureRows([caves], inputs(gm)));
  assert.equal(gmRows["Actor.wolf"].viewerTier, GM_TIER);
  assert.equal(gmRows["Actor.wolf"].progressTier, 1, "the least-informed player");
  assert.equal(summarizeRows(buildCreatureRows([caves], inputs(gm, { players: [] }))).progress, null);
});

test("a creature is new until the player has seen it at their current tier", () => {
  const seen = byUuid(buildCreatureRows([caves], inputs(anna, { seenTiers: { "Actor.wolf": 1 } })));
  assert.equal(seen["Actor.wolf"].isNew, false);
  assert.equal(seen["Actor.bat"].isNew, true);
  assert.equal(byUuid(buildCreatureRows([caves], inputs(gm)))["Actor.wolf"].isNew, false);
});

test("named creatures come first", () => {
  const rows = buildCreatureRows([caves], inputs(anna));
  assert.deepEqual(rows.map(row => row.knowsName), [true, false]);
});
