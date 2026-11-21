import { normalizeSocial } from "../core/bestiary-domain.js";
import { log } from "../core/logger.js";

const MODULE_ID = "bestiary-journal";

/** Whether Foundry's JournalEntry collection is active (always true in Foundry; optional in Node tests). */
export function hasJournalNoteStore() {
  return typeof globalThis.JournalEntry?.create === "function" && !!globalThis.game?.journal;
}

export function isNoteStoreJournal(entry) {
  return entry?.getFlag?.(MODULE_ID, "noteStore") === true;
}

export function noteTargetForComment(comment) {
  if (comment?.channel === "private") {
    return { scope: "private", ownerId: String(comment.authorId ?? "") || null };
  }
  if (comment?.channel === "gm" && !comment?.shared) {
    return { scope: "gm", ownerId: null };
  }
  return { scope: "party", ownerId: null };
}

export function ownershipForNoteStore(scope, ownerId = null) {
  const levels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  const NONE = levels?.NONE ?? 0;
  const OBSERVER = levels?.OBSERVER ?? 2;
  if (scope === "party") return { default: OBSERVER };
  if (scope === "private" && ownerId) {
    const hasLookup = typeof globalThis.game?.users?.get === "function";
    if (!hasLookup || globalThis.game.users.get(ownerId)) {
      return { default: NONE, [ownerId]: OBSERVER };
    }
  }
  return { default: NONE };
}

function listNoteJournals() {
  const journal = globalThis.game?.journal;
  if (!journal) return [];
  const entries = journal.contents ?? [...(journal.values?.() ?? journal)];
  return entries.filter(isNoteStoreJournal);
}

function listJournalPages(journal) {
  const pages = journal?.pages;
  if (!pages) return [];
  return pages.contents ?? [...(pages.values?.() ?? pages)];
}

function readCommentFromPage(page) {
  const raw = page?.getFlag?.(MODULE_ID, "comment");
  if (!raw || typeof raw !== "object") return null;
  const normalized = normalizeSocial({ comments: [raw] }).comments[0];
  return normalized?.id ? normalized : null;
}

function pageIndexByCommentId() {
  const index = new Map();
  for (const journal of listNoteJournals()) {
    for (const page of listJournalPages(journal)) {
      const comment = readCommentFromPage(page);
      if (!comment) continue;
      const bucket = index.get(comment.id) ?? [];
      bucket.push({ journal, page, comment });
      index.set(comment.id, bucket);
    }
  }
  return index;
}

function escapePageText(text) {
  const raw = String(text ?? "");
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(raw);
  }
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pageHtmlForComment(comment) {
  const escaped = escapePageText(comment.text).replaceAll("\n", "<br />");
  return `<p>${escaped}</p>`;
}

function buildCommentPayload(comment) {
  return {
    id: comment.id,
    uuid: comment.uuid,
    authorId: comment.authorId,
    channel: comment.channel,
    shared: !!comment.shared,
    pinned: !!comment.pinned,
    text: comment.text,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt ?? null,
  };
}

function buildPageData(comment) {
  const levels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  const formats = globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS;
  return {
    name: `${comment.uuid || "note"} · ${comment.id}`,
    type: "text",
    ownership: { default: levels?.INHERIT ?? -1 },
    text: {
      content: pageHtmlForComment(comment),
      format: formats?.HTML ?? 1,
    },
    flags: {
      [MODULE_ID]: {
        comment: buildCommentPayload(comment),
      },
    },
  };
}

function buildPageUpdate(pageId, comment) {
  return {
    _id: pageId,
    "text.content": pageHtmlForComment(comment),
    [`flags.${MODULE_ID}.comment`]: buildCommentPayload(comment),
  };
}

function noteStoreName(scope, ownerId) {
  if (scope === "gm") return "Bestiary Journal — Notes (GM)";
  if (scope === "party") return "Bestiary Journal — Notes (Party)";
  const user = globalThis.game?.users?.get?.(ownerId);
  return `Bestiary Journal — Notes (${user?.name || ownerId || "User"})`;
}

