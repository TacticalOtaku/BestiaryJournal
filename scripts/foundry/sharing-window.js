import { sharingBlockReason } from "../core/bestiary-domain.js";
import { log } from "../core/logger.js";

const MODULE_ID = "bestiary-journal";
const REASON_KEYS = Object.freeze({
  inCombat: "BESTIARY.Share.InCombat",
  needsRest: "BESTIARY.Share.NeedsRest"
});

/** A started fight in which one of the user's characters takes part. */
function isUserInCombat(user) {
  return game.combats.some(combat => combat.started
    && combat.combatants.some(combatant => combatant.players.some(player => player.id === user.id)));
}

/** Localisation key explaining why `user` may not share right now, or null. */
export function sharingBlockKey(user = game.user) {
  const clock = game.settings.get(MODULE_ID, "sharingClock")?.users?.[user.id] ?? {};
  const reason = sharingBlockReason({
    mode: game.settings.get(MODULE_ID, "sharingWindow"),
    inCombat: isUserInCombat(user),
    restedAt: clock.restedAt,
    foughtAt: clock.foughtAt
  });
  return reason ? REASON_KEYS[reason] : null;
}

let clockQueue = Promise.resolve();

/** Stamps `field` for every player who owns one of `actors`. */
function stampPlayers(actors, field) {
  const userIds = new Set(actors.filter(Boolean).flatMap(actor => game.users
    .filter(user => !user.isGM && actor.testUserPermission(user, "OWNER"))
    .map(user => user.id)));
  if (!userIds.size) return;
  const at = Date.now();
  // Serialised, so a rest that both updates the actor and posts a message is not lost.
  clockQueue = clockQueue.then(async () => {
    const clock = foundry.utils.deepClone(game.settings.get(MODULE_ID, "sharingClock") ?? {});
    clock.users ??= {};
    for (const id of userIds) clock.users[id] = { ...clock.users[id], [field]: at };
    clock.revision = (Number(clock.revision) || 0) + 1;
    await game.settings.set(MODULE_ID, "sharingClock", clock);
  }).catch(error => log.warn(`Could not record "${field}" for sharing`, error));
}

/**
 * The authoritative GM notes when each player's characters last rested and
 * last fought. Players cannot write world settings, so the record is trusted;
 * a rest that changes nothing and posts no message goes unnoticed.
 */
export function registerSharingClock(isAuthority) {
  Hooks.on("updateActor", (actor, changed, options) => {
    if (options.isRest && isAuthority()) stampPlayers([actor], "restedAt");
  });
  Hooks.on("createChatMessage", message => {
    if (message.type !== "rest" || !isAuthority()) return;
    stampPlayers([game.actors.get(message.speaker?.actor)], "restedAt");
  });
  // Every new round counts as fighting, for whoever is in the encounter.
  Hooks.on("updateCombat", (combat, changed) => {
    if (!("round" in changed) || !combat.started || !isAuthority()) return;
    stampPlayers(combat.combatants.map(combatant => combatant.actor), "foughtAt");
  });
}
