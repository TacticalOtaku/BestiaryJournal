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

/**
 * dnd5e 4.0 moved the roll helpers from positional arguments
 * (`rollSkill("nat", options)`) to a configuration object (`rollSkill({skill})`).
 * Wrappers such as midi-qol write onto that first argument, so passing a bare
 * string to a modern system throws instead of rolling.
 */
export function usesLegacyDnd5eRollApi() {
  const version = game.system?.version ?? "";
  if (!version) return false;
  return foundry.utils.isNewerVersion("4.0.0", version);
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
      avatar: user.avatar ?? user.character?.img ?? "icons/svg/mystery-man.svg",
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
  const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const picker = new Picker({ type, current, callback });
  picker.render(true);
  return picker;
}
