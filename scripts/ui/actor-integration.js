import { BESTIARY_COMMANDS, canViewCreature, getEntryContexts } from "../core/bestiary-domain.js";
import { MAX_RESEARCH_TIER } from "../core/research-model.js";
import { getBestiaryData } from "../foundry/bestiary-store.js";
import { runCommand } from "../foundry/command-feedback.js";
import { getPlayerUsers, localize } from "../foundry/foundry-runtime.js";
import { describeTier } from "../foundry/research.js";
import { showContextMenu } from "./ui-effects.js";

/** The actor the bestiary knows: an unlinked token's base actor, never its synthetic copy. */
function bestiaryActor(actor) {
  return actor?.isToken ? actor.token?.baseActor ?? actor : actor;
}

/**
 * What the bestiary offers for one actor: open it, add it to a collection, tell the party about it.
 * Players only get «Open», and only for a creature they can already open.
 */
export function bestiaryMenuItems(actor) {
  const target = bestiaryActor(actor);
  if (target?.type !== "npc") return [];
  const data = getBestiaryData();
  const uuid = target.uuid;
  const inBestiary = getEntryContexts(data, uuid).length > 0;
  const items = [];
  if (inBestiary && canViewCreature(data, uuid, game.user)) {
    items.push({ name: localize("BESTIARY.Actor.Open"), icon: "fa-book-skull", callback: () => game.bestiaryJournal?.openCreature(uuid) });
  }
  if (!game.user.isGM) return items;

  const missing = data.sections.filter(section => !section.creatures.some(entry => entry.uuid === uuid));
  if (missing.length && items.length) items.push({ separator: true });
  for (const section of missing) {
    items.push({
      name: game.i18n.format("BESTIARY.Actor.AddTo", { collection: section.name }),
      icon: "fa-folder-plus",
      disabled: section.locked,
      callback: async () => {
        const result = await runCommand({
          type: BESTIARY_COMMANDS.ADD_CREATURE, sectionId: section.id, uuid, label: target.name, thumb: target.img
        }, { unchanged: "BESTIARY.Lock.Blocked" });
        if (result?.changed) ui.notifications.info(game.i18n.format("BESTIARY.AddedToCollection", { name: target.name, collection: section.name }));
      }
    });
  }

  const players = getPlayerUsers();
  if (inBestiary && players.length) {
    items.push({ separator: true });
    for (let tier = 1; tier <= MAX_RESEARCH_TIER; tier += 1) {
      items.push({
        name: game.i18n.format("BESTIARY.Actor.GrantParty", { tier: describeTier(tier).label }),
        icon: describeTier(tier).icon,
        callback: () => runCommand({
          type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuids: [uuid], userIds: players.map(user => user.id), tier, source: "gm"
        })
      });
    }
  }
  return items;
}

function openBestiaryMenu(event, actor) {
  const items = bestiaryMenuItems(actor);
  if (!items.length) {
    ui.notifications.info(localize(game.user.isGM ? "BESTIARY.Actor.NoCollections" : "BESTIARY.CreatureUnavailable"));
    return;
  }
  showContextMenu(event, items);
}

/** «Бестиарий…» in the actors directory, in an NPC sheet's ⋮ menu and on the token HUD. */
export function registerActorIntegration() {
  Hooks.on("getActorContextOptions", (directory, options) => {
    const actorOf = li => game.actors.get(li.closest("[data-entry-id]")?.dataset.entryId ?? "");
    options.push({
      label: "BESTIARY.Actor.Menu",
      icon: "fa-solid fa-book-skull",
      visible: li => actorOf(li)?.type === "npc",
      onClick: (event, li) => openBestiaryMenu(event, actorOf(li))
    });
  });

  Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
    if (sheet.document?.type !== "npc") return;
    controls.push({ icon: "fa-solid fa-book-skull", label: "BESTIARY.Actor.Menu", onClick: event => openBestiaryMenu(event, sheet.document) });
  });

  Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud.document?.actor;
    if (!game.user.isGM || actor?.type !== "npc") return;
    const column = html.querySelector(".col.right");
    if (!column || column.querySelector(".bestiary-hud-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon bestiary-hud-button";
    button.dataset.tooltip = localize("BESTIARY.Actor.Menu");
    button.setAttribute("aria-label", localize("BESTIARY.Actor.Menu"));
    button.innerHTML = `<i class="fa-solid fa-book-skull" inert></i>`;
    button.addEventListener("click", event => openBestiaryMenu(event, actor));
    column.append(button);
  });
}
