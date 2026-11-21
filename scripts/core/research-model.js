/**
 * Pure research-tier model. No Foundry globals here so the rules stay testable.
 *
 * Knowledge of a creature is an integer tier from 0 (nothing) to maxTier
 * (default 3, configurable per world up to MAX_CUSTOM_TIERS - 1). Every card
 * block declares the tier at which it unlocks; NEVER_TIER keeps a block for the
 * GM only. Individual actions and features may override their block.
 */

export const MIN_RESEARCH_TIER = 0;
export const MAX_RESEARCH_TIER = 3;
export const LEGACY_NEVER_TIER = 4;
export const NEVER_TIER = 100;
export const GM_TIER = 999;
export const MAX_CUSTOM_TIERS = 10;

export const TIER_COLORS = Object.freeze([
  "unknown",
  "rumors",
  "studied",
  "mastered",
  "embers",
  "arcane",
  "forest",
  "frost",
  "rose",
  "crimson",
]);

export const TIER_ICONS = Object.freeze([
  "fa-circle-question",
  "fa-comments",
  "fa-book-open",
  "fa-crown",
  "fa-eye",
  "fa-magnifying-glass",
  "fa-feather-pointed",
  "fa-scroll",
  "fa-flask",
  "fa-shield-halved",
  "fa-skull",
  "fa-compass",
  "fa-star",
  "fa-brain",
]);

export const RESEARCH_TIERS = Object.freeze([
  {
    value: 0,
    id: "unknown",
    key: "unknown",
    label: "BESTIARY.Tier.Unknown",
    hint: "BESTIARY.Tier.UnknownHint",
    icon: "fa-circle-question",
    color: "unknown",
  },
  {
    value: 1,
    id: "rumors",
    key: "rumors",
    label: "BESTIARY.Tier.Rumors",
    hint: "BESTIARY.Tier.RumorsHint",
    icon: "fa-comments",
    color: "rumors",
  },
  {
    value: 2,
    id: "studied",
    key: "studied",
    label: "BESTIARY.Tier.Studied",
    hint: "BESTIARY.Tier.StudiedHint",
    icon: "fa-book-open",
    color: "studied",
  },
  {
    value: 3,
    id: "mastered",
    key: "mastered",
    label: "BESTIARY.Tier.Mastered",
    hint: "BESTIARY.Tier.MasteredHint",
    icon: "fa-crown",
    color: "mastered",
  },
]);

export const NEVER_TIER_DEF = Object.freeze({
  value: NEVER_TIER,
  id: "never",
  key: "never",
  label: "BESTIARY.Tier.Never",
  hint: "BESTIARY.Tier.NeverHint",
  icon: "fa-eye-slash",
  color: "never",
});

/** Selectable values in every tier picker for the built-in ladder, including the GM-only option. */
export const TIER_CHOICES = Object.freeze([...RESEARCH_TIERS, NEVER_TIER_DEF]);

export function defaultResearchTiers() {
  return RESEARCH_TIERS.map((tier) => ({ ...tier }));
}

export function maxResearchTier(tiers = RESEARCH_TIERS) {
  const count = Array.isArray(tiers) && tiers.length >= 2 ? tiers.length : RESEARCH_TIERS.length;
  return Math.max(1, count - 1);
}

const DEFAULT_BY_ID = new Map(RESEARCH_TIERS.map((tier) => [tier.id, tier]));
const TIER_COLOR_SET = new Set(TIER_COLORS);
const SAFE_ICON_PATTERN = /^fa-[a-z0-9-]+$/;

/**
 * Sanitizes a world's configured research tier ladder so index 0 stays the base
 * state, at least one learnable tier exists, ids are unique, and colors/icons
 * belong to the verified theme palette.
 */
export function normalizeResearchTiers(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return defaultResearchTiers();

  const seenIds = new Set();
  const normalized = [];
  for (const [index, item] of raw.slice(0, MAX_CUSTOM_TIERS).entries()) {
    const source = item && typeof item === "object" ? item : {};
    let id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id || seenIds.has(id)) id = `tier_${index}`;
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);

    const defaults = DEFAULT_BY_ID.get(id);
    const label =
      typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : (defaults?.label ?? "BESTIARY.Tier.CustomDefault");
    const hint = typeof source.hint === "string" ? source.hint.trim() : (defaults?.hint ?? "");
    const rawIcon = typeof source.icon === "string" ? source.icon.trim() : "";
    const icon = SAFE_ICON_PATTERN.test(rawIcon)
      ? rawIcon
      : (defaults?.icon ?? TIER_ICONS[(index + 3) % TIER_ICONS.length]);
    const color = TIER_COLOR_SET.has(source.color)
      ? source.color
      : (defaults?.color ?? TIER_COLORS[index % TIER_COLORS.length]);
    const key = defaults?.key ?? color;

    normalized.push({
      value: index,
      id,
      key,
      label,
      hint,
      icon,
      color,
    });
  }

  if (normalized.length < 2) return defaultResearchTiers();
  return normalized;
}

