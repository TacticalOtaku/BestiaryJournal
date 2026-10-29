import {
  DISPLAY_BLOCKS,
  DISPLAY_GROUPS,
  NEVER_TIER,
  TIER_CHOICES,
  clampTier,
  getTierDefinition,
  resolveBlockTiers
} from "../core/research-model.js";
import { createKnowledgeLens, playerEntryContexts, viewerTier } from "../core/knowledge-lens.js";
import { getPlayerUsers, localize } from "./foundry-runtime.js";

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

/** What `viewer` knows about a creature; `data` and `knowledge` are the caller's snapshot of the world. */
export function knowledgeLensFor({ data, knowledge }, viewer, uuid) {
  return createKnowledgeLens({
    tier: viewerTier(knowledge, viewer, uuid, viewer?.isParty ? getPlayerUsers() : []),
    worldTiers: getWorldBlockTiers(),
    entries: playerEntryContexts(data, uuid).map(({ entry }) => entry)
  });
}

/**
 * The GM's tier editor for one collection entry. Players get the lowest threshold of every collection they
 * see (docs/adr/0001), so a block another collection opens earlier names that collection.
 */
export function buildEntryTierMatrix(data, uuid, sectionId, entry) {
  const world = getWorldBlockTiers();
  const own = resolveBlockTiers(world, entry?.blockTiers);
  const others = playerEntryContexts(data, uuid)
    .filter(({ section }) => section.id !== sectionId)
    .map(({ section, entry: other }) => ({ name: section.name, tiers: resolveBlockTiers(world, other.blockTiers) }));
  const openedIn = key => others.reduce(
    (lowest, other) => (other.tiers[key] < (lowest?.tiers[key] ?? own[key]) ? other : lowest),
    null
  )?.name ?? "";
  return buildTierMatrix(own, entry?.blockTiers, null, openedIn);
}

export function localizedTierChoices(selected, { includeNever = true, includeInherit = false } = {}) {
  const choices = [];
  // Number("") and Number(null) are 0: without this guard "inherit" would also mark "Unknown" as chosen.
  const isUnset = selected === "" || selected === null || selected === undefined;
  if (includeInherit) {
    choices.push({
      value: "",
      label: localize("BESTIARY.Tier.Inherit"),
      icon: "fa-link",
      selected: isUnset
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
      selected: !isUnset && Number(selected) === choice.value
    });
  }
  return choices;
}

/**
 * View model for the tier editor: every block grouped, with its effective
 * threshold and whether the creature overrides the world default.
 */
export function buildTierMatrix(effectiveTiers, entryOverrides = {}, baseTiers = null, openedIn = () => "") {
  const base = baseTiers ?? resolveBlockTiers(getWorldBlockTiers(), null);
  return DISPLAY_GROUPS.map(group => {
    const blocks = DISPLAY_BLOCKS
      .filter(block => block.group === group.key)
      .map(block => {
        const tier = clampTier(effectiveTiers?.[block.key], block.tier);
        const definition = getTierDefinition(tier);
        const openedElsewhere = openedIn(block.key);
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
          choices: localizedTierChoices(tier),
          openedElsewhere: openedElsewhere
            ? game.i18n.format("BESTIARY.Tier.OpenedElsewhere", { collection: openedElsewhere })
            : ""
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
