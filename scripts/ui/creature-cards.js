import { formatCR, formatDistanceUnit } from "../integrations/dnd5e.js";
import { knowledgeLensFor } from "../foundry/creature-display.js";
import { buildImageView, buildThumbView, SILHOUETTE_PLACEHOLDER } from "../core/image-framing.js";
import { RESEARCH_TIERS } from "../core/research-model.js";
import { PARTY_VIEWER } from "../core/knowledge-lens.js";
import { selectEntryContext } from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { localize, resolveUuid } from "../foundry/foundry-runtime.js";

/**
 * View model for a creature tile, row or quick preview, already cut down to
 * what the viewer's tier reveals. Nothing hidden is put into the context —
 * not even into data attributes used for search, sort or filters — so the
 * library and collection views cannot leak what the full card keeps back.
 */
export function buildCreatureCard({ uuid, entry, creature, lens, searchExtra = [] }) {
  const source = creature ?? missingCreature(entry);
  const { show } = lens;
  // A deleted actor has a name and art left in its entry, but no statistics to show.
  const showStat = key => !!creature && show(key);

  const knowsName = show("name");
  const knowsType = show("type");
  const knowsCr = showStat("cr");
  const name = knowsName ? source.name : localize("BESTIARY.Tier.UnknownName");
  const typeLabel = knowsType
    ? [source.size, source.creatureType].filter(Boolean).join(" · ")
    : localize("BESTIARY.Tier.UnknownType");
  const silhouette = !show("portrait");

  return {
    uuid,
    name,
    knowsName,
    sortName: knowsName ? source.name : "",
    typeLabel,
    typeKey: knowsType ? source.creatureTypeKey ?? "" : "",
    typeName: knowsType ? source.creatureType ?? "" : "",
    size: knowsType ? source.size ?? "" : "",
    knowsCr,
    cr: knowsCr ? Number(source.cr ?? 0) : "",
    crFormatted: knowsCr ? formatCR(source.cr) : "",
    showAc: showStat("ac"),
    ac: showStat("ac") ? source.ac?.value ?? "" : "",
    showHp: showStat("hp"),
    hp: showStat("hp") ? { value: source.hp?.value ?? 0, max: source.hp?.max ?? 0 } : null,
    speedLabel: showStat("speed") ? formatSpeed(source) : "",
    image: buildImageView(entry, source, { silhouette }),
    thumb: buildThumbView(entry, source, { silhouette }),
    searchText: [
      knowsName ? source.name : "",
      knowsType ? source.creatureType : "",
      knowsType ? source.size : "",
      ...searchExtra
    ].filter(Boolean).join(" ").toLocaleLowerCase(),
    isMissing: !creature
  };
}

/** Entries whose actor was deleted still render, so the GM can clean up. */
function missingCreature(entry) {
  const thumb = entry?.thumb || "icons/svg/mystery-man.svg";
  return {
    uuid: entry?.uuid ?? "",
    name: entry?.label || localize("BESTIARY.MissingActor"),
    img: thumb,
    prototypeToken: thumb,
    cr: 0,
    creatureType: "",
    creatureTypeKey: "",
    size: "",
    speeds: {},
    hp: { value: 0, max: 0 },
    ac: { value: 0 }
  };
}

/** One `{ label, value }` per movement mode, in the creature's own unit. */
export function speedEntries(creature) {
  const unit = formatDistanceUnit(creature.speedUnits);
  return Object.entries(creature.speeds ?? {}).map(([key, value]) => ({
    label: localize(`BESTIARY.Speed${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    value: `${value} ${unit}`
  }));
}

function formatSpeed(creature) {
  return speedEntries(creature).map(({ label, value }) => `${label}: ${value}`).join(" · ");
}

/** Known names alphabetically, creatures the viewer cannot name last. */
export function sortByKnownName(cards) {
  return cards.sort((a, b) => (!a.sortName - !b.sortName) || a.sortName.localeCompare(b.sortName));
}

/**
 * Posts a public card: an unknown creature goes out as a silhouette without a
 * name. A player (or a GM previewing as one) posts only what the whole party
 * knows, so the card never sidesteps the sharing rules; a GM posts it all
 * unless `viewer` is PARTY_VIEWER.
 */
export async function postCreatureToChat({ uuid, sectionId, viewer }) {
  const actor = await resolveUuid(uuid);
  if (!actor) return;
  const data = getBestiaryData();
  const context = selectEntryContext(data, uuid, viewer, sectionId);
  const lens = knowledgeLensFor({ data, knowledge: getBestiaryKnowledge() }, viewer.isGM ? viewer : PARTY_VIEWER, uuid);
  const { tier, knowsName } = lens;
  const knowsPortrait = lens.show("portrait");
  const displayName = knowsName ? actor.name : localize("BESTIARY.Tier.UnknownName");

  const card = document.createElement("div");
  card.className = "bestiary-chat-card";
  // The tier the card was posted at; a GM's full card names none.
  const posted = RESEARCH_TIERS[tier];
  if (posted) card.dataset.tier = posted.key;

  const portrait = document.createElement("img");
  portrait.src = knowsPortrait ? actor.img || context?.entry?.thumb || CONST.DEFAULT_TOKEN : SILHOUETTE_PLACEHOLDER;
  portrait.alt = displayName;
  // Keeps the card small once the module (and its CSS) is disabled.
  portrait.width = portrait.height = 52;
  if (!knowsPortrait) portrait.className = "is-silhouette";

  const copy = document.createElement("div");
  const kicker = document.createElement("span");
  kicker.className = "bestiary-chat-kicker";
  kicker.textContent = [localize("BESTIARY.Title"), posted && localize(posted.label)].filter(Boolean).join(" · ");
  const name = document.createElement("strong");
  name.textContent = displayName;

  const action = document.createElement("p");
  const link = document.createElement("a");
  link.href = "#";
  link.className = "bestiary-creature-link";
  link.dataset.bestiaryCreatureUuid = actor.uuid;
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-book-skull";
  link.append(icon, document.createTextNode(localize("BESTIARY.OpenBestiaryCard")));

  action.appendChild(link);
  copy.append(kicker, name, action);
  card.append(portrait, copy);

  await ChatMessage.create({
    speaker: knowsName ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({ user: game.user }),
    content: card.outerHTML,
    flags: { "bestiary-journal": { creatureUuid: actor.uuid } }
  });
}
