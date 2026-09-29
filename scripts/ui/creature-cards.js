import { formatCR, formatDistanceUnit } from "../integrations/dnd5e.js";
import { getEntryBlockTiers } from "../foundry/creature-display.js";
import { buildImageView, buildThumbView } from "../core/image-framing.js";
import { isBlockVisible } from "../core/research-model.js";
import { localize } from "../foundry/foundry-runtime.js";

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
