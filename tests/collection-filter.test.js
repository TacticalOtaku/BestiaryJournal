import test from "node:test";
import assert from "node:assert/strict";

import { activeFilterCount, compareCollectionCards, matchesCollectionFilter } from "../scripts/core/collection-filter.js";

const state = overrides => ({ query: "", types: new Set(), sizes: new Set(), families: new Set(), crMin: "", crMax: "", ...overrides });
const card = overrides => ({ searchText: "goblin humanoid", type: "humanoid", size: "sm", familyId: "f1", cr: "0.25", name: "Goblin", ...overrides });

test("every filter narrows on its own field", () => {
  assert.equal(matchesCollectionFilter(card(), state()), true);
  assert.equal(matchesCollectionFilter(card(), state({ query: "gob" })), true);
  assert.equal(matchesCollectionFilter(card(), state({ query: "dragon" })), false);
  assert.equal(matchesCollectionFilter(card(), state({ types: new Set(["dragon"]) })), false);
  assert.equal(matchesCollectionFilter(card(), state({ sizes: new Set(["sm", "med"]) })), true);
  assert.equal(matchesCollectionFilter(card(), state({ families: new Set(["f2"]) })), false);
});

test("a CR range keeps its bounds and never matches an unknown CR", () => {
  assert.equal(matchesCollectionFilter(card(), state({ crMin: "0", crMax: "1" })), true);
  assert.equal(matchesCollectionFilter(card(), state({ crMin: "0.25" })), true);
  assert.equal(matchesCollectionFilter(card(), state({ crMin: "1" })), false);
  assert.equal(matchesCollectionFilter(card({ cr: "" }), state({ crMax: "30" })), false);
  assert.equal(matchesCollectionFilter(card({ cr: "" }), state()), true);
});

test("the search box is not counted as a filter", () => {
  assert.equal(activeFilterCount(state({ query: "x" })), 0);
  assert.equal(activeFilterCount(state({ types: new Set(["a", "b"]), crMin: "1" })), 3);
});

test("unknown names and CRs sort last in either direction", () => {
  const cards = [card({ name: "", cr: "" }), card({ name: "Zombie", cr: "0.25" }), card({ name: "Adult Dragon", cr: "17" })];
  const names = mode => [...cards].sort((a, b) => compareCollectionCards(a, b, mode)).map(item => item.name);
  assert.deepEqual(names("name-asc"), ["Adult Dragon", "Zombie", ""]);
  assert.deepEqual(names("name-desc"), ["Zombie", "Adult Dragon", ""]);
  assert.deepEqual(names("cr-asc"), ["Zombie", "Adult Dragon", ""]);
  assert.deepEqual(names("cr-desc"), ["Adult Dragon", "Zombie", ""]);
});
