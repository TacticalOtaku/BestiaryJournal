import test from "node:test";
import assert from "node:assert/strict";

import { getBestiarySocial, handleBestiaryStoreSocket } from "../scripts/foundry/bestiary-store.js";
import { migrateSocialToJournalStore, registerNoteStoreHooks } from "../scripts/foundry/note-store.js";
import { hideNoteStoreEntries } from "../scripts/foundry/journal-directory.js";

const MODULE_ID = "bestiary-journal";
const UUID = "Actor.goblin";
let testSeq = 0;

/**
 * In-memory Foundry JournalEntry + JournalEntryPage stand-in that enforces
 * Foundry's top-level document ownership rules when viewing as any user.
 */
function setupJournalWorld({ initialLegacyComments = [] } = {}) {
  const settings = {
    bestiaryData: {
      sections: [{ id: "s1", name: "Caves", creatures: [{ uuid: UUID }] }],
    },
    bestiaryKnowledge: { revision: 0, users: {} },
    bestiarySocial: { revision: initialLegacyComments.length ? 3 : 0, comments: initialLegacyComments },
    tierBlockConfig: {},
    researchRollEnabled: true,
    researchSingleAttempt: false,
    includeCustomSkills: false,
  };
  const flags = {};
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const p1 = { id: "p1", name: "Alice", isGM: false, active: true };
  const p2 = { id: "p2", name: "Bob", isGM: false, active: true };
  const users = [gm, p1, p2].map((user) => ({
    ...user,
    getFlag: (_scope, key) => flags[`${user.id}.${key}`],
    unsetFlag: async (_scope, key) => delete flags[`${user.id}.${key}`],
  }));

  const journalDocs = [];
  const emitted = [];
  const hookListeners = new Map();
  const firedHooks = [];

  function makePage(parent, data) {
    const page = {
      id: data._id ?? `page${++testSeq}`,
      parent,
      name: data.name,
      type: data.type,
      text: structuredClone(data.text ?? {}),
      flags: structuredClone(data.flags ?? {}),
      getFlag: (scope, key) => page.flags?.[scope]?.[key],
    };
    return page;
  }

  function makeJournal(data) {
    const pages = [];
    const doc = {
      id: `je${++testSeq}`,
      name: data.name,
      ownership: structuredClone(data.ownership ?? { default: 0 }),
      sort: data.sort ?? 0,
      flags: structuredClone(data.flags ?? {}),
      getFlag: (scope, key) => doc.flags?.[scope]?.[key],
      pages: {
        get contents() {
          return pages;
        },
        [Symbol.iterator]: () => pages[Symbol.iterator](),
      },
      createEmbeddedDocuments: async (_type, items, options = {}) => {
        const created = items.map((item) => makePage(doc, item));
        pages.push(...created);
        for (const page of created) {
          for (const fn of hookListeners.get("createJournalEntryPage") ?? []) fn(page, options, "gm");
        }
        return created;
      },
      updateEmbeddedDocuments: async (_type, patches, options = {}) => {
        const updated = [];
        for (const patch of patches) {
          const page = pages.find((item) => item.id === patch._id);
          if (!page) continue;
          if ("text.content" in patch) page.text.content = patch["text.content"];
          const flagPrefix = `flags.${MODULE_ID}.`;
          for (const [key, val] of Object.entries(patch)) {
            if (!key.startsWith(flagPrefix)) continue;
            const flagKey = key.slice(flagPrefix.length);
            page.flags[MODULE_ID] ??= {};
            page.flags[MODULE_ID][flagKey] = structuredClone(val);
          }
          updated.push(page);
          for (const fn of hookListeners.get("updateJournalEntryPage") ?? []) fn(page, patch, options, "gm");
        }
        return updated;
      },
      deleteEmbeddedDocuments: async (_type, ids, options = {}) => {
        const removed = [];
        for (const id of ids) {
          const idx = pages.findIndex((item) => item.id === id);
          if (idx === -1) continue;
          const [page] = pages.splice(idx, 1);
          removed.push(page);
          for (const fn of hookListeners.get("deleteJournalEntryPage") ?? []) fn(page, options, "gm");
        }
        return removed;
      },
    };
    return doc;
  }

  function canUserReadJournal(doc, user) {
    if (user.isGM) return true;
    const level = doc.ownership?.[user.id] ?? doc.ownership?.default ?? 0;
    return level >= 1;
  }

  let activeReader = gm;
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
    JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 },
  };
  globalThis.JournalEntry = {
    create: async (data) => {
      const doc = makeJournal(data);
      journalDocs.push(doc);
      return doc;
    },
  };
  globalThis.foundry = {
    utils: {
      randomID: () => `id${++testSeq}`,
      escapeHTML: (value) =>
        String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    },
  };
  globalThis.Hooks = {
    on: (name, fn) => {
      const list = hookListeners.get(name) ?? [];
      list.push(fn);
      hookListeners.set(name, list);
    },
    callAll: (name, payload) => firedHooks.push({ name, payload }),
  };
  globalThis.game = {
    get user() {
      return activeReader;
    },
    users: {
      contents: users,
      get: (id) => users.find((user) => user.id === id) ?? null,
      filter: (fn) => users.filter(fn),
    },
    journal: {
      get contents() {
        return journalDocs.filter((doc) => canUserReadJournal(doc, activeReader));
      },
      get: (id) => {
        const doc = journalDocs.find((entry) => entry.id === id);
        return doc && canUserReadJournal(doc, activeReader) ? doc : undefined;
      },
    },
    settings: {
      get: (_scope, key) => structuredClone(settings[key]),
      set: async (_scope, key, value) => {
        settings[key] = structuredClone(value);
      },
    },
    socket: { emit: (_name, msg) => emitted.push(msg) },
    i18n: { localize: (key) => key, format: (key) => key, has: () => false },
  };

  async function send(requesterId, command) {
    const requestId = `req-${++testSeq}`;
    flags[`${requesterId}.commandRequest`] = JSON.stringify({ requestId, command, issuedAt: Date.now() });
    await handleBestiaryStoreSocket({ action: "bestiaryCommand", requestId, requesterId });
    return emitted.at(-1);
  }

  function asUser(userId, fn) {
    const previous = activeReader;
    activeReader = users.find((user) => user.id === userId);
    try {
      return fn();
    } finally {
      activeReader = previous;
    }
  }

  return { settings, journalDocs, emitted, firedHooks, hookListeners, send, asUser };
}

