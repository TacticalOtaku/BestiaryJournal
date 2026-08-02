export const BESTIARY_COMMANDS = Object.freeze({
  CREATE_SECTION: "createSection",
  UPDATE_SECTION: "updateSection",
  DELETE_SECTION: "deleteSection",
  TOGGLE_SECTION_VISIBILITY: "toggleSectionVisibility",
  ADD_CREATURE: "addCreature",
  REMOVE_CREATURE: "removeCreature",
  TOGGLE_CREATURE_VISIBILITY: "toggleCreatureVisibility"
});

export function normalizeBestiaryData(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...source,
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    sections: Array.isArray(source.sections)
      ? source.sections.map(section => ({
          ...section,
          creatures: Array.isArray(section.creatures) ? section.creatures : []
        }))
      : []
  };
}

export function isGameMaster(userOrFlag) {
  return typeof userOrFlag === "boolean" ? userOrFlag : !!userOrFlag?.isGM;
}

export function isSectionVisible(section, userOrFlag) {
  return isGameMaster(userOrFlag) || !section?.hidden;
}

export function isCreatureEntryVisible(entry, userOrFlag) {
  return isGameMaster(userOrFlag) || !entry?.hidden;
}

export function selectVisibleSections(data, userOrFlag) {
  return normalizeBestiaryData(data).sections
    .filter(section => isSectionVisible(section, userOrFlag));
}

export function selectVisibleCreatureEntries(section, userOrFlag) {
  return (section?.creatures ?? [])
    .filter(entry => isCreatureEntryVisible(entry, userOrFlag));
}

export function canViewCreature(data, uuid, userOrFlag) {
  if (!uuid) return false;
  if (isGameMaster(userOrFlag)) return true;
  return selectVisibleSections(data, false)
    .some(section => selectVisibleCreatureEntries(section, false)
      .some(entry => entry.uuid === uuid));
}

export function getCreatureCollections(data, uuid, userOrFlag) {
  return selectVisibleSections(data, userOrFlag)
    .filter(section => selectVisibleCreatureEntries(section, userOrFlag)
      .some(entry => entry.uuid === uuid))
    .map(section => section.name);
}

export function mergeCreatureEntries(sections, userOrFlag) {
  const entries = new Map();
  for (const section of sections ?? []) {
    for (const entry of selectVisibleCreatureEntries(section, userOrFlag)) {
      const current = entries.get(entry.uuid) ?? {
        uuid: entry.uuid,
        addedAt: 0,
        collections: [],
        hidden: true
      };
      current.addedAt = Math.max(current.addedAt, entry.addedAt ?? 0);
      current.collections.push(section.name);
      current.hidden = current.hidden && !!entry.hidden;
      entries.set(entry.uuid, current);
    }
  }
  return [...entries.values()];
}

export function applyBestiaryCommand(currentData, command, dependencies = {}) {
  const data = cloneBestiaryData(currentData);
  const handler = COMMAND_HANDLERS[command?.type];
  if (!handler) throw new Error(`Unknown bestiary command: ${command?.type ?? "<empty>"}`);
  const changed = handler(data, command, {
    now: dependencies.now ?? Date.now,
    generateId: dependencies.generateId
  });
  if (changed) data.revision += 1;
  return { data, changed };
}

const COMMAND_HANDLERS = {
  [BESTIARY_COMMANDS.CREATE_SECTION]: createSection,
  [BESTIARY_COMMANDS.UPDATE_SECTION]: updateSection,
  [BESTIARY_COMMANDS.DELETE_SECTION]: deleteSection,
  [BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY]: toggleSectionVisibility,
  [BESTIARY_COMMANDS.ADD_CREATURE]: addCreature,
  [BESTIARY_COMMANDS.REMOVE_CREATURE]: removeCreature,
  [BESTIARY_COMMANDS.TOGGLE_CREATURE_VISIBILITY]: toggleCreatureVisibility
};

function createSection(data, command, { now, generateId }) {
  const section = command.section ?? {};
  const id = section.id || generateId?.();
  if (!id) throw new Error("Creating a bestiary section requires an ID generator");
  data.sections.push({
    id,
    name: section.name ?? "",
    image: section.image ?? "",
    hidden: !!section.hidden,
    updatedAt: now(),
    creatures: []
  });
  return true;
}

function updateSection(data, command, { now }) {
  const section = findSection(data, command.sectionId);
  if (!section) return false;
  section.name = command.patch?.name ?? section.name ?? "";
  section.image = command.patch?.image ?? section.image ?? "";
  section.hidden = command.patch?.hidden ?? section.hidden ?? false;
  section.updatedAt = now();
  return true;
}

function deleteSection(data, command) {
  const nextSections = data.sections
    .filter(section => section.id !== command.sectionId);
  if (nextSections.length === data.sections.length) return false;
  data.sections = nextSections;
  return true;
}

function toggleSectionVisibility(data, command, { now }) {
  const section = findSection(data, command.sectionId);
  if (!section) return false;
  section.hidden = !section.hidden;
  section.updatedAt = now();
  return true;
}

function addCreature(data, command, { now }) {
  const section = findSection(data, command.sectionId);
  if (!section || !command.uuid) return false;
  if (section.creatures.some(entry => entry.uuid === command.uuid)) return false;
  section.creatures.push({
    uuid: command.uuid,
    addedAt: now(),
    hidden: false
  });
  section.updatedAt = now();
  return true;
}

function removeCreature(data, command, { now }) {
  const section = findSection(data, command.sectionId);
  if (!section) return false;
  const nextCreatures = section.creatures
    .filter(entry => entry.uuid !== command.uuid);
  if (nextCreatures.length === section.creatures.length) return false;
  section.creatures = nextCreatures;
  section.updatedAt = now();
  return true;
}

function toggleCreatureVisibility(data, command, { now }) {
  const section = findSection(data, command.sectionId);
  const creature = section?.creatures
    .find(entry => entry.uuid === command.uuid);
  if (!creature) return false;
  creature.hidden = !creature.hidden;
  section.updatedAt = now();
  return true;
}

function cloneBestiaryData(data) {
  const normalized = normalizeBestiaryData(data);
  return {
    ...normalized,
    sections: normalized.sections.map(section => ({
      ...section,
      creatures: section.creatures.map(entry => ({ ...entry }))
    }))
  };
}

function findSection(data, sectionId) {
  return data.sections.find(section => section.id === sectionId);
}
