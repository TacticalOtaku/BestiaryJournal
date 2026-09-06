import test from "node:test";
import assert from "node:assert/strict";

import {
  GM_TIER,
  NEVER_TIER,
  clampTier,
  defaultBlockTiers,
  isBlockVisible,
  isItemVisible,
  itemTierKey,
  requiredTierForItem,
  resolveBlockTiers,
  suggestResearchDc,
  suggestResearchSkill
} from "../scripts/research-model.mjs";

test("tiers are clamped into the selectable range", () => {
  assert.equal(clampTier(-5), 0);
  assert.equal(clampTier(2), 2);
  assert.equal(clampTier(99), NEVER_TIER);
  assert.equal(clampTier("not a number", 1), 1);
});

test("world settings layer under per-creature overrides", () => {
  const tiers = resolveBlockTiers({ hp: 1, bogus: 2 }, { hp: 3 });
  assert.equal(tiers.hp, 3);
  assert.equal(tiers.ac, defaultBlockTiers().ac);
  assert.equal("bogus" in tiers, false, "unknown keys are dropped");
});

test("blocks unlock at their configured tier and never below it", () => {
  const tiers = resolveBlockTiers(null, { actions: 2 });
  assert.equal(isBlockVisible("actions", 1, tiers), false);
  assert.equal(isBlockVisible("actions", 2, tiers), true);
  assert.equal(isBlockVisible("actions", 3, tiers), true);
});

test("a GM-only block stays hidden at the highest player tier", () => {
  const tiers = resolveBlockTiers(null, { biography: NEVER_TIER });
  assert.equal(isBlockVisible("biography", 3, tiers), false);
  assert.equal(isBlockVisible("biography", GM_TIER, tiers), true);
});

test("ability sub-blocks cannot outrank their parent", () => {
  const tiers = resolveBlockTiers(null, { abilities: NEVER_TIER, str: 1 });
  assert.equal(isBlockVisible("str", 3, tiers), false);
});

test("items inherit their block tier until one is pinned", () => {
  const tiers = resolveBlockTiers(null, { actions: 2 });
  const itemTiers = { [itemTierKey("actions", "bite")]: 3 };

  assert.equal(requiredTierForItem("actions", "claw", tiers, itemTiers), 2);
  assert.equal(requiredTierForItem("actions", "bite", tiers, itemTiers), 3);

  assert.equal(isItemVisible("actions", "claw", 2, tiers, itemTiers), true);
  assert.equal(isItemVisible("actions", "bite", 2, tiers, itemTiers), false);
  assert.equal(isItemVisible("actions", "bite", 3, tiers, itemTiers), true);
});

test("an item pinned to GM-only is hidden even when its block is open", () => {
  const tiers = resolveBlockTiers(null, { actions: 1 });
  const itemTiers = { [itemTierKey("actions", "secret")]: NEVER_TIER };
  assert.equal(isItemVisible("actions", "secret", 3, tiers, itemTiers), false);
  assert.equal(isItemVisible("actions", "secret", GM_TIER, tiers, itemTiers), true);
});

test("a hidden block hides its items regardless of their own tier", () => {
  const tiers = resolveBlockTiers(null, { actions: 3 });
  const itemTiers = { [itemTierKey("actions", "claw")]: 1 };
  assert.equal(isItemVisible("actions", "claw", 2, tiers, itemTiers), false);
});

test("suggested DC scales with challenge rating and stays bounded", () => {
  assert.equal(suggestResearchDc(0), 10);
  assert.equal(suggestResearchDc(1), 11);
  assert.equal(suggestResearchDc(10), 15);
  assert.equal(suggestResearchDc(999), 25);
});

test("suggested skill follows the creature type", () => {
  assert.equal(suggestResearchSkill("beast"), "nat");
  assert.equal(suggestResearchSkill("undead"), "rel");
  assert.equal(suggestResearchSkill("dragon"), "arc");
  assert.equal(suggestResearchSkill("unheard-of"), "nat");
});
