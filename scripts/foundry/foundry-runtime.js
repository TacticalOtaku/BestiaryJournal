export function resolveUuid(uuid) {
  return globalThis.fromUuid(uuid);
}

export function localize(key) {
  return game.i18n.localize(key);
}

export function hasTranslation(key) {
  return !!game.i18n.has?.(key);
}

/** "{count} существа": the plural form (one, few, many, other) the language's rules pick for `count`. */
export function formatCount(key, count) {
  const form = new Intl.PluralRules(game.i18n.lang).select(Number(count) || 0);
  return game.i18n.format(`${key}.${hasTranslation(`${key}.${form}`) ? form : "other"}`, { count });
}

export function getDnd5eConfig() {
  return CONFIG.DND5E ?? {};
}

/** dnd5e's own evaluation of a deterministic bonus formula such as "-3" or "-@prof". */
export function simplifyDnd5eBonus(bonus, rollData) {
  const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
  return simplify ? simplify(bonus, rollData) : Number(bonus) || 0;
}

export function enrichHtml(text, options) {
  const editor = foundry.applications.ux.TextEditor.implementation;
  return editor.enrichHTML(text, options);
}

/** Everyone who can hold bestiary knowledge — the party, GMs excluded. */
export function getPlayerUsers() {
  const users = game.users?.contents ?? [...(game.users?.values?.() ?? [])];
  return users
    .filter((user) => !user.isGM)
    .map((user) => ({
      id: user.id,
      name: user.name,
      color: user.color?.css ?? user.color ?? "#7a7a7a",
      avatar: user.character?.img || user.avatar || "icons/svg/mystery-man.svg",
      characterName: user.character?.name ?? "",
      active: !!user.active,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getUserById(userId) {
  return game.users?.get?.(userId) ?? null;
}

const timestampFormatters = new Map();

export function formatTimestamp(value) {
  if (!value) return "";
  const lang = game.i18n?.lang || "";
  try {
    let formatter = timestampFormatters.get(lang);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(lang || undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
      timestampFormatters.set(lang, formatter);
    }
    return formatter.format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

/** Modal yes/no confirmation backed by Foundry's native <dialog>-based DialogV2. */
export function confirmDialog({ title, content, yesLabel, noLabel = localize("BESTIARY.Cancel") }) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    yes: { label: yesLabel },
    no: { label: noLabel },
    content,
    modal: true,
    rejectClose: false,
  });
}

export function openFilePicker({ type = "image", current = "", callback }) {
  const Picker = foundry.applications.apps.FilePicker.implementation;
  const picker = new Picker({ type, current, callback });
  picker.render({ force: true });
  return picker;
}
