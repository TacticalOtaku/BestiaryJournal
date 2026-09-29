import {
  DISPLAY_BLOCKS,
  DISPLAY_GROUPS,
  NEVER_TIER,
  TIER_CHOICES,
  clampTier,
  defaultBlockTiers,
  getBlockDefinition,
  getTierDefinition,
  resolveBlockTiers
} from "../core/research-model.js";
import { localize } from "./foundry-runtime.js";

const MODULE_ID = "bestiary-journal";

/** World-wide reveal thresholds, layered on top of the built-in defaults. */
export function getWorldBlockTiers() {
  const stored = game.settings.get(MODULE_ID, "tierBlockConfig");
  return stored && typeof stored === "object" ? stored : {};
}

export async function setWorldBlockTiers(tiers) {
  if (!game.user.isGM) return false;
  const cleaned = {};
  for (const block of DISPLAY_BLOCKS) {
    if (!(block.key in (tiers ?? {}))) continue;
    cleaned[block.key] = clampTier(tiers[block.key], block.tier);
  }
  await game.settings.set(MODULE_ID, "tierBlockConfig", cleaned);
  return true;
}

/** Effective thresholds for one creature: built-ins → world → entry override. */
export function getEntryBlockTiers(entry) {
  return resolveBlockTiers(getWorldBlockTiers(), entry?.blockTiers);
}

export function getDefaultBlockTiers() {
  return defaultBlockTiers();
}

export function localizedTierChoices(selected, { includeNever = true, includeInherit = false } = {}) {
  const choices = [];
  if (includeInherit) {
    choices.push({
      value: "",
      label: localize("BESTIARY.Tier.Inherit"),
      icon: "fa-link",
      selected: selected === "" || selected === null || selected === undefined
    });
  }
  for (const choice of TIER_CHOICES) {
    if (!includeNever && choice.value === NEVER_TIER) continue;
    choices.push({
      value: choice.value,
      key: choice.key,
      label: localize(choice.label),
      hint: localize(choice.hint),
      icon: choice.icon,
      selected: Number(selected) === choice.value
    });
  }
  return choices;
}

/**
 * View model for the tier editor: every block grouped, with its effective
 * threshold and whether the creature overrides the world default.
 */
export function buildTierMatrix(effectiveTiers, entryOverrides = {}, baseTiers = null) {
  const base = baseTiers ?? resolveBlockTiers(getWorldBlockTiers(), null);
  return DISPLAY_GROUPS.map(group => {
    const blocks = DISPLAY_BLOCKS
      .filter(block => block.group === group.key)
      .map(block => {
        const tier = clampTier(effectiveTiers?.[block.key], block.tier);
        const definition = getTierDefinition(tier);
        return {
          key: block.key,
          label: localize(block.label) || block.label,
          isChild: !!block.parent,
          parent: block.parent ?? null,
          tier,
          tierKey: definition.key,
          tierLabel: localize(definition.label),
          isNever: tier >= NEVER_TIER,
          isOverridden: Object.prototype.hasOwnProperty.call(entryOverrides ?? {}, block.key)
            && clampTier(entryOverrides[block.key], block.tier) !== clampTier(base[block.key], block.tier),
          choices: localizedTierChoices(tier)
        };
      });
    return {
      key: group.key,
      label: localize(group.label),
      hint: localize(group.hint),
      icon: group.icon,
      blocks,
      hiddenCount: blocks.filter(block => block.isNever).length,
      overrideCount: blocks.filter(block => block.isOverridden).length
    };
  }).filter(group => group.blocks.length);
}

export function blockLabel(key) {
  const definition = getBlockDefinition(key);
  return definition ? localize(definition.label) || definition.label : key;
}
