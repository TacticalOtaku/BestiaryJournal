import { getCollapsedFamilies } from "../foundry/client-preferences.js";
import { localize } from "../foundry/foundry-runtime.js";
import { UNGROUPED_ID, UNIDENTIFIED_ID } from "./creature-rows.js";

/** What a collection window shows around its rows: family groups and the filter choices. */

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
