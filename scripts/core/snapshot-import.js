import { normalizeBestiaryData } from "./bestiary-domain.js";

/**
 * Importing a bestiary snapshot: merging it into the collections or replacing them, and the plan the GM confirms
 * first. The plan is the import itself run on a copy, so it cannot promise something the import does not do.
 * Locked collections are never touched.
 */

/**
 * `sections` are the current collections, left as they are; returns the collections after the import, whether
 * anything was imported, and a report of collection names: merged, created, removed and locked.
 */
export function importSnapshot(sections, payload, mode, { now, generateId }) {
  const current = structuredClone(sections);
  const incoming = prepareIncomingSections(payload, generateId);
  const report = { merged: [], created: [], removed: [], locked: [] };
  if (!incoming.length) return { sections: current, imported: false, report };

  if (mode === "replace") {
    const kept = current.filter(section => section.locked);
    const keptIds = new Set(kept.map(section => section.id));
    const keptNames = new Set(kept.map(section => section.name));
    const replacements = incoming
      .filter(section => !keptIds.has(section.id) && !keptNames.has(section.name))
      .map(section => ({ ...section, updatedAt: now() }));
    report.created = replacements.map(section => section.name);
    report.removed = current.filter(section => !section.locked).map(section => section.name);
    report.locked = kept.map(section => section.name);
    return { sections: [...kept, ...replacements], imported: true, report };
  }

  const { matches } = matchSnapshotSections(current, incoming);
  for (const section of incoming) {
    const existing = matches.get(section);
    if (!existing) {
      const maxSort = current.reduce((max, item) => Math.max(max, item.sort), 0);
      const id = current.some(item => item.id === section.id) ? generateId() : section.id;
      current.push({ ...section, id, sort: maxSort + 100, updatedAt: now() });
      report.created.push(section.name);
    } else if (existing.locked) {
      report.locked.push(existing.name);
    } else {
      mergeSectionInto(existing, section, now);
      report.merged.push(existing.name);
    }
  }
  return { sections: current, imported: true, report };
}

/** What an import would do, so the GM can confirm it before anything changes. */
export function planSnapshotImport(data, payload, mode = "merge") {
  let counter = 0;
  return importSnapshot(normalizeBestiaryData(data).sections, payload, mode, {
    now: () => 0,
    generateId: () => `__preview${++counter}`
  }).report;
}

/**
 * Normalizes snapshot sections and repairs what a hand-edited or doubled
 * export can contain: missing or repeated ids, and the same creature twice.
 */
function prepareIncomingSections(payload, generateId) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const sections = normalizeBestiaryData({ sections: source.sections }).sections;
  const seenIds = new Set();
  return sections.map(section => {
    const id = section.id && !seenIds.has(section.id) ? section.id : generateId();
    seenIds.add(id);
    const familyIds = new Set();
    const families = section.families.map(family => {
      const familyId = family.id && !familyIds.has(family.id) ? family.id : generateId();
      familyIds.add(familyId);
      return { ...family, id: familyId };
    });
    const uuids = new Set();
    const creatures = section.creatures.filter(entry => {
      if (!entry.uuid || uuids.has(entry.uuid)) return false;
      uuids.add(entry.uuid);
      return true;
    });
    return { ...section, id, families, creatures };
  });
}

/**
 * Incoming sections match an existing one by id first; only an incoming
 * section without an id match falls back to a same-named collection, and
 * each existing collection absorbs at most one incoming section.
 */
function matchSnapshotSections(existingSections, incoming) {
  const matches = new Map();
  const claimed = new Set();
  for (const section of incoming) {
    const byId = existingSections.find(item => item.id === section.id);
    if (byId && !claimed.has(byId)) {
      matches.set(section, byId);
      claimed.add(byId);
    }
  }
  for (const section of incoming) {
    if (matches.has(section)) continue;
    const byName = existingSections.find(item => !claimed.has(item) && item.name === section.name);
    if (byName) {
      matches.set(section, byName);
      claimed.add(byName);
    }
  }
  return { matches };
}

function mergeSectionInto(existing, incoming, now) {
  const familyIdMap = new Map();
  for (const family of incoming.families) {
    const match = existing.families.find(item => item.id === family.id)
      ?? existing.families.find(item => item.name === family.name);
    if (match) {
      familyIdMap.set(family.id, match.id);
      continue;
    }
    familyIdMap.set(family.id, family.id);
    existing.families.push({ ...family, updatedAt: now() });
  }
  for (const entry of incoming.creatures) {
    if (existing.creatures.some(item => item.uuid === entry.uuid)) continue;
    existing.creatures.push({
      ...entry,
      familyId: entry.familyId ? familyIdMap.get(entry.familyId) ?? null : null,
      addedAt: entry.addedAt || now()
    });
  }
  existing.updatedAt = now();
}
