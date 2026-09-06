import { BESTIARY_COMMANDS } from "./bestiary-domain.mjs";
import { dispatchBestiaryCommand, getBestiaryState } from "./bestiary-store.mjs";
import { localize } from "./foundry-runtime.mjs";

const MODULE_ID = "bestiary-journal";
const EXPORT_FORMAT = 1;

/**
 * Snapshots the structural side of the bestiary: sections, families, entries,
 * reveal thresholds and framing. Knowledge and comments are user-scoped, so
 * they travel only as an archival copy — importing restores structure only.
 */
export function buildSnapshot({ sectionIds = [], includeSocial = false } = {}) {
  const state = getBestiaryState();
  const sections = sectionIds.length
    ? state.data.sections.filter(section => sectionIds.includes(section.id))
    : state.data.sections;

  const snapshot = {
    module: MODULE_ID,
    format: EXPORT_FORMAT,
    exportedAt: Date.now(),
    world: game.world?.id ?? "",
    system: game.system?.id ?? "",
    sections: foundry.utils.deepClone(sections)
  };
  if (includeSocial) {
    const uuids = new Set(sections.flatMap(section => section.creatures.map(entry => entry.uuid)));
    snapshot.archive = {
      knowledge: state.knowledge,
      comments: state.social.comments.filter(comment => uuids.has(comment.uuid))
    };
  }
  return snapshot;
}

export function downloadSnapshot(snapshot, filename) {
  const json = JSON.stringify(snapshot, null, 2);
  const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  save(json, "application/json", filename);
}

export function exportBestiary({ sectionIds = [], includeSocial = false, filename } = {}) {
  const snapshot = buildSnapshot({ sectionIds, includeSocial });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadSnapshot(snapshot, filename ?? `bestiary-${game.world?.id ?? "world"}-${stamp}.json`);
  ui.notifications.info(game.i18n.format("BESTIARY.Transfer.Exported", {
    count: snapshot.sections.length
  }));
  return snapshot;
}

/** Exports a single creature entry as a one-section snapshot. */
export function exportCreatureEntry(sectionId, uuid) {
  const state = getBestiaryState();
  const section = state.data.sections.find(item => item.id === sectionId);
  const entry = section?.creatures.find(item => item.uuid === uuid);
  if (!section || !entry) return null;

  const snapshot = {
    module: MODULE_ID,
    format: EXPORT_FORMAT,
    exportedAt: Date.now(),
    world: game.world?.id ?? "",
    system: game.system?.id ?? "",
    sections: [{
      ...foundry.utils.deepClone(section),
      creatures: [foundry.utils.deepClone(entry)],
      families: section.families.filter(family => family.id === entry.familyId)
    }]
  };
  const slug = (entry.label || uuid).replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
  downloadSnapshot(snapshot, `bestiary-entry-${slug}.json`);
  return snapshot;
}

export function validateSnapshot(payload) {
  if (!payload || typeof payload !== "object") return "BESTIARY.Transfer.ErrorNotJson";
  if (payload.module && payload.module !== MODULE_ID) return "BESTIARY.Transfer.ErrorForeign";
  if (!Array.isArray(payload.sections) || !payload.sections.length) return "BESTIARY.Transfer.ErrorEmpty";
  return null;
}

/** Opens a file picker, previews the snapshot and asks how to apply it. */
export async function importBestiaryFromFile() {
  const file = await pickJsonFile();
  if (!file) return false;

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    ui.notifications.error(localize("BESTIARY.Transfer.ErrorNotJson"));
    return false;
  }

  const error = validateSnapshot(payload);
  if (error) {
    ui.notifications.error(localize(error));
    return false;
  }

  const sectionCount = payload.sections.length;
  const creatureCount = payload.sections
    .reduce((total, section) => total + (section.creatures?.length ?? 0), 0);

  const mode = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("BESTIARY.Transfer.ImportTitle"), icon: "fas fa-file-import" },
    classes: ["bestiary-journal", "bestiary-app", "bestiary-dialog"],
    content: `
      <section class="bestiary-import-dialog">
        <p>${game.i18n.format("BESTIARY.Transfer.ImportSummary", {
          sections: sectionCount,
          creatures: creatureCount
        })}</p>
        <p class="bestiary-import-note">${localize("BESTIARY.Transfer.ImportNote")}</p>
      </section>`,
    buttons: [
      { action: "merge", icon: "fas fa-code-merge", label: localize("BESTIARY.Transfer.ModeMerge"), default: true },
      { action: "replace", icon: "fas fa-arrows-rotate", label: localize("BESTIARY.Transfer.ModeReplace") },
      { action: "cancel", icon: "fas fa-xmark", label: localize("BESTIARY.Cancel") }
    ],
    rejectClose: false
  });

  if (!mode || mode === "cancel") return false;
  if (mode === "replace") {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.Transfer.ModeReplace") },
      content: `<p>${localize("BESTIARY.Transfer.ReplaceWarning")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return false;
  }

  await dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.IMPORT_SNAPSHOT,
    payload: { sections: payload.sections },
    mode
  });
  ui.notifications.info(game.i18n.format("BESTIARY.Transfer.Imported", {
    sections: sectionCount,
    creatures: creatureCount
  }));
  return true;
}

function pickJsonFile() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
