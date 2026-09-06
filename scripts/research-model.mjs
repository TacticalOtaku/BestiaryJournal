/**
 * Pure research-tier model. No Foundry globals here so the rules stay testable.
 *
 * Knowledge of a creature is a tier from 0 (nothing) to 3 (complete). Every card
 * block declares the tier at which it unlocks; NEVER_TIER keeps a block for the
 * GM only. Individual actions and features may override their block.
 */

export const MIN_RESEARCH_TIER = 0;
export const MAX_RESEARCH_TIER = 3;
export const NEVER_TIER = 4;
export const GM_TIER = 99;

export const RESEARCH_TIERS = Object.freeze([
  { value: 0, key: "unknown", label: "BESTIARY.Tier.Unknown", hint: "BESTIARY.Tier.UnknownHint", icon: "fa-circle-question" },
  { value: 1, key: "rumors", label: "BESTIARY.Tier.Rumors", hint: "BESTIARY.Tier.RumorsHint", icon: "fa-comments" },
  { value: 2, key: "studied", label: "BESTIARY.Tier.Studied", hint: "BESTIARY.Tier.StudiedHint", icon: "fa-book-open" },
  { value: 3, key: "mastered", label: "BESTIARY.Tier.Mastered", hint: "BESTIARY.Tier.MasteredHint", icon: "fa-crown" }
]);

/** Selectable values in every tier picker, including the GM-only option. */
export const TIER_CHOICES = Object.freeze([
  ...RESEARCH_TIERS,
  { value: NEVER_TIER, key: "never", label: "BESTIARY.Tier.Never", hint: "BESTIARY.Tier.NeverHint", icon: "fa-eye-slash" }
]);

/**
 * Every block that can be revealed on a creature card. `tier` is the built-in
 * default; worlds and single creatures may override it.
 */
export const DISPLAY_BLOCKS = Object.freeze([
  { key: "portrait", label: "BESTIARY.Block.Portrait", group: "identity", tier: 1 },
  { key: "name", label: "BESTIARY.Block.Name", group: "identity", tier: 1 },
  { key: "type", label: "BESTIARY.Block.Type", group: "identity", tier: 1 },
  { key: "alignment", label: "BESTIARY.Block.Alignment", group: "identity", tier: 3 },

  { key: "ac", label: "BESTIARY.Block.AC", group: "vitals", tier: 2 },
  { key: "hp", label: "BESTIARY.Block.HP", group: "vitals", tier: 2 },
  { key: "cr", label: "BESTIARY.Block.CR", group: "vitals", tier: 2 },
  { key: "xp", label: "BESTIARY.Block.XP", group: "vitals", tier: 3 },
  { key: "speed", label: "BESTIARY.Block.Speed", group: "vitals", tier: 2 },

  { key: "abilities", label: "BESTIARY.Abilities", group: "core", tier: 2 },
  { key: "str", label: "BESTIARY.Data.Abilities.str", group: "core", parent: "abilities", tier: 2 },
  { key: "dex", label: "BESTIARY.Data.Abilities.dex", group: "core", parent: "abilities", tier: 2 },
  { key: "con", label: "BESTIARY.Data.Abilities.con", group: "core", parent: "abilities", tier: 2 },
  { key: "int", label: "BESTIARY.Data.Abilities.int", group: "core", parent: "abilities", tier: 2 },
  { key: "wis", label: "BESTIARY.Data.Abilities.wis", group: "core", parent: "abilities", tier: 2 },
  { key: "cha", label: "BESTIARY.Data.Abilities.cha", group: "core", parent: "abilities", tier: 2 },
  { key: "skills", label: "BESTIARY.Skills", group: "core", tier: 2 },

  { key: "senses", label: "BESTIARY.Senses", group: "perception", tier: 2 },
  { key: "languages", label: "BESTIARY.Languages", group: "perception", tier: 2 },

  { key: "resistances", label: "BESTIARY.Resistances", group: "defense", tier: 2 },
  { key: "immunities", label: "BESTIARY.Immunities", group: "defense", tier: 3 },
  { key: "vulnerabilities", label: "BESTIARY.Vulnerabilities", group: "defense", tier: 3 },
  { key: "conditionImmunities", label: "BESTIARY.ConditionImmunities", group: "defense", tier: 3 },

  { key: "features", label: "BESTIARY.Features", group: "combat", tier: 2 },
  { key: "actions", label: "BESTIARY.Actions", group: "combat", tier: 2 },
  { key: "bonusActions", label: "BESTIARY.BonusActions", group: "combat", tier: 3 },
  { key: "reactions", label: "BESTIARY.Reactions", group: "combat", tier: 3 },
  { key: "legendaryActions", label: "BESTIARY.LegendaryActions", group: "combat", tier: 3 },

  { key: "spells", label: "BESTIARY.Spellcasting", group: "resources", tier: 3 },
  { key: "inventory", label: "BESTIARY.Inventory", group: "resources", tier: 3 },

  { key: "biography", label: "BESTIARY.Biography", group: "lore", tier: 3 }
]);