test("notes are stored in permission-scoped JournalEntries so players cannot read others' private or GM notes", async () => {
  const world = setupJournalWorld();

  await world.send("p1", { type: "addComment", uuid: UUID, channel: "private", text: "Alice secret" });
  await world.send("p2", { type: "addComment", uuid: UUID, channel: "private", text: "Bob secret" });
  await world.send("gm", { type: "addComment", uuid: UUID, channel: "gm", text: "GM secret", shared: false });
  await world.send("p1", { type: "addComment", uuid: UUID, channel: "party", text: "Shared clue" });

  // World setting bestiarySocial remains untouched / empty
  assert.deepEqual(world.settings.bestiarySocial.comments, []);

  // Ownership levels on created JournalEntries
  const p1Store = world.journalDocs.find(
    (doc) =>
      doc.getFlag(MODULE_ID, "noteScope") === "private" && doc.getFlag(MODULE_ID, "noteOwnerId") === "p1",
  );
  const gmStore = world.journalDocs.find((doc) => doc.getFlag(MODULE_ID, "noteScope") === "gm");
  const partyStore = world.journalDocs.find((doc) => doc.getFlag(MODULE_ID, "noteScope") === "party");
  assert.deepEqual(p1Store.ownership, { default: 0, p1: 2 });
  assert.deepEqual(gmStore.ownership, { default: 0 });
  assert.deepEqual(partyStore.ownership, { default: 2 });

  // Alice sees ONLY Alice secret + Shared clue (never Bob secret or GM secret)
  const aliceNotes = world.asUser("p1", () => getBestiarySocial().comments.map((c) => c.text));
  assert.deepEqual(aliceNotes, ["Alice secret", "Shared clue"]);

  // Bob sees ONLY Bob secret + Shared clue
  const bobNotes = world.asUser("p2", () => getBestiarySocial().comments.map((c) => c.text));
  assert.deepEqual(bobNotes, ["Bob secret", "Shared clue"]);

  // GM sees everything
  const gmNotes = world.asUser("gm", () => getBestiarySocial().comments.map((c) => c.text));
  assert.deepEqual(gmNotes.toSorted(), ["Alice secret", "Bob secret", "GM secret", "Shared clue"].toSorted());

  // Private/GM note changes never broadcast refreshBestiary over module socket
  const socketRefreshes = world.emitted.filter((msg) => msg.action === "refreshBestiary");
  assert.equal(socketRefreshes.length, 0);
});

