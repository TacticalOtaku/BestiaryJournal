const MODULE_ID = "bestiary-journal";
const VIEW_MODES = new Set(["grid", "list"]);

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
