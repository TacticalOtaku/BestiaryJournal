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
