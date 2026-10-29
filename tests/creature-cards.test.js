import test from "node:test";
import assert from "node:assert/strict";

import { buildCreatureCard } from "../scripts/ui/creature-cards.js";

globalThis.game = {
  settings: { get: () => ({}) },
  i18n: { localize: key => key, has: () => false }
};
globalThis.CONFIG = { DND5E: {} };

const creature = {
  name: "Grimgnaw",
  img: "art/grimgnaw.webp",
  prototypeToken: "art/grimgnaw-token.webp",
  creatureType: "Fiend",
  creatureTypeKey: "fiend",
  size: "Gargantuan",
  cr: 17,
  ac: { value: 19 },
  hp: { value: 250, max: 250 },
  speeds: { walk: 40 }
};
const entry = { uuid: "Actor.grim", image: {}, blockTiers: {} };

test("a creature the viewer does not know reveals nothing anywhere in its card", () => {
  const card = buildCreatureCard({ uuid: "Actor.grim", entry, creature, viewerTier: 0 });
  // Every field reaches the page somewhere: text, data attributes for search, sort and filters.
  const page = JSON.stringify(card);
  for (const secret of ["Grimgnaw", "grimgnaw", "Fiend", "fiend", "Gargantuan", "17", "19", "250", "40"]) {
    assert.ok(!page.includes(secret), `"${secret}" leaked into the card`);
  }
  assert.equal(card.image.isSilhouette, true);
  assert.equal(card.knowsName, false);
});

test("each block opens at its own tier", () => {
  const card = buildCreatureCard({ uuid: "Actor.grim", entry, creature, viewerTier: 1 });
  assert.equal(card.name, "Grimgnaw");
  assert.equal(card.typeKey, "fiend");
  assert.equal(card.cr, "", "CR stays hidden until tier 2");
  assert.ok(!card.searchText.includes("17"));
});

test("a deleted actor keeps its name for the GM but shows no statistics", () => {
  const card = buildCreatureCard({ uuid: "Actor.gone", entry: { ...entry, label: "QA Ghost" }, creature: null, viewerTier: 99 });
  assert.equal(card.name, "QA Ghost");
  assert.equal(card.isMissing, true);
  assert.equal(card.knowsCr, false, "no «CR 0» for an actor that is gone");
  assert.equal(card.showAc, false);
  assert.equal(card.hp, null);
});
