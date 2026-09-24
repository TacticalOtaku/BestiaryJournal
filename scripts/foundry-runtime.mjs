export function resolveUuid(uuid) {
  return globalThis.fromUuid(uuid);
}

export function localize(key) {
  return game.i18n.localize(key);
}

export function hasTranslation(key) {
  return !!game.i18n.has?.(key);
}

export function getDnd5eConfig() {
  return CONFIG.DND5E ?? {};
}

export function enrichHtml(text, options) {
  const editor = foundry.applications.ux.TextEditor.implementation;
  return editor.enrichHTML(text, options);
}

/** Everyone who can hold bestiary knowledge — the party, GMs excluded. */
export function getPlayerUsers() {
  const users = game.users?.contents ?? [...(game.users?.values?.() ?? [])];
  return users
    .filter(user => !user.isGM)
    .map(user => ({
      id: user.id,
      name: user.name,
      color: user.color?.css ?? user.color ?? "#7a7a7a",
      avatar: user.character?.img || user.avatar || "icons/svg/mystery-man.svg",
      characterName: user.character?.name ?? "",
      active: !!user.active
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getUserById(userId) {
  return game.users?.get?.(userId) ?? null;
}

export function formatTimestamp(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(game.i18n.lang, {
      dateStyle: "short",
      timeStyle: "short"
    });
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function openFilePicker({ type = "image", current = "", callback }) {
  const Picker = foundry.applications.apps.FilePicker.implementation;
  const picker = new Picker({ type, current, callback });
  picker.render({ force: true });
  return picker;
}
