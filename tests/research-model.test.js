import test from "node:test";
import assert from "node:assert/strict";

import {
  GM_TIER,
  MAX_CUSTOM_TIERS,
  NEVER_TIER,
  RESEARCH_SKILLS,
  RESEARCH_TIERS,
  clampTier,
  defaultBlockTiers,
  isBlockVisible,
  isItemVisible,
  itemTierKey,
  normalizeResearchTiers,
  planTierRemapping,
  remapTierMap,
  remapTierValue,
  requiredTierForItem,
  resolveAvailableResearchSkills,
  resolveBlockTiers,
  resolveCreatureResearch,
  suggestResearchDc,
  suggestResearchSkill,
} from "../scripts/core/research-model.js";

test("tiers are clamped into the selectable range", () => {
  assert.equal(clampTier(-5), 0);
  assert.equal(clampTier(2), 2);
  assert.equal(clampTier(5, 0, 3), 3);
  assert.equal(clampTier(5, 0, 5), 5);
  assert.equal(clampTier(GM_TIER), NEVER_TIER);
  assert.equal(clampTier("not a number", 1), 1);
});

test("normalizeResearchTiers validates custom tiers, deduplicates ids, and caps max count", () => {
  assert.equal(normalizeResearchTiers(null).length, RESEARCH_TIERS.length);
  assert.equal(normalizeResearchTiers([{ id: "only-one" }]).length, RESEARCH_TIERS.length);

  const many = Array.from({ length: MAX_CUSTOM_TIERS + 3 }, (_, i) => ({
    id: i === 0 ? "unknown" : "dup",
    label: `Tier ${i}`,
    icon: "bad icon!",
    color: i === 4 ? "arcane" : "invalid",
  }));
  const normalized = normalizeResearchTiers(many);
  assert.equal(normalized.length, MAX_CUSTOM_TIERS);
  assert.equal(new Set(normalized.map((t) => t.id)).size, MAX_CUSTOM_TIERS);
  assert.equal(normalized[4].color, "arcane");
  assert.ok(normalized[4].icon.startsWith("fa-"));
  assert.deepEqual(
    normalized.map((t) => t.value),
    Array.from({ length: MAX_CUSTOM_TIERS }, (_, i) => i),
  );
});

test("planTierRemapping shifts thresholds and knowledge across insertions, deletions, and reordering", () => {
  const base = RESEARCH_TIERS;
  const inserted = [
    base[0],
    { id: "sightings", label: "Sightings", hint: "", icon: "fa-eye", color: "frost" },
    base[1],
    base[2],
    base[3],
  ];
  const insertPlan = planTierRemapping(base, inserted);
  assert.equal(insertPlan.changed, true);
  assert.equal(insertPlan.maxNewTier, 4);
  assert.equal(remapTierValue(0, insertPlan.valueMap, insertPlan.maxNewTier), 0);
  assert.equal(remapTierValue(1, insertPlan.valueMap, insertPlan.maxNewTier), 2);
  assert.equal(remapTierValue(2, insertPlan.valueMap, insertPlan.maxNewTier), 3);
  assert.equal(remapTierValue(3, insertPlan.valueMap, insertPlan.maxNewTier), 4);
  assert.equal(remapTierValue(NEVER_TIER, insertPlan.valueMap, insertPlan.maxNewTier), NEVER_TIER);

  // Deleting studied (index 2 in base) falls back to rumors (index 1) and shifts mastered (3 -> 2)
  const deleted = [base[0], base[1], base[3]];
  const deletePlan = planTierRemapping(base, deleted);
  assert.deepEqual(
    remapTierMap({ name: 1, ac: 2, bio: 3, secret: NEVER_TIER }, deletePlan.valueMap, deletePlan.maxNewTier),
    { name: 1, ac: 1, bio: 2, secret: NEVER_TIER },
  );
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

test("a creature in several collections is researched at the lowest DC with every allowed skill", () => {
  const creature = { cr: 4, creatureTypeKey: "beast" };
  const config = resolveCreatureResearch(
    [{ research: { dc: 18, skills: ["arc"] } }, { research: { dc: 12, skills: [] } }],
    creature,
  );
  assert.equal(config.dc, 12);
  assert.equal(config.isDcExplicit, true);
  assert.deepEqual(config.skills, ["arc", "nat"]);
  assert.equal(config.isSkillsExplicit, false, "the derived skill would give the type away");
});

test("an automatic DC can be the lowest, and then it is not the GM's", () => {
  const config = resolveCreatureResearch([{ research: { dc: 20 } }, { research: {} }], { cr: 1 });
  assert.equal(config.dc, suggestResearchDc(1));
  assert.equal(config.isDcExplicit, false);
});

test("skills count as the GM's only when every collection sets them", () => {
  const config = resolveCreatureResearch(
    [{ research: { skills: ["arc"] } }, { research: { skills: ["his"] } }],
    {},
  );
  assert.deepEqual(config.skills, ["arc", "his"]);
  assert.equal(config.isSkillsExplicit, true);
});

test("resolveAvailableResearchSkills adds unique non-standard custom skills after built-ins", () => {
  const skills = resolveAvailableResearchSkills(["ste", "mec", "", "sci", "nat", "mec", null]);
  assert.deepEqual(skills, [...RESEARCH_SKILLS, "mec", "sci"]);
});

test("custom entry skills apply only when included in allowedSkills", () => {
  const entry = { research: { skills: ["mec", "sci"] } };
  const creature = { creatureTypeKey: "construct" };
  const disabled = resolveCreatureResearch([entry], creature);
  assert.deepEqual(disabled.skills, ["arc"]);
  assert.equal(disabled.isSkillsExplicit, false);

  const enabled = resolveCreatureResearch([entry], creature, {
    allowedSkills: [...RESEARCH_SKILLS, "mec", "sci"],
  });
  assert.deepEqual(enabled.skills, ["mec", "sci"]);
  assert.equal(enabled.isSkillsExplicit, true);
});
