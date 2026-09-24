import {
  BESTIARY_COMMANDS,
  PLAYER_COMMANDS,
  STORE_KEYS,
  applyBestiaryCommand,
  canViewCreature,
  createBestiaryState,
  getViewerTier,
  normalizeBestiaryData,
  normalizeKnowledge,
  normalizeSocial
} from "./bestiary-domain.mjs";
import { prepareResearchCommand } from "./research-authority.mjs";

const MODULE_ID = "bestiary-journal";
const SOCKET_NAME = `module.${MODULE_ID}`;
const COMMAND_REQUEST_FLAG = "commandRequest";
const REQUEST_TIMEOUT_MS = 15_000;
const HANDLED_REQUEST_TTL_MS = 10 * 60_000;

const SETTING_BY_STORE = Object.freeze({
  data: "bestiaryData",
  knowledge: "bestiaryKnowledge",
  social: "bestiarySocial"
});

/**
 * Commands the authority has to check against live Foundry documents before
 * the pure reducer may see them. Each returns the command to apply plus an
 * optional follow-up that runs once the change is persisted.
 */
const COMMAND_PREPARERS = Object.freeze({
  [BESTIARY_COMMANDS.RECORD_RESEARCH]: prepareResearchCommand
});

/** A rejection the requester can show in their own language. */
export class BestiaryCommandError extends Error {
  constructor(key, data = {}) {
    super(key);
    this.key = key;
    this.data = data;
  }
}

let writeQueue = Promise.resolve();
let remoteRequestQueue = Promise.resolve();
const pendingRequests = new Map();
/** requestId → time handled, so a replayed socket message is ignored. */
const handledRequests = new Map();

// ── Reads ──────────────────────────────────────────────────────────────────

export function getBestiaryData() {
  return normalizeBestiaryData(game.settings.get(MODULE_ID, SETTING_BY_STORE.data));
}

export function getBestiaryKnowledge() {
  return normalizeKnowledge(game.settings.get(MODULE_ID, SETTING_BY_STORE.knowledge));
}

export function getBestiarySocial() {
  return normalizeSocial(game.settings.get(MODULE_ID, SETTING_BY_STORE.social));
}

export function getBestiaryState() {
  return {
    data: getBestiaryData(),
    knowledge: getBestiaryKnowledge(),
    social: getBestiarySocial()
  };
}

export function canUserViewBestiaryCreature(uuid, user = game.user) {
  return canViewCreature(getBestiaryData(), uuid, user);
}

export function getCurrentViewerTier(uuid, user = game.user) {
  return getViewerTier(getBestiaryKnowledge(), uuid, user);
}

// ── Writes ─────────────────────────────────────────────────────────────────

export function hasActiveAuthority() {
  return !!getAuthorityGm();
}

/**
 * Every mutation funnels through the authoritative GM: they own the world
 * settings, so players (and secondary GMs) hand the command over by socket.
 */
export async function dispatchBestiaryCommand(command) {
  if (!game.user?.isGM && !PLAYER_COMMANDS.has(command?.type)) {
    throw new BestiaryCommandError("BESTIARY.Errors.GmOnly");
  }
  const authority = getAuthorityGm();
  if (game.user?.isGM && (!authority || authority.id === game.user.id)) {
    return enqueueCommand(stampCommand(command, game.user));
  }
  if (!authority) throw new BestiaryCommandError("BESTIARY.NoActiveGm");

  const operation = remoteRequestQueue.then(() => requestAuthority(command));
  remoteRequestQueue = operation.catch(() => undefined);
  return operation;
}

async function requestAuthority(command) {
  const requestId = foundry.utils.randomID(16);
  // Serialized, because setFlag merges objects recursively: an object payload
  // would inherit every field of the previous command and silently apply them
  // (a leftover `hidden: true` once hid a creature). A string replaces cleanly,
  // and it also sidesteps dots being read as paths in flag keys.
  await game.user.setFlag(MODULE_ID, COMMAND_REQUEST_FLAG, JSON.stringify({
    requestId,
    command,
    issuedAt: Date.now()
  }));

  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new BestiaryCommandError("BESTIARY.Errors.Timeout"));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timeout });
  });

  game.socket.emit(SOCKET_NAME, {
    action: "bestiaryCommand",
    requestId,
    requesterId: game.user.id
  });
  return response;
}

