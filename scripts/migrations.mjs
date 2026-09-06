import { NEVER_TIER } from "./research-model.mjs";
import { normalizeBestiaryData, normalizeKnowledge } from "./bestiary-domain.mjs";
import { getPlayerUsers } from "./foundry-runtime.mjs";

const MODULE_ID = "bestiary-journal";
export const DATA_VERSION = 2;

/** Legacy custom-display keys that map one-to-one onto the new block catalog. */
const LEGACY_BLOCKS = [
  "abilities", "str", "dex", "con", "int", "wis", "cha", "skills",
  "senses", "languages", "resistances", "immunities", "vulnerabilities",
  "conditionImmunities", "features", "actions", "inventory", "bonusActions",
  "reactions", "legendaryActions", "spells", "biography"
];

const LEGACY_LEVEL_TIERS = { minimal: 1, standard: 2, expanded: 3, custom: 2 };

/**
 * Upgrades a pre-0.2 world in place. Runs once, on the authoritative GM only.
 * Nothing here throws: a failed migration must not keep the module from
 * loading, it just leaves the old data alone.
 */
export async function runMigrations() {
  const current = Number(game.settings.get(MODULE_ID, "dataVersion") ?? 0);
  if (current >= DATA_VERSION) return false;

  try {
    const data = normalizeBestiaryData(game.settings.get(MODULE_ID, "bestiaryData"));
    const knowledge = normalizeKnowledge(game.settings.get(MODULE_ID, "bestiaryKnowledge"));

    migrateCustomDisplay(data);
    migrateDetailLevels(knowledge);

    await game.settings.set(MODULE_ID, "bestiaryData", data);
    await game.settings.set(MODULE_ID, "bestiaryKnowledge", knowledge);
    await game.settings.set(MODULE_ID, "dataVersion", DATA_VERSION);
    console.log(`Bestiary Journal | Migrated world data to version ${DATA_VERSION}`);
    return true;
  } catch (error) {
    console.error("Bestiary Journal | Migration failed; leaving existing data untouched", error);
    return false;
  }
}

/**
 * The old "custom" mode stored the blocks a creature *showed*. Anything the GM
 * had switched off becomes GM-only in the tier model; everything else keeps
 * the world default so the new ladder still applies.
 */
function migrateCustomDisplay(data) {
  const legacy = game.settings.get(MODULE_ID, "creatureCustomDisplay") ?? {};
  if (!Object.keys(legacy).length) return;

  for (const section of data.sections) {
    for (const entry of section.creatures) {
      const visible = legacy[entry.uuid];
      if (!Array.isArray(visible)) continue;
      const overrides = { ...entry.blockTiers };
      for (const key of LEGACY_BLOCKS) {
        if (!visible.includes(key)) overrides[key] = NEVER_TIER;
      }
      entry.blockTiers = overrides;
    }
  }
}

/**
 * A world-wide detail level used to apply to every player at once, so it maps
 * cleanly onto giving each player the same starting tier.
 */
function migrateDetailLevels(knowledge) {
  if (game.settings.get(MODULE_ID, "gmOnlyDetailToggle") !== true) return;
  const levels = game.settings.get(MODULE_ID, "creatureDetailLevels") ?? {};
  const players = getPlayerUsers();
  if (!Object.keys(levels).length || !players.length) return;

  const now = Date.now();
  for (const [uuid, level] of Object.entries(levels)) {
    const tier = LEGACY_LEVEL_TIERS[level];
    if (!tier) continue;
    for (const user of players) {
      const bucket = knowledge.users[user.id] ??= {};
      const existing = bucket[uuid];
      if (existing && existing.tier >= tier) continue;
      bucket[uuid] = {
        tier,
        source: "gm",
        updatedAt: now,
        grantedBy: null,
        attempts: 0,
        blocked: false,
        lastRoll: null
      };
    }
  }
}
