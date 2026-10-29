import { getUserTier, selectVisibleCreatureEntries } from "../core/bestiary-domain.js";
import { GM_TIER } from "../core/research-model.js";
import { getCollapsedFamilies } from "../foundry/client-preferences.js";
import { resolveShownEntries } from "../foundry/creature-cache.js";
import { getPlayerUsers, localize } from "../foundry/foundry-runtime.js";
import { isNewCreature } from "../foundry/knowledge-watch.js";
import { describeTier } from "../foundry/research.js";
import { buildCreatureCard, sortByKnownName } from "./creature-cards.js";
import { buildPartyBadge } from "./knowledge-ui.js";

/** What a collection window shows: its creatures as the viewer knows them, grouped by family. */

export const UNGROUPED_ID = "__ungrouped__";
/** Where a player sees creatures whose name they do not know: their family would hint at what they are. */
export const UNIDENTIFIED_ID = "__unidentified__";

export async function resolveSectionCreatures(section, knowledge, isGM) {
  const players = isGM ? getPlayerUsers() : [];
  const { entries, resolved } = await resolveShownEntries(selectVisibleCreatureEntries(section, isGM), isGM);

  const creatures = entries.map(entry => {
    const viewerTier = isGM ? GM_TIER : getUserTier(knowledge, game.user.id, entry.uuid);
    const card = buildCreatureCard({
      uuid: entry.uuid,
      entry,
      creature: resolved.get(entry.uuid),
      viewerTier,
      searchExtra: [section.name]
    });
    return {
      ...card,
      entry,
      // Also the data-family-id on the card: the real family must not reach the page while the name is hidden.
      familyId: !isGM && !card.knowsName ? UNIDENTIFIED_ID : entry.familyId ?? UNGROUPED_ID,
      isHidden: !!entry.hidden,
      isLocked: !!entry.locked || !!section.locked,
      viewerTier,
      isNew: isNewCreature(entry.uuid, viewerTier),
      tierBadge: isGM ? buildPartyBadge(knowledge, entry.uuid, players) : describeTier(viewerTier)
    };
  });
  return sortByKnownName(creatures);
}

/** The family groups of a collection; a player sees only groups with creatures in them. */
export function buildFamilyGroups(section, families, creatures, isGM) {
  const collapsed = getCollapsedFamilies();
  const groups = families.map(family => ({
    id: family.id,
    name: family.name,
    image: family.image,
    hidden: !!family.hidden,
    isUngrouped: false,
    collapsed: collapsed.has(`${section.id}:${family.id}`),
    creatures: creatures.filter(creature => creature.familyId === family.id)
  }));

  const ungrouped = creatures.filter(creature => creature.familyId === UNGROUPED_ID);
  if (ungrouped.length || !families.length) {
    groups.push({
      id: UNGROUPED_ID,
      name: localize(families.length ? "BESTIARY.Families.Ungrouped" : "BESTIARY.Families.AllCreatures"),
      image: "",
      hidden: false,
      isUngrouped: true,
      collapsed: collapsed.has(`${section.id}:${UNGROUPED_ID}`),
      creatures: ungrouped
    });
  }
  const unidentified = creatures.filter(creature => creature.familyId === UNIDENTIFIED_ID);
  if (unidentified.length) {
    groups.push({
      id: UNIDENTIFIED_ID,
      name: localize("BESTIARY.Families.Unidentified"),
      image: "",
      hidden: false,
      isUngrouped: true,
      collapsed: collapsed.has(`${section.id}:${UNIDENTIFIED_ID}`),
      creatures: unidentified
    });
  }
  return groups
    .filter(group => isGM || group.creatures.length)
    .map(group => ({
      ...group,
      count: group.creatures.length,
      isEmpty: group.creatures.length === 0
    }));
}

export function buildFilterOptions(creatures) {
  return {
    typeOptions: uniqueSortedOptions(
      creatures.filter(creature => creature.typeKey)
        .map(creature => [creature.typeKey, creature.typeName || creature.typeKey])
    ),
    sizeOptions: uniqueSortedOptions(
      creatures.filter(creature => creature.size).map(creature => [creature.size, creature.size])
    )
  };
}

function uniqueSortedOptions(entries) {
  return [...new Map(entries).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