async function ensureNoteJournal(scope, ownerId = null) {
  const normalizedOwner = ownerId || null;
  const existing = listNoteJournals().find(
    (entry) =>
      entry.getFlag(MODULE_ID, "noteScope") === scope &&
      (entry.getFlag(MODULE_ID, "noteOwnerId") ?? null) === normalizedOwner,
  );
  if (existing) return existing;

  return globalThis.JournalEntry.create({
    name: noteStoreName(scope, normalizedOwner),
    ownership: ownershipForNoteStore(scope, normalizedOwner),
    sort: 999999,
    flags: {
      [MODULE_ID]: {
        noteStore: true,
        noteScope: scope,
        noteOwnerId: normalizedOwner,
      },
    },
  });
}

function commentsEqual(left, right) {
  return (
    left.uuid === right.uuid &&
    left.authorId === right.authorId &&
    left.channel === right.channel &&
    !!left.shared === !!right.shared &&
    !!left.pinned === !!right.pinned &&
    left.text === right.text &&
    left.createdAt === right.createdAt &&
    (left.editedAt ?? null) === (right.editedAt ?? null)
  );
}

/**
 * Reads every note visible to this Foundry client from its scoped JournalEntry
 * stores, merging any unmigrated comments still left in `bestiarySocial`.
 */
export function readJournalSocial() {
  const comments = [];
  const seenIds = new Set();

  for (const journal of listNoteJournals()) {
    for (const page of listJournalPages(journal)) {
      const comment = readCommentFromPage(page);
      if (!comment || seenIds.has(comment.id)) continue;
      seenIds.add(comment.id);
      comments.push(comment);
    }
  }

  const legacy = normalizeSocial(globalThis.game?.settings?.get?.(MODULE_ID, "bestiarySocial"));
  for (const comment of legacy.comments) {
    if (!comment.id || seenIds.has(comment.id)) continue;
    seenIds.add(comment.id);
    comments.push(comment);
  }

  comments.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  return { revision: legacy.revision, comments };
}

/**
 * Persists only the pages touched by one command so editing a comment never
 * rewrites or broadcasts unrelated notes, and private/GM notes stay server-isolated.
 */
export async function syncJournalSocialChanges(beforeSocial, afterSocial) {
  const beforeMap = new Map(normalizeSocial(beforeSocial).comments.map((comment) => [comment.id, comment]));
  const afterMap = new Map(normalizeSocial(afterSocial).comments.map((comment) => [comment.id, comment]));
  const index = pageIndexByCommentId();
  const touchedLegacyIds = new Set();

  for (const [id] of beforeMap) {
    if (afterMap.has(id)) continue;
    touchedLegacyIds.add(id);
    for (const { journal, page } of index.get(id) ?? []) {
      await journal.deleteEmbeddedDocuments("JournalEntryPage", [page.id], {
        bestiaryJournalInternal: true,
      });
    }
  }

  for (const [id, afterComment] of afterMap) {
    const beforeComment = beforeMap.get(id);
    const existing = index.get(id) ?? [];
    if (beforeComment && existing.length === 1 && commentsEqual(beforeComment, afterComment)) {
      const target = noteTargetForComment(afterComment);
      const currentScope = existing[0].journal.getFlag(MODULE_ID, "noteScope");
      const currentOwner = existing[0].journal.getFlag(MODULE_ID, "noteOwnerId") ?? null;
      if (currentScope === target.scope && currentOwner === target.ownerId) continue;
    }

    touchedLegacyIds.add(id);
    const target = noteTargetForComment(afterComment);
    const targetJournal = await ensureNoteJournal(target.scope, target.ownerId);
    const inTarget = existing.find((item) => item.journal.id === targetJournal.id);

    if (inTarget) {
      await targetJournal.updateEmbeddedDocuments(
        "JournalEntryPage",
        [buildPageUpdate(inTarget.page.id, afterComment)],
        { bestiaryJournalInternal: true },
      );
      for (const stale of existing) {
        if (stale.page.id === inTarget.page.id && stale.journal.id === inTarget.journal.id) continue;
        await stale.journal.deleteEmbeddedDocuments("JournalEntryPage", [stale.page.id], {
          bestiaryJournalInternal: true,
        });
      }
    } else {
      await targetJournal.createEmbeddedDocuments("JournalEntryPage", [buildPageData(afterComment)], {
        bestiaryJournalInternal: true,
      });
      for (const old of existing) {
        await old.journal.deleteEmbeddedDocuments("JournalEntryPage", [old.page.id], {
          bestiaryJournalInternal: true,
        });
      }
    }
  }

  if (touchedLegacyIds.size) await pruneLegacySettingComments(touchedLegacyIds);
}