test("sharing and unsharing a GM note moves only that page between GM and Party stores", async () => {
  const world = setupJournalWorld();

  await world.send("gm", {
    type: "addComment",
    uuid: UUID,
    channel: "gm",
    text: "Weak to fire",
    shared: false,
  });
  const gmNoteId = world.asUser("gm", () => getBestiarySocial().comments[0].id);
  assert.deepEqual(
    world.asUser("p1", () => getBestiarySocial().comments),
    [],
  );

  // Share with players -> moves page to party JournalEntry
  await world.send("gm", { type: "updateComment", commentId: gmNoteId, patch: { shared: true } });
  const gmStore = world.journalDocs.find((doc) => doc.getFlag(MODULE_ID, "noteScope") === "gm");
  const partyStore = world.journalDocs.find((doc) => doc.getFlag(MODULE_ID, "noteScope") === "party");
  assert.equal(gmStore.pages.contents.length, 0);
  assert.equal(partyStore.pages.contents.length, 1);
  assert.deepEqual(
    world.asUser("p1", () => getBestiarySocial().comments.map((c) => c.text)),
    ["Weak to fire"],
  );

  // Unshare -> moves page back to GM-only JournalEntry
  await world.send("gm", { type: "updateComment", commentId: gmNoteId, patch: { shared: false } });
  assert.equal(gmStore.pages.contents.length, 1);
  assert.equal(partyStore.pages.contents.length, 0);
  assert.deepEqual(
    world.asUser("p1", () => getBestiarySocial().comments),
    [],
  );

  // Edit text in-place -> updates existing page without duplicating
  await world.send("gm", { type: "updateComment", commentId: gmNoteId, patch: { text: "Weak to acid" } });
  assert.equal(gmStore.pages.contents.length, 1);
  assert.equal(gmStore.pages.contents[0].getFlag(MODULE_ID, "comment").text, "Weak to acid");

  // Delete -> removes only that page
  await world.send("gm", { type: "deleteComment", commentId: gmNoteId });
  assert.equal(gmStore.pages.contents.length, 0);
});

