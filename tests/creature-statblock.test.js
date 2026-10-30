import test from "node:test";
import assert from "node:assert/strict";

import { buildStatblock } from "../scripts/ui/creature-statblock.js";
import { createKnowledgeLens } from "../scripts/core/knowledge-lens.js";
import { GM_TIER, NEVER_TIER } from "../scripts/core/research-model.js";

globalThis.game = {
  settings: { get: () => ({}) },
  i18n: { localize: key => key, has: () => false, format: key => key }
};
globalThis.CONFIG = { DND5E: {} };

const creatureData = {
  id: "grim",
  uuid: "Actor.grim",
  name: "Grimgnaw",
  img: "art/grimgnaw.webp",
  prototypeToken: "art/grimgnaw-token.webp",
  size: "Gargantuan",
  creatureType: "Fiend",
  creatureSubtype: "Demon",
  creatureTypeKey: "fiend",
  alignment: "Chaotic Evil",
  cr: 17,
  xp: 18000,
  ac: { value: 19, label: "Natural Armor" },
  hp: { value: 250, max: 250, formula: "20d20+40" },
  speeds: { walk: 40 },
  speedUnits: "ft",
  movementTraits: ["Hover"],
  abilities: {
    str: { label: "Strength", value: 26, mod: 8, save: 14 },
    cha: { label: "Charisma", value: 22, mod: 6, save: 12 }
  },
  skills: { prc: { label: "Perception", total: 13 } },
  senses: { darkvision: 120 },
  senseUnits: "ft",
  languages: ["Abyssal"],
  resistances: ["Cold"],
  immunities: ["Fire"],
  vulnerabilities: ["Radiant"],
  conditionImmunities: ["Poisoned"],
  damageModifications: [{ text: "Slashing −5", amount: -5 }],
  features: [{ id: "magres", name: "Magic Resistance" }],
  actions: [{ id: "bite", name: "Bite" }, { id: "claw", name: "Claw" }],
  biography: "Born in the Abyss",
  secretField: "LEAKED-FIELD"
};
const SECRETS = [
  "Grimgnaw", "grimgnaw", "Gargantuan", "Fiend", "fiend", "Demon", "Chaotic Evil", "18000", "Natural Armor",
  "250", "20d20+40", "Hover", "Strength", "Charisma", "Perception", "120", "Abyssal", "Cold", "Fire", "Radiant",
  "Poisoned", "Slashing", "Magic Resistance", "Bite", "Claw", "Abyss", "LEAKED-FIELD"
];
const expanded = { sections: new Set(), items: new Set() };
const build = (tier, entry = {}, isGM = false) => buildStatblock(
  creatureData,
  createKnowledgeLens({ tier, worldTiers: {}, entries: [entry] }),
  { image: {}, ...entry },
  { isGM, expanded }
);

test("a creature the viewer does not know reveals nothing anywhere in the card", () => {
  const page = JSON.stringify(build(0));
  for (const secret of SECRETS) assert.ok(!page.includes(secret), `"${secret}" leaked into the card`);
});

test("rumours give the name and the type, not the statistics", () => {
  const card = build(1);
  assert.equal(card.creature.displayName, "Grimgnaw");
  assert.match(card.creature.typeLabel, /Fiend/);
  assert.equal(card.creature.crFormatted, "");
  assert.equal(card.creature.hp, undefined);
  assert.ok(!JSON.stringify(card).includes("20d20+40"));
});

test("a hidden ability group hides every ability under it", () => {
  const card = build(2, { blockTiers: { abilities: 3, str: 1 } });
  assert.deepEqual(card.abilityEntries, []);
  assert.ok(!JSON.stringify(card).includes("Strength"));
});

test("an item pinned to a higher tier stays hidden while the rest of its block shows", () => {
  const card = build(2, { itemTiers: { "actions:bite": 3 } });
  const actions = card.contentSections.find(section => section.key === "actions");
  assert.deepEqual(actions.items.map(item => item.name), ["Claw"]);
  assert.ok(!JSON.stringify(card).includes("Bite"));
});

test("the GM gets everything, hidden content marked as hidden for players", () => {
  const card = build(GM_TIER, { blockTiers: { biography: NEVER_TIER }, itemTiers: { "actions:bite": NEVER_TIER } }, true);
  assert.equal(card.creature.hp.formula, "20d20+40");
  const actions = card.contentSections.find(section => section.key === "actions");
  assert.equal(actions.items.find(item => item.name === "Bite").hiddenForPlayers, true);
  assert.equal(card.contentSections.find(section => section.key === "biography").blockHiddenForPlayers, true);
});

test("a field no block reveals never reaches the card, not even the GM's", () => {
  assert.ok(!JSON.stringify(build(3)).includes("LEAKED-FIELD"));
  assert.ok(!JSON.stringify(build(GM_TIER, {}, true)).includes("LEAKED-FIELD"));
});
