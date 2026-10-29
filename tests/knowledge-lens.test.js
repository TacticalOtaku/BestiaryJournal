import test from "node:test";
import assert from "node:assert/strict";

import { PARTY_VIEWER, createKnowledgeLens, playerEntryContexts, viewerTier } from "../scripts/core/knowledge-lens.js";
import { GM_TIER, MIN_RESEARCH_TIER, NEVER_TIER, itemTierKey } from "../scripts/core/research-model.js";

const lens = (tier, entries = [{}], worldTiers = {}) => createKnowledgeLens({ tier, worldTiers, entries });
const knowledge = {
  users: {
    anna: { "Actor.wolf": { tier: 3 } },
    boris: { "Actor.wolf": { tier: 1 } }
  }
};

test("the GM sees every block, GM-only ones too", () => {
  const gm = lens(GM_TIER, [{ blockTiers: { biography: NEVER_TIER } }]);
  assert.equal(gm.show("biography"), true);
  assert.equal(gm.showItem("actions", "bite"), true);
});

test("a player sees each block from its own tier", () => {
  assert.equal(lens(1).knowsName, true);
  assert.equal(lens(1).show("cr"), false, "CR opens at tier 2");
  assert.equal(lens(2).show("cr"), true);
  assert.equal(lens(3, [{ blockTiers: { biography: NEVER_TIER } }]).show("biography"), false);
});

test("a hidden parent block hides its sub-blocks", () => {
  const player = lens(2, [{ blockTiers: { abilities: 3, str: 1 } }]);
  assert.equal(player.show("str"), false);
});

test("an item pinned to its own tier opens apart from its block", () => {
  const itemTiers = { [itemTierKey("actions", "bite")]: 3 };
  assert.equal(lens(2, [{ itemTiers }]).showItem("actions", "bite"), false);
  assert.equal(lens(2, [{ itemTiers }]).showItem("actions", "claw"), true);
  assert.equal(lens(3, [{ itemTiers }]).showItem("actions", "bite"), true);
});

test("a creature in two collections opens at the lower threshold of the two", () => {
  const cave = { blockTiers: { cr: 3 }, itemTiers: { [itemTierKey("actions", "bite")]: 3 } };
  const forest = { blockTiers: { cr: 1 } };
  const player = lens(1, [cave, forest]);
  assert.equal(player.show("cr"), true);
  assert.equal(player.blockTiers.cr, 1);
  // The forest has no override for the bite: it opens there with the actions block, at tier 2.
  assert.equal(player.itemTiers[itemTierKey("actions", "bite")], 2);
});

test("an entry players cannot see does not lower the threshold", () => {
  const data = {
    sections: [
      { id: "cave", sort: 1, hidden: false, families: [], creatures: [{ uuid: "Actor.wolf", blockTiers: { cr: 3 } }] },
      { id: "secret", sort: 2, hidden: true, families: [], creatures: [{ uuid: "Actor.wolf", blockTiers: { cr: 1 } }] },
      { id: "forest", sort: 3, hidden: false, families: [], creatures: [{ uuid: "Actor.wolf", hidden: true, blockTiers: { cr: 1 } }] }
    ]
  };
  const entries = playerEntryContexts(data, "Actor.wolf").map(({ entry }) => entry);
  assert.equal(entries.length, 1);
  assert.equal(lens(1, entries).show("cr"), false);
});

test("with no entry the world thresholds apply", () => {
  assert.equal(lens(1, [], { name: 2 }).knowsName, false);
  assert.equal(lens(2, [], { name: 2 }).knowsName, true);
});

test("an automatic DC shows once CR is known, an explicit one at once", () => {
  assert.equal(lens(1).knowsDc({ isDcExplicit: false }), false);
  assert.equal(lens(1).knowsDc({ isDcExplicit: true }), true);
  assert.equal(lens(2).knowsDc({ isDcExplicit: false }), true);
});

test("an automatic skill shows once the type is known, an explicit one at once", () => {
  assert.equal(lens(0).knowsSkill({ isSkillsExplicit: false }), false);
  assert.equal(lens(0).knowsSkill({ isSkillsExplicit: true }), true);
  assert.equal(lens(1).knowsSkill({ isSkillsExplicit: false }), true);
});

test("each viewer gets their own tier: GM, a player, the party", () => {
  const players = [{ id: "anna" }, { id: "boris" }];
  assert.equal(viewerTier(knowledge, { id: "gm", isGM: true }, "Actor.wolf", players), GM_TIER);
  assert.equal(viewerTier(knowledge, { id: "anna", isGM: false }, "Actor.wolf"), 3);
  assert.equal(viewerTier(knowledge, { id: "anna", isGM: false }, "Actor.bear"), MIN_RESEARCH_TIER);
  assert.equal(viewerTier(knowledge, PARTY_VIEWER, "Actor.wolf", players), 1, "the least-informed player");
});

test("a party with no players knows nothing, so a public post is a silhouette", () => {
  const tier = viewerTier(knowledge, PARTY_VIEWER, "Actor.wolf", []);
  assert.equal(tier, MIN_RESEARCH_TIER);
  assert.equal(lens(tier).show("portrait"), false);
});
