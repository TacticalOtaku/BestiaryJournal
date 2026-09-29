import { log } from "../core/logger.js";
const MODULE_ID = "bestiary-journal";
const VIEW_MODES = new Set(["grid", "list"]);

/** Preferences that used to live per browser and now follow the user. */
const PREFERENCES_MOVED_TO_USER = ["favoriteCreatures", "collapsedFamilies"];

/**
 * Folds what each browser kept locally into the user's shared value, then
 * drops the local copy so an un-favorited creature does not come back on the
 * next load. Several browsers of one user merge rather than overwrite.
 */
export async function migrateClientPreferencesToUser(storage = globalThis.localStorage) {
  for (const key of PREFERENCES_MOVED_TO_USER) {
    const storageKey = `${MODULE_ID}.${key}`;
    const raw = storage?.getItem(storageKey);
    if (raw === null || raw === undefined) continue;

    let legacy = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) legacy = parsed;
    } catch (error) {
      log.warn(`Ignoring an unreadable local "${key}" preference`, error);
    }

    try {
      const current = game.settings.get(MODULE_ID, key) ?? [];
      const merged = [...new Set([...current, ...legacy])];
      if (merged.length !== current.length) await game.settings.set(MODULE_ID, key, merged);
      storage.removeItem(storageKey);
    } catch (error) {
      // Keep the local copy so the next load can try again.
      log.warn(`Could not move the "${key}" preference to the user`, error);
    }
  }
}

export function getFavoriteCreatureUuids() {
  return new Set(game.settings.get(MODULE_ID, "favoriteCreatures") ?? []);
}

export async function toggleFavoriteCreature(uuid) {
  const favorites = getFavoriteCreatureUuids();
  favorites.has(uuid) ? favorites.delete(uuid) : favorites.add(uuid);
  await game.settings.set(MODULE_ID, "favoriteCreatures", [...favorites]);
  return favorites;
}

export function getLibraryViewMode() {
  const mode = game.settings.get(MODULE_ID, "libraryViewMode");
  return VIEW_MODES.has(mode) ? mode : "grid";
}

export async function setLibraryViewMode(mode) {
  if (!VIEW_MODES.has(mode)) return false;
  await game.settings.set(MODULE_ID, "libraryViewMode", mode);
  return true;
}

/**
 * "Preview as" lets the GM read a card exactly as one player sees it.
 * It is a client preference: it never changes what anybody else sees.
 */
export function getPreviewUserId() {
  const stored = game.settings.get(MODULE_ID, "previewAsUser");
  if (!stored) return "";
  return game.users?.get?.(stored) ? stored : "";
}

export async function setPreviewUserId(userId) {
  await game.settings.set(MODULE_ID, "previewAsUser", userId ?? "");
}

export function getCollapsedFamilies() {
  const stored = game.settings.get(MODULE_ID, "collapsedFamilies");
  return new Set(Array.isArray(stored) ? stored : []);
}

export async function toggleCollapsedFamily(key) {
  const collapsed = getCollapsedFamilies();
  collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
  await game.settings.set(MODULE_ID, "collapsedFamilies", [...collapsed]);
  return collapsed;
}

export function getPreferredCommentChannel() {
  const stored = game.settings.get(MODULE_ID, "commentChannel");
  return ["gm", "private", "party"].includes(stored) ? stored : "private";
}

export async function setPreferredCommentChannel(channel) {
  if (!["gm", "private", "party"].includes(channel)) return false;
  await game.settings.set(MODULE_ID, "commentChannel", channel);
  return true;
}
