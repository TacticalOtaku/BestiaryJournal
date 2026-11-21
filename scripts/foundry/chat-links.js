import { canUserViewBestiaryCreature, getBestiaryData } from "./bestiary-store.js";

const MODULE_ID = "bestiary-journal";
const bestiaryChatLinks = new Set();

/** Activates bestiary creature links rendered inside chat cards. */
export function registerBestiaryChatLinks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const flaggedUuid = message.getFlag(MODULE_ID, "creatureUuid");
    for (const link of html.querySelectorAll("a.bestiary-creature-link")) {
      const uuid = link.dataset.bestiaryCreatureUuid || flaggedUuid;
      if (!uuid) continue;
      link.dataset.bestiaryCreatureUuid = uuid;
      bestiaryChatLinks.add(link);
      refreshBestiaryChatLink(link);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        game.bestiaryJournal?.openCreature(uuid);
      });
    }
  });
}

function refreshBestiaryChatLink(link, data) {
  const canView = canUserViewBestiaryCreature(link.dataset.bestiaryCreatureUuid, game.user, data);
  link.classList.toggle("is-disabled", !canView);
  if (canView) {
    link.removeAttribute("aria-disabled");
    link.removeAttribute("title");
    delete link.dataset.tooltip;
  } else {
    const unavailable = game.i18n.localize("BESTIARY.CreatureUnavailable");
    link.setAttribute("aria-disabled", "true");
    link.title = unavailable;
    link.dataset.tooltip = unavailable;
  }
}

export function refreshBestiaryChatLinks() {
  const data = getBestiaryData();
  for (const link of bestiaryChatLinks) {
    if (!link.isConnected) {
      bestiaryChatLinks.delete(link);
      continue;
    }
    refreshBestiaryChatLink(link, data);
  }
}