export function getTierChoices(tiers = RESEARCH_TIERS) {
  const list = Array.isArray(tiers) && tiers.length >= 2 ? tiers : RESEARCH_TIERS;
  return [...list, NEVER_TIER_DEF];
}

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
  { key: "damageModifications", label: "BESTIARY.DamageModifications", group: "defense", tier: 3 },
  { key: "conditionImmunities", label: "BESTIARY.ConditionImmunities", group: "defense", tier: 3 },

  { key: "features", label: "BESTIARY.Features", group: "combat", tier: 2 },
  { key: "actions", label: "BESTIARY.Actions", group: "combat", tier: 2 },
  { key: "bonusActions", label: "BESTIARY.BonusActions", group: "combat", tier: 3 },
  { key: "reactions", label: "BESTIARY.Reactions", group: "combat", tier: 3 },
  { key: "legendaryActions", label: "BESTIARY.LegendaryActions", group: "combat", tier: 3 },

  { key: "spells", label: "BESTIARY.Spellcasting", group: "resources", tier: 3 },
  { key: "inventory", label: "BESTIARY.Inventory", group: "resources", tier: 3 },

  { key: "biography", label: "BESTIARY.Biography", group: "lore", tier: 3 },
]);

export const DISPLAY_GROUPS = Object.freeze([
  {
    key: "identity",
    label: "BESTIARY.Group.Identity",
    hint: "BESTIARY.Group.IdentityHint",
    icon: "fa-id-card",
  },
  {
    key: "vitals",
    label: "BESTIARY.Group.Vitals",
    hint: "BESTIARY.Group.VitalsHint",
    icon: "fa-heart-pulse",
  },
  { key: "core", label: "BESTIARY.Group.Core", hint: "BESTIARY.Group.CoreHint", icon: "fa-dumbbell" },
  {
    key: "perception",
    label: "BESTIARY.Group.Perception",
    hint: "BESTIARY.Group.PerceptionHint",
    icon: "fa-eye",
  },
  {
    key: "defense",
    label: "BESTIARY.Group.Defense",
    hint: "BESTIARY.Group.DefenseHint",
    icon: "fa-shield-halved",
  },
  { key: "combat", label: "BESTIARY.Group.Combat", hint: "BESTIARY.Group.CombatHint", icon: "fa-khanda" },
  {
    key: "resources",
    label: "BESTIARY.Group.Resources",
    hint: "BESTIARY.Group.ResourcesHint",
    icon: "fa-bag-shopping",
  },
  { key: "lore", label: "BESTIARY.Group.Lore", hint: "BESTIARY.Group.LoreHint", icon: "fa-feather-pointed" },
]);

const BLOCK_BY_KEY = new Map(DISPLAY_BLOCKS.map((block) => [block.key, block]));

export function defaultBlockTiers(maxTier = MAX_RESEARCH_TIER) {
  return Object.fromEntries(DISPLAY_BLOCKS.map((block) => [block.key, Math.min(block.tier, maxTier)]));
}

export function clampTier(value, fallback = MIN_RESEARCH_TIER, maxTier = MAX_RESEARCH_TIER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  if (rounded <= MIN_RESEARCH_TIER) return MIN_RESEARCH_TIER;
  if (rounded >= NEVER_TIER) return NEVER_TIER;
  return Math.min(rounded, Math.max(1, maxTier));
}

export function clampKnownTier(value, fallback = MIN_RESEARCH_TIER, maxTier = MAX_RESEARCH_TIER) {
  return Math.min(clampTier(value, fallback, maxTier), Math.max(1, maxTier));
}

export function isGmTier(tier) {
  return Number(tier) >= GM_TIER;
}

export function getTierDefinition(tier, tiers = RESEARCH_TIERS) {
  if (isGmTier(tier)) return NEVER_TIER_DEF;
  const list = Array.isArray(tiers) && tiers.length >= 2 ? tiers : RESEARCH_TIERS;
  const maxTier = maxResearchTier(list);
  const clamped = clampTier(tier, MIN_RESEARCH_TIER, maxTier);
  if (clamped >= NEVER_TIER) return NEVER_TIER_DEF;
  return list[clamped] ?? list[0];
}

