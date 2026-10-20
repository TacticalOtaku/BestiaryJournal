import { formatCR, formatDistanceUnit } from "../integrations/dnd5e.js";
import { getEntryBlockTiers } from "../foundry/creature-display.js";
import { buildImageView, buildThumbView, SILHOUETTE_PLACEHOLDER } from "../core/image-framing.js";
import { GM_TIER, isBlockVisible } from "../core/research-model.js";
import { getUserTier, selectEntryContext } from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { localize, resolveUuid } from "../foundry/foundry-runtime.js";

/**
 * View model for a creature tile, row or quick preview, already cut down to
 * what the viewer's tier reveals. Nothing hidden is put into the context —
 * not even into data attributes used for search, sort or filters — so the
 * library and collection views cannot leak what the full card keeps back.
 */
export function buildCreatureCard({ uuid, entry, creature, viewerTier, searchExtra = [] }) {
  const source = creature ?? missingCreature(entry);
  const blockTiers = getEntryBlockTiers(entry);
  const show = key => isBlockVisible(key, viewerTier, blockTiers);

  const knowsName = show("name");
  const knowsType = show("type");
  const knowsCr = show("cr");
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
    showAc: show("ac"),
    ac: show("ac") ? source.ac?.value ?? "" : "",
    showHp: show("hp"),
    hp: show("hp") ? { value: source.hp?.value ?? 0, max: source.hp?.max ?? 0 } : null,
    speedLabel: show("speed") ? formatSpeed(source) : "",
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

function formatSpeed(creature) {
  const unit = formatDistanceUnit(creature.speedUnits);
  return Object.entries(creature.speeds ?? {}).map(([key, value]) => {
    const label = localize(`BESTIARY.Speed${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    return `${label}: ${value} ${unit}`;
  }).join(" · ");
}

/**
 * Posts what the viewer knows, never more: an unknown creature goes out as a
 * silhouette without a name. A GM previewing as a player posts that view;
 * `tier` overrides the viewer's own tier.
 */
export async function postCreatureToChat({ uuid, sectionId, viewer, tier }) {
  const actor = await resolveUuid(uuid);
  if (!actor) return;
  const context = selectEntryContext(getBestiaryData(), uuid, viewer, sectionId);
  tier ??= viewer.isGM ? GM_TIER : getUserTier(getBestiaryKnowledge(), viewer.id, uuid);
  const blockTiers = getEntryBlockTiers(context?.entry);
  const knowsName = isBlockVisible("name", tier, blockTiers);
  const knowsPortrait = isBlockVisible("portrait", tier, blockTiers);
  const displayName = knowsName ? actor.name : localize("BESTIARY.Tier.UnknownName");

  const card = document.createElement("div");
  card.className = "bestiary-chat-card";

  const portrait = document.createElement("img");
  portrait.src = knowsPortrait ? actor.img : SILHOUETTE_PLACEHOLDER;
  portrait.alt = displayName;
  // Keeps the card small once the module (and its CSS) is disabled.
  portrait.width = portrait.height = 52;
  if (!knowsPortrait) portrait.className = "is-silhouette";

  const copy = document.createElement("div");
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
  copy.append(name, action);
  card.append(portrait, copy);

  await ChatMessage.create({
    speaker: knowsName ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({ user: game.user }),
    content: card.outerHTML,
    flags: { "bestiary-journal": { creatureUuid: actor.uuid } }
  });
}
