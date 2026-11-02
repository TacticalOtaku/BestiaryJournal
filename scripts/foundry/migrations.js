import { NEVER_TIER } from "../core/research-model.js";
import { normalizeBestiaryData, normalizeKnowledge } from "../core/bestiary-domain.js";
import { getPlayerUsers } from "./foundry-runtime.js";
import { log } from "../core/logger.js";

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
 * Keep a recovery copy before writing. A failed migration restores the raw
 * originals; if storage also refuses rollback, retain the copy for recovery.
 */
export async function runMigrations() {
  const current = Number(game.settings.get(MODULE_ID, "dataVersion") ?? 0);
  if (current >= DATA_VERSION) return false;

  const originals = Object.fromEntries(["bestiaryData", "bestiaryKnowledge", "dataVersion"]
    .map(key => [key, structuredClone(game.settings.get(MODULE_ID, key))]));
  const previous = game.settings.get(MODULE_ID, "migrationBackup");
  if (previous?.originals && current < previous.targetVersion
    && JSON.stringify(previous.originals) !== JSON.stringify(originals)) {
    log.error("Migration recovery is required; restore the originals in bestiary-journal.migrationBackup before retrying");
    return false;
  }

  try {
    await game.settings.set(MODULE_ID, "migrationBackup", { targetVersion: DATA_VERSION, originals });
  } catch (error) {
    log.error("Could not save migration recovery data; world stores were not changed", error);
    return false;
  }

  const attempted = [];
  try {
    const data = normalizeBestiaryData(structuredClone(originals.bestiaryData));
    const knowledge = normalizeKnowledge(structuredClone(originals.bestiaryKnowledge));

    migrateCustomDisplay(data);
    migrateDetailLevels(knowledge);

    for (const [key, value] of [["bestiaryData", data], ["bestiaryKnowledge", knowledge], ["dataVersion", DATA_VERSION]]) {
      // A rejected acknowledgement does not prove that the server did not save.
      attempted.push(key);
      await game.settings.set(MODULE_ID, key, value);
    }
  } catch (error) {
    const failedRestores = [];
    for (const key of attempted.reverse()) {
      try {
        await game.settings.set(MODULE_ID, key, originals[key]);
      } catch {
        failedRestores.push(key);
      }
    }
    if (failedRestores.length) {
      log.error(`Migration failed; could not restore ${failedRestores.join(", ")}. Originals remain in bestiary-journal.migrationBackup`, error);
    } else {
      await clearMigrationBackup();
      log.error("Migration failed; original world data restored", error);
    }
    return false;
  }

  await clearMigrationBackup();
  log.info(`Migrated world data to version ${DATA_VERSION}`);
  return true;
}

async function clearMigrationBackup() {
  try {
    await game.settings.set(MODULE_ID, "migrationBackup", {});
  } catch (error) {
    log.warn("Could not clear the migration recovery copy; world data was saved", error);
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