/**
 * Computes how numeric tier values map when the GM inserts, deletes, or
 * reorders tiers in the ladder so existing knowledge and block thresholds follow
 * their intended tiers instead of silently shifting.
 */
export function planTierRemapping(oldTiers, newTiers) {
  const prev = normalizeResearchTiers(oldTiers);
  const next = normalizeResearchTiers(newTiers);
  const nextIndexById = new Map(next.map((tier, index) => [tier.id, index]));
  const valueMap = new Map([[0, 0]]);
  let changed = prev.length !== next.length;

  for (let oldIndex = 1; oldIndex < prev.length; oldIndex += 1) {
    const oldId = prev[oldIndex].id;
    let mapped;
    if (nextIndexById.has(oldId)) {
      mapped = nextIndexById.get(oldId);
    } else {
      mapped = 0;
      for (let fallbackIndex = oldIndex - 1; fallbackIndex >= 1; fallbackIndex -= 1) {
        const candidateId = prev[fallbackIndex].id;
        if (nextIndexById.has(candidateId)) {
          mapped = nextIndexById.get(candidateId);
          break;
        }
      }
    }
    valueMap.set(oldIndex, mapped);
    if (mapped !== oldIndex) changed = true;
  }

  return { valueMap, maxNewTier: maxResearchTier(next), changed };
}

export function remapTierValue(value, valueMap, maxNewTier) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const rounded = Math.round(numeric);
  if (rounded >= NEVER_TIER) return NEVER_TIER;
  if (rounded <= MIN_RESEARCH_TIER) return MIN_RESEARCH_TIER;
  if (valueMap?.has(rounded)) return valueMap.get(rounded);
  return Math.min(rounded, Math.max(1, maxNewTier));
}

export function remapTierMap(tierMap, valueMap, maxNewTier) {
  if (!tierMap || typeof tierMap !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(tierMap)) {
    result[key] = remapTierValue(value, valueMap, maxNewTier);
  }
  return result;
}

/**
 * Layers world defaults over the built-ins, then the per-creature overrides.
 * Unknown block keys are dropped so stale settings cannot leak into the view.
 */
export function resolveBlockTiers(worldTiers, entryTiers, maxTier = MAX_RESEARCH_TIER) {
  const resolved = defaultBlockTiers(maxTier);
  for (const source of [worldTiers, entryTiers]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (!BLOCK_BY_KEY.has(key)) continue;
      resolved[key] = clampTier(value, resolved[key], maxTier);
    }
  }
  return resolved;
}

/** Ability sub-blocks can never outrank their parent group. */
export function isBlockVisible(blockKey, viewerTier, blockTiers, maxTier = MAX_RESEARCH_TIER) {
  if (isGmTier(viewerTier)) return true;
  const definition = BLOCK_BY_KEY.get(blockKey);
  if (!definition) return false;
  const required = blockTiers?.[blockKey] ?? Math.min(definition.tier, maxTier);
  if (required >= NEVER_TIER) return false;
  if (definition.parent && !isBlockVisible(definition.parent, viewerTier, blockTiers, maxTier)) return false;
  return clampKnownTier(viewerTier, MIN_RESEARCH_TIER, maxTier) >= required;
}

export function requiredTierForBlock(blockKey, blockTiers, maxTier = MAX_RESEARCH_TIER) {
  const definition = BLOCK_BY_KEY.get(blockKey);
  if (!definition) return NEVER_TIER;
  return clampTier(blockTiers?.[blockKey], Math.min(definition.tier, maxTier), maxTier);
}

/**
 * Items inherit their block's tier unless the GM pinned an explicit one.
 * Keys are "<blockKey>:<itemId>" so the same id in two blocks cannot collide.
 */
export function itemTierKey(blockKey, itemId) {
  return `${blockKey}:${itemId}`;
}

export function requiredTierForItem(blockKey, itemId, blockTiers, itemTiers, maxTier = MAX_RESEARCH_TIER) {
  const fallback = requiredTierForBlock(blockKey, blockTiers, maxTier);
  const override = itemTiers?.[itemTierKey(blockKey, itemId)];
  if (override === null || override === undefined || override === "") return fallback;
  return clampTier(override, fallback, maxTier);
}

