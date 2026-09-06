import {
  GM_TIER,
  MAX_RESEARCH_TIER,
  MIN_RESEARCH_TIER,
  clampKnownTier,
  clampTier
} from "./research-model.mjs";

/**
 * Pure bestiary rules: normalization, selectors and the command reducer.
 *
 * The world state is split across three stores so a chat comment does not
 * rewrite the whole structure blob:
 *   data      – sections, families, creature entries, locks, tier overrides
 *   knowledge – what each user has researched
 *   social    – comments and the share log
 */

export const STORE_KEYS = Object.freeze(["data", "knowledge", "social"]);

export const BESTIARY_COMMANDS = Object.freeze({
  CREATE_SECTION: "createSection",
  UPDATE_SECTION: "updateSection",
  DELETE_SECTION: "deleteSection",
  TOGGLE_SECTION_VISIBILITY: "toggleSectionVisibility",
  SET_SECTION_LOCK: "setSectionLock",
  REORDER_SECTIONS: "reorderSections",

  CREATE_FAMILY: "createFamily",
  UPDATE_FAMILY: "updateFamily",
  DELETE_FAMILY: "deleteFamily",

  ADD_CREATURE: "addCreature",
  ADD_CREATURES: "addCreatures",
  REMOVE_CREATURE: "removeCreature",
  TOGGLE_CREATURE_VISIBILITY: "toggleCreatureVisibility",
  UPDATE_CREATURE_ENTRY: "updateCreatureEntry",
  SET_CREATURE_LOCK: "setCreatureLock",
  MOVE_CREATURE: "moveCreature",
  IMPORT_SNAPSHOT: "importSnapshot",

  SET_KNOWLEDGE: "setKnowledge",
  RESET_KNOWLEDGE: "resetKnowledge",
  RECORD_RESEARCH: "recordResearch",
  SHARE_KNOWLEDGE: "shareKnowledge",

  ADD_COMMENT: "addComment",
  UPDATE_COMMENT: "updateComment",
  DELETE_COMMENT: "deleteComment",
  TOGGLE_COMMENT_PIN: "toggleCommentPin"
});

/** Commands a non-GM user may request from the authoritative GM. */
export const PLAYER_COMMANDS = Object.freeze(new Set([
  BESTIARY_COMMANDS.RECORD_RESEARCH,
  BESTIARY_COMMANDS.SHARE_KNOWLEDGE,
  BESTIARY_COMMANDS.ADD_COMMENT,
  BESTIARY_COMMANDS.UPDATE_COMMENT,
  BESTIARY_COMMANDS.DELETE_COMMENT
]));

export const COMMENT_CHANNELS = Object.freeze(["gm", "private", "party"]);
export const IMAGE_SOURCES = Object.freeze(["portrait", "token"]);
export const IMAGE_FITS = Object.freeze(["auto", "contain", "cover"]);

// ── Normalization ──────────────────────────────────────────────────────────

export function normalizeBestiaryData(value) {
  const source = isObject(value) ? value : {};
  const sections = Array.isArray(source.sections) ? source.sections : [];
  return {
    revision: safeInt(source.revision, 0),
    sections: sections.map((section, index) => normalizeSection(section, index))
  };
}

function normalizeSection(value, index = 0) {
  const source = isObject(value) ? value : {};
  const families = Array.isArray(source.families) ? source.families : [];
  const creatures = Array.isArray(source.creatures) ? source.creatures : [];
  return {
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    image: String(source.image ?? ""),
    hidden: !!source.hidden,
    locked: !!source.locked,
    sort: safeInt(source.sort, index * 100),
    updatedAt: safeInt(source.updatedAt, 0),
    families: families.map((family, familyIndex) => normalizeFamily(family, familyIndex)),
    creatures: creatures.map(entry => normalizeCreatureEntry(entry))
  };
}

function normalizeFamily(value, index = 0) {
  const source = isObject(value) ? value : {};
  return {
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    image: String(source.image ?? ""),
    hidden: !!source.hidden,
    sort: safeInt(source.sort, index * 100),
    updatedAt: safeInt(source.updatedAt, 0)
  };
}