export const DISPLAY_GROUPS = Object.freeze([
  { key: "identity", label: "BESTIARY.Group.Identity", hint: "BESTIARY.Group.IdentityHint", icon: "fa-id-card" },
  { key: "vitals", label: "BESTIARY.Group.Vitals", hint: "BESTIARY.Group.VitalsHint", icon: "fa-heart-pulse" },
  { key: "core", label: "BESTIARY.Group.Core", hint: "BESTIARY.Group.CoreHint", icon: "fa-dumbbell" },
  { key: "perception", label: "BESTIARY.Group.Perception", hint: "BESTIARY.Group.PerceptionHint", icon: "fa-eye" },
  { key: "defense", label: "BESTIARY.Group.Defense", hint: "BESTIARY.Group.DefenseHint", icon: "fa-shield-halved" },
  { key: "combat", label: "BESTIARY.Group.Combat", hint: "BESTIARY.Group.CombatHint", icon: "fa-khanda" },
  { key: "resources", label: "BESTIARY.Group.Resources", hint: "BESTIARY.Group.ResourcesHint", icon: "fa-bag-shopping" },
  { key: "lore", label: "BESTIARY.Group.Lore", hint: "BESTIARY.Group.LoreHint", icon: "fa-feather-pointed" }
]);

export const BLOCK_KEYS = Object.freeze(DISPLAY_BLOCKS.map(block => block.key));

/** Blocks holding a list of items whose visibility can be tuned one by one. */
export const ITEM_BLOCK_KEYS = Object.freeze([
  "features", "actions", "bonusActions", "reactions",
  "legendaryActions", "spells", "inventory"
]);

const BLOCK_BY_KEY = new Map(DISPLAY_BLOCKS.map(block => [block.key, block]));

export function getBlockDefinition(key) {
  return BLOCK_BY_KEY.get(key) ?? null;
}

export function defaultBlockTiers() {
  return Object.fromEntries(DISPLAY_BLOCKS.map(block => [block.key, block.tier]));
}

export function clampTier(value, fallback = MIN_RESEARCH_TIER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  if (rounded <= MIN_RESEARCH_TIER) return MIN_RESEARCH_TIER;
  if (rounded >= NEVER_TIER) return NEVER_TIER;
  return rounded;
}

export function clampKnownTier(value, fallback = MIN_RESEARCH_TIER) {
  return Math.min(clampTier(value, fallback), MAX_RESEARCH_TIER);
}

export function isGmTier(tier) {
  return Number(tier) >= GM_TIER;
}

export function getTierDefinition(tier) {
  if (isGmTier(tier)) return TIER_CHOICES[TIER_CHOICES.length - 1];
  return TIER_CHOICES.find(choice => choice.value === clampTier(tier)) ?? RESEARCH_TIERS[0];
}

/**
 * Layers world defaults over the built-ins, then the per-creature overrides.
 * Unknown block keys are dropped so stale settings cannot leak into the view.
 */
export function resolveBlockTiers(worldTiers, entryTiers) {
  const resolved = defaultBlockTiers();
  for (const source of [worldTiers, entryTiers]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (!BLOCK_BY_KEY.has(key)) continue;
      resolved[key] = clampTier(value, resolved[key]);
    }
  }
  return resolved;
}

/** Ability sub-blocks can never outrank their parent group. */
export function isBlockVisible(blockKey, viewerTier, blockTiers) {
  if (isGmTier(viewerTier)) return true;
  const definition = BLOCK_BY_KEY.get(blockKey);
  if (!definition) return false;
  const required = blockTiers?.[blockKey] ?? definition.tier;
  if (required >= NEVER_TIER) return false;
  if (definition.parent && !isBlockVisible(definition.parent, viewerTier, blockTiers)) return false;
  return clampKnownTier(viewerTier) >= required;
}

export function requiredTierForBlock(blockKey, blockTiers) {
  const definition = BLOCK_BY_KEY.get(blockKey);
  if (!definition) return NEVER_TIER;
  return blockTiers?.[blockKey] ?? definition.tier;
}

/**
 * Items inherit their block's tier unless the GM pinned an explicit one.
 * Keys are "<blockKey>:<itemId>" so the same id in two blocks cannot collide.
 */
export function itemTierKey(blockKey, itemId) {
  return `${blockKey}:${itemId}`;
}

export function requiredTierForItem(blockKey, itemId, blockTiers, itemTiers) {
  const fallback = requiredTierForBlock(blockKey, blockTiers);
  const override = itemTiers?.[itemTierKey(blockKey, itemId)];
  if (override === null || override === undefined || override === "") return fallback;
  return clampTier(override, fallback);
}

export function isItemVisible(blockKey, itemId, viewerTier, blockTiers, itemTiers) {
  if (isGmTier(viewerTier)) return true;
  if (!isBlockVisible(blockKey, viewerTier, blockTiers)) return false;
  const required = requiredTierForItem(blockKey, itemId, blockTiers, itemTiers);
  if (required >= NEVER_TIER) return false;
  return clampKnownTier(viewerTier) >= required;
}

/** Default investigation skill, guessed from the creature type. */
const TYPE_SKILL = {
  beast: "nat", plant: "nat", monstrosity: "nat", ooze: "nat",
  aberration: "arc", construct: "arc", dragon: "arc", elemental: "arc",
  fey: "arc", giant: "arc",
  celestial: "rel", fiend: "rel", undead: "rel",
  humanoid: "his"
};

export const RESEARCH_SKILLS = Object.freeze(["nat", "arc", "rel", "his", "inv", "sur", "med"]);

export function suggestResearchSkill(creatureTypeKey) {
  return TYPE_SKILL[creatureTypeKey] ?? "nat";
}

/** Mirrors the classic monster-knowledge table: harder creature, harder DC. */
export function suggestResearchDc(cr) {
  const numeric = Number(cr);
  if (!Number.isFinite(numeric) || numeric <= 0) return 10;
  return Math.min(25, 10 + Math.ceil(numeric / 2));
}