export function isItemVisible(
  blockKey,
  itemId,
  viewerTier,
  blockTiers,
  itemTiers,
  maxTier = MAX_RESEARCH_TIER,
) {
  if (isGmTier(viewerTier)) return true;
  if (!isBlockVisible(blockKey, viewerTier, blockTiers, maxTier)) return false;
  const required = requiredTierForItem(blockKey, itemId, blockTiers, itemTiers, maxTier);
  if (required >= NEVER_TIER) return false;
  return clampKnownTier(viewerTier, MIN_RESEARCH_TIER, maxTier) >= required;
}

/** Default investigation skill, guessed from the creature type. */
const TYPE_SKILL = {
  beast: "nat",
  plant: "nat",
  monstrosity: "nat",
  ooze: "nat",
  aberration: "arc",
  construct: "arc",
  dragon: "arc",
  elemental: "arc",
  fey: "arc",
  giant: "arc",
  celestial: "rel",
  fiend: "rel",
  undead: "rel",
  humanoid: "his",
};

export const STANDARD_DND5E_SKILLS = Object.freeze([
  "acr",
  "ani",
  "arc",
  "ath",
  "dec",
  "his",
  "ins",
  "itm",
  "inv",
  "med",
  "nat",
  "prc",
  "prf",
  "per",
  "rel",
  "slt",
  "ste",
  "sur",
]);

export const RESEARCH_SKILLS = Object.freeze(["nat", "arc", "rel", "his", "inv", "sur", "med", "prc"]);

const STANDARD_SKILL_SET = new Set(STANDARD_DND5E_SKILLS);
const RESEARCH_SKILL_SET = new Set(RESEARCH_SKILLS);

export function isStandardDnd5eSkill(skillId) {
  return STANDARD_SKILL_SET.has(skillId);
}

/** Built-in research skills followed by deduplicated non-standard custom skills. */
export function resolveAvailableResearchSkills(customSkills = []) {
  const result = [...RESEARCH_SKILLS];
  const seen = new Set(RESEARCH_SKILL_SET);
  for (const raw of customSkills ?? []) {
    const skill = typeof raw === "string" ? raw.trim() : "";
    if (!skill || seen.has(skill) || isStandardDnd5eSkill(skill)) continue;
    seen.add(skill);
    result.push(skill);
  }
  return result;
}

export function suggestResearchSkill(creatureTypeKey) {
  return TYPE_SKILL[creatureTypeKey] ?? "nat";
}

/** Mirrors the classic monster-knowledge table: harder creature, harder DC. */
export function suggestResearchDc(cr) {
  const numeric = Number(cr);
  if (!Number.isFinite(numeric) || numeric <= 0) return 10;
  return Math.min(25, 10 + Math.ceil(numeric / 2));
}

/**
 * The identification check for one creature entry: its explicit DC and skills,
 * or the CR-scaled DC and type-appropriate skill when the GM left them unset.
 * Pure, so the authoritative GM and every client compute the same numbers.
 */
export function resolveResearchConfig(entry, creature, { allowedSkills = RESEARCH_SKILLS } = {}) {
  const allowed = allowedSkills instanceof Set ? allowedSkills : new Set(allowedSkills ?? RESEARCH_SKILLS);
  const configured = entry?.research ?? {};
  const explicit = Array.isArray(configured.skills)
    ? configured.skills.filter((skill) => allowed.has(skill))
    : [];
  const skills = explicit.length ? explicit : [suggestResearchSkill(creature?.creatureTypeKey)];
  const hasDc =
    configured.dc !== null &&
    configured.dc !== undefined &&
    configured.dc !== "" &&
    Number.isFinite(Number(configured.dc));
  return {
    dc: hasDc ? Number(configured.dc) : suggestResearchDc(creature?.cr),
    skills,
    isDcExplicit: hasDc,
    isSkillsExplicit: explicit.length > 0,
  };
}

/**
 * The research check of a creature that sits in several collections: the lowest DC and every allowed skill among
 * the entries the player can see (docs/adr/0002). The skills count as set by the GM only when every entry sets
 * them, since a skill derived from the type would give the type away.
 */
export function resolveCreatureResearch(entries, creature, options = {}) {
  const configs = (entries.length ? entries : [null]).map((entry) =>
    resolveResearchConfig(entry, creature, options),
  );
  const easiest = configs.reduce((lowest, config) => (config.dc < lowest.dc ? config : lowest));
  return {
    dc: easiest.dc,
    isDcExplicit: easiest.isDcExplicit,
    skills: [...new Set(configs.flatMap((config) => config.skills))],
    isSkillsExplicit: configs.every((config) => config.isSkillsExplicit),
  };
}
