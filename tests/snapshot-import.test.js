import test from "node:test";
import assert from "node:assert/strict";

import { BESTIARY_COMMANDS, applyBestiaryCommand, createBestiaryState } from "../scripts/core/bestiary-domain.js";
import { planSnapshotImport } from "../scripts/core/snapshot-import.js";

let counter = 0;
const deps = { now: () => 1_000, generateId: () => `id${++counter}` };

const world = () => createBestiaryState({
  data: {
    sections: [
      { id: "forest", name: "Forest", sort: 100, families: [], creatures: [{ uuid: "Actor.wolf" }] },
      { id: "caves", name: "Caves", sort: 200, locked: true, families: [], creatures: [{ uuid: "Actor.bat" }] },
      { id: "swamp", name: "Swamp", sort: 300, families: [], creatures: [] }
    ]
  }
});
const payload = {
  sections: [
    { id: "forest", name: "Forest", families: [{ id: "f1", name: "Wolves" }], creatures: [{ uuid: "Actor.bear", familyId: "f1" }] },
    { id: "other-id", name: "Caves", families: [], creatures: [{ uuid: "Actor.rat" }] },
    { id: "desert", name: "Desert", families: [], creatures: [{ uuid: "Actor.scorpion" }] }
  ]
};
const names = sections => sections.map(section => section.name).sort();
const run = mode => applyBestiaryCommand(world(), { type: BESTIARY_COMMANDS.IMPORT_SNAPSHOT, payload, mode, isGM: true }, deps).state.data.sections;

test("a merge plan names what the merge then does", () => {
  const plan = planSnapshotImport(world().data, payload, "merge");
  assert.deepEqual(plan, { merged: ["Forest"], created: ["Desert"], removed: [], locked: ["Caves"] });

  const after = run("merge");
  assert.deepEqual(names(after), ["Caves", "Desert", "Forest", "Swamp"]);
  const forest = after.find(section => section.id === "forest");
  assert.deepEqual(forest.creatures.map(entry => entry.uuid), ["Actor.wolf", "Actor.bear"]);
  assert.equal(forest.creatures[1].familyId, forest.families.find(family => family.name === "Wolves").id);
});

test("a replace plan names what the replace then does", () => {
  const plan = planSnapshotImport(world().data, payload, "replace");
  assert.deepEqual(plan, { merged: [], created: ["Forest", "Desert"], removed: ["Forest", "Swamp"], locked: ["Caves"] });
  assert.deepEqual(names(run("replace")), ["Caves", "Desert", "Forest"]);
});

test("a locked collection comes through either import untouched", () => {
  for (const mode of ["merge", "replace"]) {
    const caves = run(mode).find(section => section.id === "caves");
    assert.deepEqual(caves.creatures.map(entry => entry.uuid), ["Actor.bat"], mode);
  }
});

test("planning changes nothing", () => {
  const data = world().data;
  const before = JSON.stringify(data);
  planSnapshotImport(data, payload, "merge");
  planSnapshotImport(data, payload, "replace");
  assert.equal(JSON.stringify(data), before);
});

test("an empty snapshot imports nothing", () => {
  const result = applyBestiaryCommand(world(), { type: BESTIARY_COMMANDS.IMPORT_SNAPSHOT, payload: {}, mode: "replace", isGM: true }, deps);
  assert.equal(result.changedAny, false);
});