async function pruneLegacySettingComments(ids) {
  const settings = globalThis.game?.settings;
  if (!settings?.get || !settings?.set) return;
  const legacy = normalizeSocial(settings.get(MODULE_ID, "bestiarySocial"));
  if (!legacy.comments.length) return;
  const remaining = legacy.comments.filter((comment) => !ids.has(comment.id));
  if (remaining.length === legacy.comments.length) return;
  await settings.set(MODULE_ID, "bestiarySocial", { revision: legacy.revision, comments: remaining });
}

/**
 * Moves legacy comments out of the world setting `bestiarySocial` into hidden,
 * permission-scoped JournalEntries. Idempotent: safe to retry if interrupted.
 */
export async function migrateSocialToJournalStore() {
  if (!hasJournalNoteStore()) return false;
  const settings = globalThis.game?.settings;
  if (!settings?.get || !settings?.set) return false;

  const legacy = normalizeSocial(settings.get(MODULE_ID, "bestiarySocial"));
  if (!legacy.comments.length) return false;

  try {
    const existingIds = new Set(pageIndexByCommentId().keys());
    const batches = new Map();
    for (const comment of legacy.comments) {
      if (!comment.id || existingIds.has(comment.id)) continue;
      const target = noteTargetForComment(comment);
      const key = `${target.scope}:${target.ownerId ?? ""}`;
      let group = batches.get(key);
      if (!group) {
        group = { ...target, comments: [] };
        batches.set(key, group);
      }
      group.comments.push(comment);
    }

    let migrated = 0;
    for (const group of batches.values()) {
      const journal = await ensureNoteJournal(group.scope, group.ownerId);
      await journal.createEmbeddedDocuments(
        "JournalEntryPage",
        group.comments.map((comment) => buildPageData(comment)),
        { bestiaryJournalInternal: true },
      );
      migrated += group.comments.length;
    }

    await settings.set(MODULE_ID, "bestiarySocial", { revision: 0, comments: [] });
    log.info(`Migrated ${migrated} bestiary note(s) to scoped JournalEntry storage`);
    return true;
  } catch (error) {
    log.error("Could not migrate bestiary notes to scoped JournalEntry storage", error);
    return false;
  }
}

/**
 * Watches Foundry's permission-filtered JournalEntryPage hooks so authorized
 * clients refresh their note views as soon as server-synced pages arrive.
 */
export function registerNoteStoreHooks() {
  const notifyPage = (page, options) => {
    if (options?.bestiaryJournalInternal) return;
    if (!isNoteStoreJournal(page?.parent)) return;
    const comment = readCommentFromPage(page);
    Hooks.callAll("bestiaryJournalRefresh", {
      changed: { social: true },
      uuids: comment?.uuid ? [comment.uuid] : null,
    });
  };

  Hooks.on("createJournalEntryPage", (page, options) => notifyPage(page, options));
  Hooks.on("updateJournalEntryPage", (page, _changed, options) => notifyPage(page, options));
  Hooks.on("deleteJournalEntryPage", (page, options) => notifyPage(page, options));

  const notifyEntry = (entry, options) => {
    if (options?.bestiaryJournalInternal || !isNoteStoreJournal(entry)) return;
    const uuids = [
      ...new Set(
        listJournalPages(entry)
          .map((page) => readCommentFromPage(page)?.uuid)
          .filter(Boolean),
      ),
    ];
    Hooks.callAll("bestiaryJournalRefresh", {
      changed: { social: true },
      uuids: uuids.length ? uuids : null,
    });
  };

  Hooks.on("createJournalEntry", (entry, options) => notifyEntry(entry, options));
  Hooks.on("deleteJournalEntry", (entry, options) => notifyEntry(entry, options));
}