export function normalizeCreatureEntry(value) {
  const source = isObject(value) ? value : {};
  const image = isObject(source.image) ? source.image : {};
  const research = isObject(source.research) ? source.research : {};
  return {
    uuid: String(source.uuid ?? ""),
    addedAt: safeInt(source.addedAt, 0),
    hidden: !!source.hidden,
    locked: !!source.locked,
    familyId: source.familyId ? String(source.familyId) : null,
    label: String(source.label ?? source.name ?? ""),
    thumb: String(source.thumb ?? ""),
    image: {
      source: IMAGE_SOURCES.includes(image.source) ? image.source : "portrait",
      fit: IMAGE_FITS.includes(image.fit) ? image.fit : "auto",
      focusX: clampPercent(image.focusX, 50),
      focusY: clampPercent(image.focusY, 50)
    },
    research: {
      dc: research.dc === null || research.dc === undefined || research.dc === ""
        ? null
        : safeInt(research.dc, 10),
      skills: Array.isArray(research.skills)
        ? research.skills.filter(skill => typeof skill === "string" && skill)
        : []
    },
    blockTiers: normalizeTierMap(source.blockTiers),
    itemTiers: normalizeTierMap(source.itemTiers)
  };
}

function normalizeTierMap(value) {
  if (!isObject(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || !key) continue;
    result[key] = clampTier(raw, MIN_RESEARCH_TIER);
  }
  return result;
}

export function normalizeKnowledge(value) {
  const source = isObject(value) ? value : {};
  const users = isObject(source.users) ? source.users : {};
  const normalized = {};
  for (const [userId, records] of Object.entries(users)) {
    if (!isObject(records)) continue;
    const bucket = {};
    for (const [uuid, record] of Object.entries(records)) {
      if (!isObject(record)) continue;
      bucket[uuid] = normalizeKnowledgeRecord(record);
    }
    normalized[userId] = bucket;
  }
  return { revision: safeInt(source.revision, 0), users: normalized };
}

function normalizeKnowledgeRecord(value) {
  const source = isObject(value) ? value : {};
  return {
    tier: clampKnownTier(source.tier, MIN_RESEARCH_TIER),
    source: String(source.source ?? "gm"),
    updatedAt: safeInt(source.updatedAt, 0),
    grantedBy: source.grantedBy ? String(source.grantedBy) : null,
    attempts: safeInt(source.attempts, 0),
    blocked: !!source.blocked,
    lastRoll: isObject(source.lastRoll)
      ? {
          total: safeInt(source.lastRoll.total, 0),
          dc: safeInt(source.lastRoll.dc, 0),
          success: !!source.lastRoll.success,
          skill: String(source.lastRoll.skill ?? ""),
          at: safeInt(source.lastRoll.at, 0)
        }
      : null
  };
}

export function normalizeSocial(value) {
  const source = isObject(value) ? value : {};
  const comments = Array.isArray(source.comments) ? source.comments : [];
  const shares = Array.isArray(source.shares) ? source.shares : [];
  return {
    revision: safeInt(source.revision, 0),
    comments: comments.filter(isObject).map(normalizeComment),
    shares: shares.filter(isObject).map(normalizeShare)
  };
}

function normalizeComment(value) {
  return {
    id: String(value.id ?? ""),
    uuid: String(value.uuid ?? ""),
    authorId: String(value.authorId ?? ""),
    channel: COMMENT_CHANNELS.includes(value.channel) ? value.channel : "private",
    shared: !!value.shared,
    pinned: !!value.pinned,
    text: String(value.text ?? ""),
    createdAt: safeInt(value.createdAt, 0),
    editedAt: value.editedAt ? safeInt(value.editedAt, 0) : null
  };
}

function normalizeShare(value) {
  return {
    id: String(value.id ?? ""),
    uuid: String(value.uuid ?? ""),
    fromUserId: String(value.fromUserId ?? ""),
    toUserId: String(value.toUserId ?? ""),
    tier: clampKnownTier(value.tier, MIN_RESEARCH_TIER),
    at: safeInt(value.at, 0)
  };
}

export function createBestiaryState(sources = {}) {
  return {
    data: normalizeBestiaryData(sources.data),
    knowledge: normalizeKnowledge(sources.knowledge),
    social: normalizeSocial(sources.social)
  };
}

// ── Viewer helpers ─────────────────────────────────────────────────────────

export function isGameMaster(viewer) {
  if (typeof viewer === "boolean") return viewer;
  return !!viewer?.isGM;
}

