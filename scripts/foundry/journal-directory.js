import { isNoteStoreJournal } from "./note-store.js";
import { formatKeybinding } from "./settings.js";

const MODULE_ID = "bestiary-journal";

/**
 * Integrates with Foundry's Journals sidebar: hides internal note-store
 * JournalEntry documents and adds the Bestiary button to the header.
 * Sidebar tabs are ApplicationV2 since v13, so `html` is a plain element.
 */
export function registerJournalDirectoryIntegration() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    hideNoteStoreEntries(root);
    appendBestiaryButton(root);
  });
}

export function hideNoteStoreEntries(root) {
  for (const item of root.querySelectorAll(
    ".directory-item[data-entry-id], .directory-item[data-document-id]",
  )) {
    const id = item.dataset.entryId || item.dataset.documentId;
    const entry = id ? globalThis.game?.journal?.get?.(id) : null;
    if (isNoteStoreJournal(entry)) item.remove();
  }
}

function appendBestiaryButton(root) {
  if (root.querySelector(".bestiary-sidebar-btn")) return;

  const headerActions =
    root.querySelector(".header-actions") ?? root.querySelector(".directory-header .action-buttons");
  if (!headerActions) return;

  const keyHint = formatKeybinding(game.keybindings.get(MODULE_ID, "openBestiary"));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("bestiary-sidebar-btn");
  btn.dataset.tooltip = keyHint
    ? `${game.i18n.localize("BESTIARY.Title")} (${keyHint})`
    : game.i18n.localize("BESTIARY.Title");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-book-skull";
  icon.setAttribute("inert", "");
  btn.append(icon, document.createTextNode(` ${game.i18n.localize("BESTIARY.Title")}`));
  btn.addEventListener("click", () => game.bestiaryJournal?.toggle());
  headerActions.appendChild(btn);
}