test("migrateSocialToJournalStore moves legacy bestiarySocial notes and clears the setting", async () => {
  const world = setupJournalWorld({
    initialLegacyComments: [
      {
        id: "c1",
        uuid: UUID,
        authorId: "p1",
        channel: "private",
        shared: false,
        pinned: false,
        text: "P1",
        createdAt: 1,
      },
      {
        id: "c2",
        uuid: UUID,
        authorId: "gm",
        channel: "gm",
        shared: false,
        pinned: true,
        text: "GM",
        createdAt: 2,
      },
      {
        id: "c3",
        uuid: UUID,
        authorId: "p2",
        channel: "party",
        shared: false,
        pinned: false,
        text: "Party",
        createdAt: 3,
      },
    ],
  });

  const migrated = await migrateSocialToJournalStore();
  assert.equal(migrated, true);
  assert.deepEqual(world.settings.bestiarySocial, { revision: 0, comments: [] });
  assert.deepEqual(
    world.asUser("p1", () => getBestiarySocial().comments.map((c) => c.text)),
    ["P1", "Party"],
  );
  assert.deepEqual(
    world.asUser("gm", () => getBestiarySocial().comments.map((c) => c.text)),
    ["P1", "GM", "Party"],
  );

  // Running again is a no-op
  assert.equal(await migrateSocialToJournalStore(), false);
});

test("migrateSocialToJournalStore retains legacy comments on failure and resumes without duplicates", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
  const world = setupJournalWorld({
    initialLegacyComments: [
      {
        id: "c1",
        uuid: UUID,
        authorId: "p1",
        channel: "private",
        shared: false,
        pinned: false,
        text: "P1",
        createdAt: 1,
      },
      {
        id: "c2",
        uuid: UUID,
        authorId: "gm",
        channel: "gm",
        shared: false,
        pinned: false,
        text: "GM",
        createdAt: 2,
      },
    ],
  });

  const realCreate = globalThis.JournalEntry.create;
  let calls = 0;
  globalThis.JournalEntry.create = async (data) => {
    if (++calls === 2) throw new Error("storage busy");
    return realCreate(data);
  };

  assert.equal(await migrateSocialToJournalStore(), false);
  assert.equal(
    world.settings.bestiarySocial.comments.length,
    2,
    "legacy setting preserved until full migration",
  );

  globalThis.JournalEntry.create = realCreate;
  assert.equal(await migrateSocialToJournalStore(), true);
  assert.deepEqual(world.settings.bestiarySocial, { revision: 0, comments: [] });
  assert.deepEqual(
    world.asUser("gm", () => getBestiarySocial().comments.map((c) => c.id)),
    ["c1", "c2"],
  );
});

test("remote JournalEntryPage hooks refresh views while internal writes are ignored", async () => {
  const world = setupJournalWorld();
  registerNoteStoreHooks();

  await world.send("p1", { type: "addComment", uuid: UUID, channel: "party", text: "Note" });
  const internalHooks = world.firedHooks.filter((h) => h.name === "bestiaryJournalRefresh");
  assert.equal(internalHooks.length, 1, "local write triggers refresh once through persistCommand");

  // Simulate remote Foundry sync arriving on a player client (without bestiaryJournalInternal)
  const partyStore = world.journalDocs.find((doc) => doc.getFlag(MODULE_ID, "noteScope") === "party");
  const page = partyStore.pages.contents[0];
  for (const fn of world.hookListeners.get("updateJournalEntryPage") ?? []) {
    fn(page, {}, {}, "gm");
  }
  assert.equal(
    world.firedHooks.filter((h) => h.name === "bestiaryJournalRefresh").length,
    2,
    "remote page update fires bestiaryJournalRefresh",
  );
});

test("hideNoteStoreEntries removes internal note-store JournalEntries from the Journals directory DOM", async () => {
  const world = setupJournalWorld();
  await world.send("gm", { type: "addComment", uuid: UUID, channel: "gm", text: "Hidden", shared: false });
  const gmStore = world.journalDocs[0];
  const normalJournal = await globalThis.JournalEntry.create({
    name: "Session Log",
    ownership: { default: 2 },
    flags: {},
  });

  const removed = [];
  const makeItem = (id) => ({
    dataset: { entryId: id },
    remove: () => removed.push(id),
  });
  const root = {
    querySelectorAll: () => [makeItem(gmStore.id), makeItem(normalJournal.id)],
  };

  hideNoteStoreEntries(root);
  assert.deepEqual(removed, [gmStore.id]);
});