function viewerId(viewer) {
  if (typeof viewer === "boolean" || !viewer) return "";
  return String(viewer.id ?? "");
}

export function isSectionVisible(section, viewer) {
  return isGameMaster(viewer) || !section?.hidden;
}

export function isFamilyVisible(family, viewer) {
  return isGameMaster(viewer) || !family?.hidden;
}

export function isCreatureEntryVisible(entry, section, viewer) {
  if (isGameMaster(viewer)) return true;
  if (entry?.hidden) return false;
  if (!entry?.familyId) return true;
  const family = section?.families?.find(item => item.id === entry.familyId);
  return !family?.hidden;
}

export function selectVisibleSections(data, viewer) {
  return normalizeBestiaryData(data).sections
    .filter(section => isSectionVisible(section, viewer))
    .sort((left, right) => left.sort - right.sort);
}

export function selectVisibleFamilies(section, viewer) {
  return (section?.families ?? [])
    .filter(family => isFamilyVisible(family, viewer))
    .sort((left, right) => left.sort - right.sort);
}

export function selectVisibleCreatureEntries(section, viewer) {
  return (section?.creatures ?? [])
    .filter(entry => isCreatureEntryVisible(entry, section, viewer));
}

export function findSection(data, sectionId) {
  return data?.sections?.find(section => section.id === sectionId) ?? null;
}

export function findFamily(section, familyId) {
  return section?.families?.find(family => family.id === familyId) ?? null;
}

/** All (section, entry) pairs holding this creature — it may live in several. */
export function getEntryContexts(data, uuid) {
  const contexts = [];
  for (const section of normalizeBestiaryData(data).sections) {
    for (const entry of section.creatures) {
      if (entry.uuid === uuid) contexts.push({ section, entry });
    }
  }
  return contexts;
}

export function findCreatureEntry(data, uuid) {
  return getEntryContexts(data, uuid)[0]?.entry ?? null;
}

/**
 * A sheet counts as locked when the creature entry or its section is locked
 * anywhere in the bestiary. Locking freezes assignments and comments for
 * everyone; the GM has to lift the lock first.
 */
export function isCreatureLocked(data, uuid) {
  return getEntryContexts(data, uuid)
    .some(({ section, entry }) => entry.locked || section.locked);
}

export function canViewCreature(data, uuid, viewer) {
  if (!uuid) return false;
  if (isGameMaster(viewer)) return true;
  return getEntryContexts(data, uuid)
    .some(({ section, entry }) => isSectionVisible(section, viewer)
      && isCreatureEntryVisible(entry, section, viewer));
}

export function getCreatureCollections(data, uuid, viewer) {
  return getEntryContexts(data, uuid)
    .filter(({ section, entry }) => isSectionVisible(section, viewer)
      && isCreatureEntryVisible(entry, section, viewer))
    .map(({ section, entry }) => ({
      sectionId: section.id,
      sectionName: section.name,
      familyName: findFamily(section, entry.familyId)?.name ?? ""
    }));
}

/** Flattens every visible entry of every section into one row per creature. */
export function mergeCreatureEntries(sections, viewer) {
  const entries = new Map();
  for (const section of sections ?? []) {
    for (const entry of selectVisibleCreatureEntries(section, viewer)) {
      const current = entries.get(entry.uuid) ?? {
        uuid: entry.uuid,
        addedAt: 0,
        label: entry.label,
        collections: [],
        entry
      };
      current.addedAt = Math.max(current.addedAt, entry.addedAt ?? 0);
      current.collections.push(section.name);
      entries.set(entry.uuid, current);
    }
  }
  return [...entries.values()];
}

// ── Knowledge selectors ────────────────────────────────────────────────────

export function getKnowledgeRecord(knowledge, userId, uuid) {
  return knowledge?.users?.[userId]?.[uuid] ?? null;
}

export function getUserTier(knowledge, userId, uuid) {
  return clampKnownTier(getKnowledgeRecord(knowledge, userId, uuid)?.tier, MIN_RESEARCH_TIER);
}

export function getViewerTier(knowledge, uuid, viewer) {
  if (isGameMaster(viewer)) return GM_TIER;
  return getUserTier(knowledge, viewerId(viewer), uuid);
}

/** Tier assignments for a whole roster, used by the GM assignment board. */
export function getTierRoster(knowledge, uuid, users) {
  return (users ?? []).map(user => ({
    ...user,
    tier: getUserTier(knowledge, user.id, uuid),
    record: getKnowledgeRecord(knowledge, user.id, uuid)
  }));
}

