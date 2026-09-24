import { extractCreatureData } from "./helpers.mjs";
import { resolveUuid } from "./foundry-runtime.mjs";

/**
 * Per-client cache of extracted creature data. Every bestiary refresh used to
 * re-read and re-enrich every actor; now an actor is processed once and only
 * again after it (or anything embedded in it) actually changes.
 */
const cache = new Map();

function cacheKey(uuid, enrich) {
  return `${uuid}|${enrich ? "rich" : "plain"}`;
}

/** @returns {Promise<object|null>} creature data, or null when the actor is gone */
export function getCreatureData(uuid, { enrich = false } = {}) {
  const key = cacheKey(uuid, enrich);
  if (!cache.has(key)) {
    const pending = resolveUuid(uuid)
      .then(actor => (actor ? extractCreatureData(actor, { enrich }) : null))
      .catch(error => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
  }
  return cache.get(key);
}

/** Resolves many creatures at once instead of one after another. */
export async function getCreatureDataMany(uuids) {
  const settled = await Promise.allSettled(uuids.map(uuid => getCreatureData(uuid)));
  return new Map(uuids.map((uuid, index) => {
    const outcome = settled[index];
    if (outcome.status === "rejected") {
      console.warn(`Bestiary | Could not resolve actor UUID ${uuid}`, outcome.reason);
      return [uuid, null];
    }
    return [uuid, outcome.value];
  }));
}

export function invalidateCreature(uuid) {
  if (!uuid) return;
  cache.delete(cacheKey(uuid, false));
  cache.delete(cacheKey(uuid, true));
}

function owningActorUuid(document) {
  let current = document;
  while (current) {
    if (current.documentName === "Actor") return current.uuid;
    current = current.parent;
  }
  return null;
}

const invalidate = document => invalidateCreature(owningActorUuid(document));
for (const hook of [
  "updateActor", "deleteActor",
  "createItem", "updateItem", "deleteItem",
  "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"
]) {
  Hooks.on(hook, invalidate);
}
