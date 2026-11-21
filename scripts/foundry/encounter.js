import { BESTIARY_COMMANDS, getEntryContexts, getUserTier } from "../core/bestiary-domain.js";
import { log } from "../core/logger.js";
import { getBestiaryData, getBestiaryKnowledge } from "./bestiary-store.js";
import { runCommand } from "./command-feedback.js";
import { getPlayerUsers } from "./foundry-runtime.js";

const MODULE_ID = "bestiary-journal";
const ENCOUNTER_TIER = 1;

/** The bestiary's actor for a combatant: an unlinked token's base actor. */
function combatantUuid(combatant, tokenOverride = null) {
  return combatant.token?.baseActor?.uuid ?? tokenOverride?.baseActor?.uuid ?? combatant.actor?.uuid ?? null;
}

function friendlyDisposition() {
  return globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;
}

function isVisibleHostileNpc(combatant, tokenOverride = null) {
  if (combatant?.actor?.type !== "npc" || combatant.hidden) return false;
  const token = tokenOverride ?? combatant.token;
  if (token?.hidden) return false;
  return token?.disposition !== friendlyDisposition();
}

/** Visible, non-friendly NPC bestiary UUIDs in an encounter; hidden or allied combatants never leak rumors. */
export function collectVisibleEncounterUuids(combat, data) {
  return new Set(
    (combat?.combatants ?? [])
      .filter((combatant) => isVisibleHostileNpc(combatant))
      .map(combatantUuid)
      .filter((uuid) => uuid && getEntryContexts(data, uuid).length),
  );
}

/**
 * Bestiary UUID revealed when a hidden combatant becomes visible mid-combat.
 * Returns a Set so callers share the same reveal pipeline as round changes.
 */
export function collectCombatantRevealUuids(combatant, data, changed = {}) {
  if (!combatant?.combat?.started) return new Set();
  if (!("hidden" in changed) || changed.hidden !== false) return new Set();
  if (!isVisibleHostileNpc(combatant)) return new Set();
  const uuid = combatantUuid(combatant);
  return uuid && getEntryContexts(data, uuid).length ? new Set([uuid]) : new Set();
}

function tokenMatchesCombatant(tokenDocument, combat, combatant) {
  if (!tokenDocument || !combatant) return false;
  if (combatant.token === tokenDocument) return true;
  const combatantTokenId = combatant.token?.id ?? combatant.tokenId;
  if (!tokenDocument.id || combatantTokenId !== tokenDocument.id) return false;
  const combatSceneId = combat?.scene?.id ?? combat?.sceneId;
  const tokenSceneId = tokenDocument.parent?.id;
  return !combatSceneId || !tokenSceneId || combatSceneId === tokenSceneId;
}

/**
 * Bestiary UUIDs revealed when a token in an active combat is unhidden or flips disposition.
 */
export function collectTokenRevealUuids(tokenDocument, combats, data, changed = {}) {
  const revealed = "hidden" in changed && changed.hidden === false;
  const dispositionChanged = "disposition" in changed;
  if (!revealed && !dispositionChanged) return new Set();

  const uuids = new Set();
  for (const combat of combats ?? []) {
    if (!combat?.started) continue;
    for (const combatant of combat.combatants ?? []) {
      if (!tokenMatchesCombatant(tokenDocument, combat, combatant)) continue;
      if (!isVisibleHostileNpc(combatant, tokenDocument)) continue;
      const uuid = combatantUuid(combatant, tokenDocument);
      if (uuid && getEntryContexts(data, uuid).length) uuids.add(uuid);
    }
  }
  return uuids;
}

function revealEncounterUuids(uuids) {
  if (!uuids.size) return;
  const knowledge = getBestiaryKnowledge();
  const players = getPlayerUsers();
  for (const uuid of uuids) {
    const userIds = players
      .filter((user) => getUserTier(knowledge, user.id, uuid) < ENCOUNTER_TIER)
      .map((user) => user.id);
    if (!userIds.length) continue;
    runCommand({
      type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
      uuids: [uuid],
      userIds,
      tier: ENCOUNTER_TIER,
      source: "encounter",
    }).catch((error) => log.warn(`Could not reveal ${uuid} on encounter`, error));
  }
}

/**
 * «Знакомство в бою»: when a visible enemy from the bestiary fights the party, every player who does not know
 * it yet hears rumours of it. A tier is only ever raised here, never lowered; the authoritative GM writes it.
 */
export function registerEncounterReveal(isAuthority) {
  Hooks.on("updateCombat", (combat, changed) => {
    if (!("round" in changed) || !combat.started || !isAuthority()) return;
    if (!game.settings.get(MODULE_ID, "encounterReveal")) return;
    revealEncounterUuids(collectVisibleEncounterUuids(combat, getBestiaryData()));
  });

  Hooks.on("updateCombatant", (combatant, changed) => {
    if (!isAuthority()) return;
    if (!game.settings.get(MODULE_ID, "encounterReveal")) return;
    if (!game.settings.get(MODULE_ID, "encounterRevealOnUnhide")) return;
    revealEncounterUuids(collectCombatantRevealUuids(combatant, getBestiaryData(), changed));
  });

  Hooks.on("updateToken", (tokenDocument, changed) => {
    if (!isAuthority()) return;
    if (!game.settings.get(MODULE_ID, "encounterReveal")) return;
    if (!game.settings.get(MODULE_ID, "encounterRevealOnUnhide")) return;
    const combats = game.combats?.contents ?? [...(game.combats ?? [])];
    revealEncounterUuids(collectTokenRevealUuids(tokenDocument, combats, getBestiaryData(), changed));
  });
}