// ── Comment selectors ──────────────────────────────────────────────────────

export function canSeeComment(comment, viewer) {
  const isGM = isGameMaster(viewer);
  const id = viewerId(viewer);
  if (comment.channel === "gm") return isGM || comment.shared;
  if (comment.channel === "private") return comment.authorId === id;
  return true;
}

export function canEditComment(comment, viewer) {
  if (comment.authorId === viewerId(viewer)) return true;
  return isGameMaster(viewer) && comment.channel !== "private";
}

export function selectComments(social, uuid, viewer) {
  return normalizeSocial(social).comments
    .filter(comment => comment.uuid === uuid && canSeeComment(comment, viewer))
    .sort((left, right) => (right.pinned - left.pinned) || (left.createdAt - right.createdAt));
}

export function countComments(social, uuid, viewer) {
  return selectComments(social, uuid, viewer).length;
}

export function selectShareLog(social, uuid) {
  return normalizeSocial(social).shares
    .filter(share => !uuid || share.uuid === uuid)
    .sort((left, right) => right.at - left.at);
}

// ── Command reducer ────────────────────────────────────────────────────────

export function applyBestiaryCommand(currentState, command, dependencies = {}) {
  const state = cloneState(currentState);
  const handler = COMMAND_HANDLERS[command?.type];
  if (!handler) throw new Error(`Unknown bestiary command: ${command?.type ?? "<empty>"}`);

  const context = {
    now: dependencies.now ?? Date.now,
    generateId: dependencies.generateId ?? (() => Math.random().toString(36).slice(2, 18))
  };
  const touched = handler(state, command, context) || [];
  const changed = Object.fromEntries(STORE_KEYS.map(key => [key, touched.includes(key)]));
  for (const key of STORE_KEYS) {
    if (changed[key]) state[key].revision += 1;
  }
  return { state, changed, changedAny: STORE_KEYS.some(key => changed[key]) };
}

const TOUCHED_DATA = ["data"];
const TOUCHED_KNOWLEDGE = ["knowledge"];
const TOUCHED_SOCIAL = ["social"];
const TOUCHED_NONE = [];

const COMMAND_HANDLERS = {
  [BESTIARY_COMMANDS.CREATE_SECTION]: handleCreateSection,
  [BESTIARY_COMMANDS.UPDATE_SECTION]: handleUpdateSection,
  [BESTIARY_COMMANDS.DELETE_SECTION]: handleDeleteSection,
  [BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY]: handleToggleSectionVisibility,
  [BESTIARY_COMMANDS.SET_SECTION_LOCK]: handleSetSectionLock,
  [BESTIARY_COMMANDS.REORDER_SECTIONS]: handleReorderSections,

  [BESTIARY_COMMANDS.CREATE_FAMILY]: handleCreateFamily,
  [BESTIARY_COMMANDS.UPDATE_FAMILY]: handleUpdateFamily,
  [BESTIARY_COMMANDS.DELETE_FAMILY]: handleDeleteFamily,

  [BESTIARY_COMMANDS.ADD_CREATURE]: handleAddCreature,
  [BESTIARY_COMMANDS.ADD_CREATURES]: handleAddCreatures,
  [BESTIARY_COMMANDS.REMOVE_CREATURE]: handleRemoveCreature,
  [BESTIARY_COMMANDS.TOGGLE_CREATURE_VISIBILITY]: handleToggleCreatureVisibility,
  [BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY]: handleUpdateCreatureEntry,
  [BESTIARY_COMMANDS.SET_CREATURE_LOCK]: handleSetCreatureLock,
  [BESTIARY_COMMANDS.MOVE_CREATURE]: handleMoveCreature,
  [BESTIARY_COMMANDS.IMPORT_SNAPSHOT]: handleImportSnapshot,

  [BESTIARY_COMMANDS.SET_KNOWLEDGE]: handleSetKnowledge,
  [BESTIARY_COMMANDS.RESET_KNOWLEDGE]: handleResetKnowledge,
  [BESTIARY_COMMANDS.RECORD_RESEARCH]: handleRecordResearch,
  [BESTIARY_COMMANDS.SHARE_KNOWLEDGE]: handleShareKnowledge,

  [BESTIARY_COMMANDS.ADD_COMMENT]: handleAddComment,
  [BESTIARY_COMMANDS.UPDATE_COMMENT]: handleUpdateComment,
  [BESTIARY_COMMANDS.DELETE_COMMENT]: handleDeleteComment,
  [BESTIARY_COMMANDS.TOGGLE_COMMENT_PIN]: handleToggleCommentPin
};

