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
  return CONFIG.DND5E;
}

export function enrichHtml(text, options) {
  const editor = foundry.applications.ux.TextEditor.implementation;
  return editor.enrichHTML(text, options);
}
