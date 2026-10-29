import { BESTIARY_COMMANDS, getEntryContexts, getUserTier } from "../core/bestiary-domain.js";
import { log } from "../core/logger.js";
import { getBestiaryData, getBestiaryKnowledge } from "./bestiary-store.js";
import { runCommand } from "./command-feedback.js";
import { getPlayerUsers } from "./foundry-runtime.js";

const MODULE_ID = "bestiary-journal";
const ENCOUNTER_TIER = 1;

/** The bestiary's actor for a combatant: an unlinked token's base actor. */
function combatantUuid(combatant) {
  return combatant.token?.baseActor?.uuid ?? combatant.actor?.uuid ?? null;
}

/**
 * «Знакомство в бою»: when a creature from the bestiary fights the party, every player who does not know it
 * yet hears rumours of it. A tier is only ever raised here, never lowered; the authoritative GM writes it.
 */
export function registerEncounterReveal(isAuthority) {
  Hooks.on("updateCombat", (combat, changed) => {
    if (!("round" in changed) || !combat.started || !isAuthority()) return;
    if (!game.settings.get(MODULE_ID, "encounterReveal")) return;
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const players = getPlayerUsers();
    const uuids = new Set(combat.combatants.filter(combatant => combatant.actor?.type === "npc").map(combatantUuid)
      .filter(uuid => uuid && getEntryContexts(data, uuid).length));
    for (const uuid of uuids) {
      const userIds = players.filter(user => getUserTier(knowledge, user.id, uuid) < ENCOUNTER_TIER).map(user => user.id);
      if (!userIds.length) continue;
      runCommand({ type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuids: [uuid], userIds, tier: ENCOUNTER_TIER, source: "encounter" })
        .catch(error => log.warn(`Could not reveal ${uuid} on encounter`, error));
    }
  });
}