// ── Section handlers ──

function handleCreateSection(state, command, { now, generateId }) {
  const source = command.section ?? {};
  const id = source.id || generateId();
  const maxSort = state.data.sections.reduce((max, section) => Math.max(max, section.sort), 0);
  state.data.sections.push(normalizeSection({
    ...source,
    id,
    sort: maxSort + 100,
    updatedAt: now(),
    families: [],
    creatures: []
  }));
  return TOUCHED_DATA;
}

function handleUpdateSection(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  if (!section || section.locked) return TOUCHED_NONE;
  const patch = command.patch ?? {};
  if ("name" in patch) section.name = String(patch.name ?? "");
  if ("image" in patch) section.image = String(patch.image ?? "");
  if ("hidden" in patch) section.hidden = !!patch.hidden;
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleDeleteSection(state, command) {
  const section = findSection(state.data, command.sectionId);
  if (!section || section.locked) return TOUCHED_NONE;
  state.data.sections = state.data.sections.filter(item => item.id !== command.sectionId);
  return TOUCHED_DATA;
}

function handleToggleSectionVisibility(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  if (!section) return TOUCHED_NONE;
  section.hidden = typeof command.hidden === "boolean" ? command.hidden : !section.hidden;
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleSetSectionLock(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  if (!section) return TOUCHED_NONE;
  const locked = typeof command.locked === "boolean" ? command.locked : !section.locked;
  if (section.locked === locked) return TOUCHED_NONE;
  section.locked = locked;
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleReorderSections(state, command) {
  const order = Array.isArray(command.order) ? command.order : [];
  if (!order.length) return TOUCHED_NONE;
  let changed = false;
  order.forEach((sectionId, index) => {
    const section = findSection(state.data, sectionId);
    if (!section) return;
    const sort = index * 100;
    if (section.sort !== sort) changed = true;
    section.sort = sort;
  });
  return changed ? TOUCHED_DATA : TOUCHED_NONE;
}

// ── Family handlers ──

function handleCreateFamily(state, command, { now, generateId }) {
  const section = findSection(state.data, command.sectionId);
  if (!section || section.locked) return TOUCHED_NONE;
  const source = command.family ?? {};
  const maxSort = section.families.reduce((max, family) => Math.max(max, family.sort), 0);
  section.families.push(normalizeFamily({
    ...source,
    id: source.id || generateId(),
    sort: maxSort + 100,
    updatedAt: now()
  }));
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleUpdateFamily(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  const family = findFamily(section, command.familyId);
  if (!section || !family || section.locked) return TOUCHED_NONE;
  const patch = command.patch ?? {};
  if ("name" in patch) family.name = String(patch.name ?? "");
  if ("image" in patch) family.image = String(patch.image ?? "");
  if ("hidden" in patch) family.hidden = !!patch.hidden;
  family.updatedAt = now();
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleDeleteFamily(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  if (!section || section.locked || !findFamily(section, command.familyId)) return TOUCHED_NONE;
  section.families = section.families.filter(family => family.id !== command.familyId);
  for (const entry of section.creatures) {
    if (entry.familyId === command.familyId) entry.familyId = null;
  }
  section.updatedAt = now();
  return TOUCHED_DATA;
}

// ── Creature handlers ──

function handleAddCreature(state, command, { now }) {
  return addEntries(state, command.sectionId, [command], command.familyId, now);
}

function handleAddCreatures(state, command, { now }) {
  return addEntries(state, command.sectionId, command.entries ?? [], command.familyId, now);
}

function addEntries(state, sectionId, sources, familyId, now) {
  const section = findSection(state.data, sectionId);
  if (!section || section.locked) return TOUCHED_NONE;
  const family = familyId ? findFamily(section, familyId) : null;
  let changed = false;
  for (const source of sources) {
    const uuid = String(source?.uuid ?? "");
    if (!uuid || section.creatures.some(entry => entry.uuid === uuid)) continue;
    section.creatures.push(normalizeCreatureEntry({
      ...source,
      uuid,
      addedAt: now(),
      hidden: !!source.hidden,
      familyId: family?.id ?? null
    }));
    changed = true;
  }
  if (changed) section.updatedAt = now();
  return changed ? TOUCHED_DATA : TOUCHED_NONE;
}

function handleRemoveCreature(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  if (!section || section.locked) return TOUCHED_NONE;
  const entry = section.creatures.find(item => item.uuid === command.uuid);
  if (!entry || entry.locked) return TOUCHED_NONE;
  section.creatures = section.creatures.filter(item => item.uuid !== command.uuid);
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleToggleCreatureVisibility(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  const entry = section?.creatures.find(item => item.uuid === command.uuid);
  if (!entry) return TOUCHED_NONE;
  entry.hidden = typeof command.hidden === "boolean" ? command.hidden : !entry.hidden;
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleUpdateCreatureEntry(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  const entry = section?.creatures.find(item => item.uuid === command.uuid);
  if (!entry || section.locked || entry.locked) return TOUCHED_NONE;
  const patch = command.patch ?? {};

  if ("familyId" in patch) {
    const family = patch.familyId ? findFamily(section, patch.familyId) : null;
    entry.familyId = family?.id ?? null;
  }
  if ("hidden" in patch) entry.hidden = !!patch.hidden;
  if ("label" in patch) entry.label = String(patch.label ?? "");
  if ("thumb" in patch) entry.thumb = String(patch.thumb ?? "");
  if (isObject(patch.image)) entry.image = normalizeCreatureEntry({ image: { ...entry.image, ...patch.image } }).image;
  if (isObject(patch.research)) {
    entry.research = normalizeCreatureEntry({
      research: { ...entry.research, ...patch.research }
    }).research;
  }
  if (isObject(patch.blockTiers)) {
    entry.blockTiers = normalizeTierMap(
      patch.replaceBlockTiers ? patch.blockTiers : { ...entry.blockTiers, ...patch.blockTiers }
    );
  }
  if (isObject(patch.itemTiers)) {
    const merged = patch.replaceItemTiers ? { ...patch.itemTiers } : { ...entry.itemTiers, ...patch.itemTiers };
    for (const [key, value] of Object.entries(patch.itemTiers)) {
      if (value === null) delete merged[key];
    }
    entry.itemTiers = normalizeTierMap(merged);
  }
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleSetCreatureLock(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  const entry = section?.creatures.find(item => item.uuid === command.uuid);
  if (!entry) return TOUCHED_NONE;
  const locked = typeof command.locked === "boolean" ? command.locked : !entry.locked;
  if (entry.locked === locked) return TOUCHED_NONE;
  entry.locked = locked;
  section.updatedAt = now();
  return TOUCHED_DATA;
}

function handleMoveCreature(state, command, { now }) {
  const section = findSection(state.data, command.sectionId);
  const entry = section?.creatures.find(item => item.uuid === command.uuid);
  if (!entry || section.locked || entry.locked) return TOUCHED_NONE;

  const target = command.targetSectionId
    ? findSection(state.data, command.targetSectionId)
    : section;
  if (!target || target.locked) return TOUCHED_NONE;
  const family = command.targetFamilyId ? findFamily(target, command.targetFamilyId) : null;

  if (target.id === section.id) {
    if (entry.familyId === (family?.id ?? null)) return TOUCHED_NONE;
    entry.familyId = family?.id ?? null;
    section.updatedAt = now();
    return TOUCHED_DATA;
  }

  if (target.creatures.some(item => item.uuid === entry.uuid)) return TOUCHED_NONE;
  section.creatures = section.creatures.filter(item => item.uuid !== entry.uuid);
  target.creatures.push({ ...entry, familyId: family?.id ?? null });
  section.updatedAt = now();
  target.updatedAt = now();
  return TOUCHED_DATA;
}

/**
 * Merges an exported snapshot back in. `replace` wipes matching sections first;
 * `merge` keeps existing sections and only appends what is missing.
 */
function handleImportSnapshot(state, command, { now, generateId }) {
  const payload = isObject(command.payload) ? command.payload : {};
  const incoming = normalizeBestiaryData({ sections: payload.sections });
  if (!incoming.sections.length) return TOUCHED_NONE;

  if (command.mode === "replace") {
    state.data.sections = incoming.sections.map(section => ({
      ...section,
      id: section.id || generateId(),
      updatedAt: now()
    }));
    return TOUCHED_DATA;
  }

  for (const section of incoming.sections) {
    const existing = state.data.sections
      .find(item => item.id === section.id || item.name === section.name);
    if (!existing) {
      const maxSort = state.data.sections.reduce((max, item) => Math.max(max, item.sort), 0);
      state.data.sections.push({
        ...section,
        id: section.id || generateId(),
        sort: maxSort + 100,
        updatedAt: now()
      });
      continue;
    }
    if (existing.locked) continue;
    mergeSectionInto(existing, section, now, generateId);
  }
  return TOUCHED_DATA;
}

function mergeSectionInto(existing, incoming, now, generateId) {
  const familyIdMap = new Map();
  for (const family of incoming.families) {
    const match = existing.families.find(item => item.id === family.id || item.name === family.name);
    if (match) {
      familyIdMap.set(family.id, match.id);
      continue;
    }
    const id = family.id || generateId();
    familyIdMap.set(family.id, id);
    existing.families.push({ ...family, id, updatedAt: now() });
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

// ── Knowledge handlers ──

/**
 * Targets come from `userIds` only. `command.userId` is stamped by the store
 * with the id of whoever issued the command, so reading it here would silently
 * redirect a GM's assignment onto the GM themselves.
 */
function handleSetKnowledge(state, command, { now }) {
  const uuids = toArray(command.uuids ?? command.uuid);
  const userIds = toArray(command.userIds);
  if (!uuids.length || !userIds.length) return TOUCHED_NONE;

  let changed = false;
  for (const uuid of uuids) {
    if (isCreatureLocked(state.data, uuid)) continue;
    const tier = clampKnownTier(command.tier, MIN_RESEARCH_TIER);
    for (const userId of userIds) {
      const record = ensureKnowledgeRecord(state.knowledge, userId, uuid);
      if (record.tier === tier && record.source === (command.source ?? "gm")) continue;
      record.tier = tier;
      record.source = command.source ?? "gm";
      // Credit the acting user the store authenticated, not a client claim.
      record.grantedBy = command.userId ?? command.grantedBy ?? null;
      record.updatedAt = now();
      if (tier > MIN_RESEARCH_TIER) record.blocked = false;
      changed = true;
    }
  }
  return changed ? TOUCHED_KNOWLEDGE : TOUCHED_NONE;
}

/** Like setKnowledge, the scope comes from `userIds` only — see above. */
function handleResetKnowledge(state, command) {
  const uuids = toArray(command.uuids ?? command.uuid);
  const userIds = toArray(command.userIds);
  let changed = false;

  for (const [userId, records] of Object.entries(state.knowledge.users)) {
    if (userIds.length && !userIds.includes(userId)) continue;
    for (const uuid of Object.keys(records)) {
      if (uuids.length && !uuids.includes(uuid)) continue;
      delete records[uuid];
      changed = true;
    }
  }
  return changed ? TOUCHED_KNOWLEDGE : TOUCHED_NONE;
}

/**
 * A player rolled to identify a creature. Success raises the tier by one step;
 * a failure only records the attempt (and blocks retries when the world asks
 * for a single attempt).
 */
function handleRecordResearch(state, command, { now }) {
  const userId = String(command.userId ?? "");
  const uuid = String(command.uuid ?? "");
  if (!userId || !uuid) return TOUCHED_NONE;
  if (isCreatureLocked(state.data, uuid)) return TOUCHED_NONE;

  const record = ensureKnowledgeRecord(state.knowledge, userId, uuid);
  if (record.blocked) return TOUCHED_NONE;

  record.attempts += 1;
  record.lastRoll = {
    total: safeInt(command.total, 0),
    dc: safeInt(command.dc, 0),
    success: !!command.success,
    skill: String(command.skill ?? ""),
    at: now()
  };
  if (command.success) {
    record.tier = clampKnownTier(record.tier + 1, MIN_RESEARCH_TIER);
    record.source = "roll";
    // The tier is now earned, so it is no longer attributable to a granter.
    record.grantedBy = null;
    record.blocked = false;
  } else if (command.singleAttempt) {
    record.blocked = true;
  }
  record.updatedAt = now();
  return TOUCHED_KNOWLEDGE;
}

/**
 * Sharing never grants more than the sender knows, and never lowers what the
 * recipient already had.
 */
function handleShareKnowledge(state, command, { now, generateId }) {
  const fromUserId = String(command.userId ?? "");
  const uuid = String(command.uuid ?? "");
  const targets = toArray(command.toUserIds ?? command.toUserId)
    .filter(id => id && id !== fromUserId);
  if (!fromUserId || !uuid || !targets.length) return TOUCHED_NONE;
  if (isCreatureLocked(state.data, uuid)) return TOUCHED_NONE;

  const senderTier = getUserTier(state.knowledge, fromUserId, uuid);
  if (senderTier <= MIN_RESEARCH_TIER) return TOUCHED_NONE;
  const offered = Math.min(senderTier, clampKnownTier(command.tier ?? senderTier, senderTier));

  let changed = false;
  for (const toUserId of targets) {
    const record = ensureKnowledgeRecord(state.knowledge, toUserId, uuid);
    if (record.tier >= offered) continue;
    record.tier = offered;
    record.source = "share";
    record.grantedBy = fromUserId;
    record.blocked = false;
    record.updatedAt = now();
    state.social.shares.push({
      id: generateId(),
      uuid,
      fromUserId,
      toUserId,
      tier: offered,
      at: now()
    });
    changed = true;
  }
  return changed ? ["knowledge", "social"] : TOUCHED_NONE;
}

function ensureKnowledgeRecord(knowledge, userId, uuid) {
  const bucket = knowledge.users[userId] ??= {};
  return bucket[uuid] ??= normalizeKnowledgeRecord({});
}

// ── Comment handlers ──

function handleAddComment(state, command, { now, generateId }) {
  const uuid = String(command.uuid ?? "");
  const text = String(command.text ?? "").trim();
  const authorId = String(command.userId ?? "");
  if (!uuid || !text || !authorId) return TOUCHED_NONE;
  if (isCreatureLocked(state.data, uuid)) return TOUCHED_NONE;

  const channel = COMMENT_CHANNELS.includes(command.channel) ? command.channel : "private";
  if (channel === "gm" && !command.isGM) return TOUCHED_NONE;

  state.social.comments.push(normalizeComment({
    id: generateId(),
    uuid,
    authorId,
    channel,
    shared: channel === "gm" ? !!command.shared : false,
    text,
    createdAt: now()
  }));
  return TOUCHED_SOCIAL;
}

function handleUpdateComment(state, command, { now }) {
  const comment = state.social.comments.find(item => item.id === command.commentId);
  if (!comment || isCreatureLocked(state.data, comment.uuid)) return TOUCHED_NONE;
  if (!canEditComment(comment, { id: command.userId, isGM: command.isGM })) return TOUCHED_NONE;

  const patch = command.patch ?? {};
  let changed = false;
  if ("text" in patch) {
    const text = String(patch.text ?? "").trim();
    if (text && text !== comment.text) {
      comment.text = text;
      changed = true;
    }
  }
  if ("shared" in patch && comment.channel === "gm" && command.isGM) {
    comment.shared = !!patch.shared;
    changed = true;
  }
  if (changed) comment.editedAt = now();
  return changed ? TOUCHED_SOCIAL : TOUCHED_NONE;
}

function handleDeleteComment(state, command) {
  const comment = state.social.comments.find(item => item.id === command.commentId);
  if (!comment || isCreatureLocked(state.data, comment.uuid)) return TOUCHED_NONE;
  if (!canEditComment(comment, { id: command.userId, isGM: command.isGM })) return TOUCHED_NONE;
  state.social.comments = state.social.comments.filter(item => item.id !== command.commentId);
  return TOUCHED_SOCIAL;
}

function handleToggleCommentPin(state, command) {
  const comment = state.social.comments.find(item => item.id === command.commentId);
  if (!comment || !command.isGM) return TOUCHED_NONE;
  if (isCreatureLocked(state.data, comment.uuid)) return TOUCHED_NONE;
  comment.pinned = !comment.pinned;
  return TOUCHED_SOCIAL;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function cloneState(state) {
  const source = state ?? {};
  return {
    data: normalizeBestiaryData(source.data),
    knowledge: normalizeKnowledge(source.knowledge),
    social: normalizeSocial(source.social)
  };
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clampPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
}

export { MAX_RESEARCH_TIER, MIN_RESEARCH_TIER };
