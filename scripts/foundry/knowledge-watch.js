import { canViewCreature, selectEntryContext } from "../core/bestiary-domain.js";
import { isNewToViewer, tierIncreases } from "../core/knowledge-progress.js";
import { isBlockVisible } from "../core/research-model.js";
import { log } from "../core/logger.js";
import { getBestiaryData, getBestiaryKnowledge } from "./bestiary-store.js";
import { getCreatureData } from "./creature-cache.js";
import { getEntryBlockTiers } from "./creature-display.js";
import { localize } from "./foundry-runtime.js";
import { describeTier } from "./research.js";

const MODULE_ID = "bestiary-journal";

/** The player's own tiers as last announced, so the next knowledge change can tell what rose. */
let lastTiers = null;

function ownTiers() {
  const records = getBestiaryKnowledge().users?.[game.user.id] ?? {};
  return Object.fromEntries(Object.entries(records).map(([uuid, record]) => [uuid, record.tier]));
}

/**
 * Starts watching a player's knowledge. On their first run every creature they can already see is marked as
 * seen at its current tier, so the bestiary does not light up as new all at once.
 */
export async function startKnowledgeWatch() {
  if (game.user.isGM) return;
  lastTiers = ownTiers();
  if (game.settings.get(MODULE_ID, "seenTiers") !== null) return;
  const data = getBestiaryData();
  const seen = {};
  for (const section of data.sections) {
    for (const entry of section.creatures) {
      if (canViewCreature(data, entry.uuid, game.user)) seen[entry.uuid] = lastTiers[entry.uuid] ?? 0;
    }
  }
  await game.settings.set(MODULE_ID, "seenTiers", seen);
}

/** «Вы узнали больше о …» for each creature whose tier rose; the name only once the new tier reveals it. */
export async function announceKnowledge() {
  if (game.user.isGM || !lastTiers) return;
  const now = ownTiers();
  const rises = tierIncreases(lastTiers, now);
  lastTiers = now;
  const data = getBestiaryData();
  for (const { uuid, to } of rises) {
    const context = selectEntryContext(data, uuid, game.user);
    if (!context) continue;
    let name = "";
    try {
      const creature = await getCreatureData(uuid);
      if (creature && isBlockVisible("name", to, getEntryBlockTiers(context.entry))) name = creature.name;
    } catch (error) {
      log.debug(`Could not read ${uuid} for a knowledge notice`, error);
    }
    ui.notifications.info(game.i18n.format("BESTIARY.Notice.Learned", {
      name: name || localize("BESTIARY.Tier.UnknownName"),
      tier: describeTier(to).label
    }));
  }
}

/** True while a player has not opened the creature since it appeared or since they last learned more. */
export function isNewCreature(uuid, tier) {
  if (game.user.isGM) return false;
  return isNewToViewer(game.settings.get(MODULE_ID, "seenTiers")?.[uuid], tier);
}

/** Opening a creature's card clears its «new» mark until the player learns more. */
export async function markSeen(uuid, tier) {
  if (game.user.isGM) return;
  const seen = game.settings.get(MODULE_ID, "seenTiers") ?? {};
  if (seen[uuid] === tier) return;
  await game.settings.set(MODULE_ID, "seenTiers", { ...seen, [uuid]: tier });
  Hooks.callAll("bestiaryJournalRefresh", { changed: { seen: true }, uuids: [uuid] });
}