export async function handleBestiaryStoreSocket(message) {
  if (message?.action === "bestiaryCommandResult") {
    if (message.requesterId !== game.user.id) return true;
    settlePendingRequest(message);
    return true;
  }

  if (message?.action !== "bestiaryCommand") return false;
  if (getAuthorityGm()?.id !== game.user.id) return true;

  // A socket message only names a request; replaying it, or claiming someone
  // else's id, must never run a command twice.
  pruneHandledRequests();
  if (!message.requestId || handledRequests.has(message.requestId)) return true;
  handledRequests.set(message.requestId, Date.now());

  const requester = game.users?.get?.(message.requesterId);
  // The request itself is read back from a server-persisted user flag, so a
  // spoofed socket payload cannot smuggle a command in.
  const persistedRequest = readCommandRequest(requester);
  const command = persistedRequest?.command;

  if (!requester || persistedRequest?.requestId !== message.requestId || !command) {
    emitCommandResult(message, null, new BestiaryCommandError("BESTIARY.Errors.NotAuthenticated"));
    return true;
  }

  let result = null;
  let failure = null;
  try {
    if (!requester.isGM && !PLAYER_COMMANDS.has(command.type)) {
      throw new BestiaryCommandError("BESTIARY.Errors.GmOnly");
    }
    if (!requester.isGM && !isSharingAllowed() && command.type === BESTIARY_COMMANDS.SHARE_KNOWLEDGE) {
      throw new BestiaryCommandError("BESTIARY.Errors.SharingDisabled");
    }
    const stamped = stampCommand(command, requester);
    const prepared = COMMAND_PREPARERS[command.type]
      ? await COMMAND_PREPARERS[command.type](stamped, requester)
      : { command: stamped };
    result = await enqueueCommand(prepared.command);
    await prepared.finalize?.(result);
  } catch (error) {
    failure = error;
  }

  // Consumed before the answer goes out: the requester only sends its next
  // command after this one settles, so the cleanup can never erase it.
  await clearCommandRequest(requester, message.requestId);
  emitCommandResult(message, result, failure);
  return true;
}

/**
 * Reads back the pending request a user persisted on their own document.
 * Accepts the legacy object shape so a client that has not reloaded yet still
 * gets its command applied.
 */
function readCommandRequest(user) {
  const stored = user?.getFlag?.(MODULE_ID, COMMAND_REQUEST_FLAG);
  if (typeof stored !== "string") return stored ?? null;
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn("Bestiary | Could not parse a relayed command request", error);
    return null;
  }
}

async function clearCommandRequest(user, requestId) {
  if (!user || readCommandRequest(user)?.requestId !== requestId) return;
  try {
    await user.unsetFlag(MODULE_ID, COMMAND_REQUEST_FLAG);
  } catch (error) {
    console.warn("Bestiary | Could not clear a processed command request", error);
  }
}

function pruneHandledRequests() {
  const cutoff = Date.now() - HANDLED_REQUEST_TTL_MS;
  for (const [requestId, at] of handledRequests) {
    if (at < cutoff) handledRequests.delete(requestId);
  }
}

/**
 * The authority — not the sender — decides who the command acts as, so a
 * player can never write knowledge or comments in someone else's name.
 */
function stampCommand(command, user) {
  return { ...command, userId: user.id, isGM: !!user.isGM };
}

function isPlayerUser(userId) {
  const user = game.users?.get?.(userId);
  return !!user && !user.isGM;
}

async function enqueueCommand(command) {
  const operation = writeQueue.then(async () => {
    const current = createBestiaryState(getBestiaryState());
    const result = applyBestiaryCommand(current, command, {
      generateId: () => foundry.utils.randomID(16),
      isPlayerUser
    });
    if (!result.changedAny) return { changed: false };

    for (const key of STORE_KEYS) {
      if (!result.changed[key]) continue;
      await game.settings.set(MODULE_ID, SETTING_BY_STORE[key], result.state[key]);
    }
    const payload = {
      action: "refreshBestiary",
      changed: result.changed,
      uuids: affectedUuids(command, current, result.state),
      revision: result.state.data.revision
    };
    game.socket?.emit(SOCKET_NAME, payload);
    Hooks.callAll("bestiaryJournalRefresh", payload);
    return { changed: true, stores: result.changed };
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

/**
 * Creatures a command touched, so open cards of unrelated creatures can skip
 * the refresh. `null` means "could be anything" and refreshes everything.
 */
function affectedUuids(command, before, after) {
  if (command.uuid) return [String(command.uuid)];
  if (Array.isArray(command.uuids) && command.uuids.length) return command.uuids.map(String);
  if (command.commentId) {
    const comment = [...before.social.comments, ...after.social.comments]
      .find(item => item.id === command.commentId);
    return comment ? [comment.uuid] : null;
  }
  return null;
}

function isSharingAllowed() {
  try {
    return game.settings.get(MODULE_ID, "allowPlayerSharing") !== false;
  } catch {
    return true;
  }
}

function getAuthorityGm() {
  const users = game.users?.contents ?? [...(game.users?.values?.() ?? [])];
  return users
    .filter(user => user.active && user.isGM)
    .sort((left, right) => left.id.localeCompare(right.id))[0]
    ?? (game.user?.isGM ? game.user : null);
}

export function isAuthorityGm() {
  return getAuthorityGm()?.id === game.user?.id;
}

function emitCommandResult(request, result, error = null) {
  game.socket.emit(SOCKET_NAME, {
    action: "bestiaryCommandResult",
    requestId: request.requestId,
    requesterId: request.requesterId,
    result,
    error: error ? (error.key ?? error.message ?? String(error)) : null,
    errorData: error?.data ?? null
  });
}

function settlePendingRequest(message) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(message.requestId);
  if (message.error) pending.reject(new BestiaryCommandError(message.error, message.errorData ?? {}));
  else pending.resolve(message.result);
}

/** Readable text for any error a command can end with. */
export function describeCommandError(error) {
  const key = error?.key ?? error?.message ?? "";
  if (typeof key === "string" && key.startsWith("BESTIARY.") && game.i18n.has?.(key)) {
    return game.i18n.format(key, error?.data ?? {});
  }
  return error?.message || game.i18n.localize("BESTIARY.Errors.Unknown");
}
