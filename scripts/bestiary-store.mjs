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

const MODULE_ID = "bestiary-journal";
const SOCKET_NAME = `module.${MODULE_ID}`;
const COMMAND_REQUEST_FLAG = "commandRequest";
const REQUEST_TIMEOUT_MS = 10_000;

const SETTING_BY_STORE = Object.freeze({
  data: "bestiaryData",
  knowledge: "bestiaryKnowledge",
  social: "bestiarySocial"
});

let writeQueue = Promise.resolve();
let remoteRequestQueue = Promise.resolve();
const pendingRequests = new Map();

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

/**
 * Every mutation funnels through the authoritative GM: they own the world
 * settings, so players (and secondary GMs) hand the command over by socket.
 */
export async function dispatchBestiaryCommand(command) {
  if (!game.user?.isGM && !PLAYER_COMMANDS.has(command?.type)) {
    throw new Error("This bestiary command is reserved for the Game Master");
  }
  const authority = getAuthorityGm();
  if (game.user?.isGM && (!authority || authority.id === game.user.id)) {
    return enqueueCommand(stampCommand(command, game.user));
  }
  if (!authority) {
    ui.notifications?.warn(game.i18n.localize("BESTIARY.NoActiveGm"));
    throw new Error("No active GM is available to apply the bestiary change");
  }

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
  await game.user.setFlag(MODULE_ID, COMMAND_REQUEST_FLAG, JSON.stringify({ requestId, command }));

  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Timed out waiting for the authoritative GM"));
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

  const requester = game.users?.get?.(message.requesterId);
  // The request itself is read back from a server-persisted user flag, so a
  // spoofed socket payload cannot smuggle a command in.
  const persistedRequest = readCommandRequest(requester);
  const command = persistedRequest?.command;

  if (!requester || persistedRequest?.requestId !== message.requestId || !command) {
    emitCommandResult(message, null, "The bestiary command could not be authenticated");
    return true;
  }
  if (!requester.isGM && !PLAYER_COMMANDS.has(command.type)) {
    emitCommandResult(message, null, "This bestiary command is reserved for the Game Master");
    return true;
  }
  if (!requester.isGM && !isSharingAllowed() && command.type === BESTIARY_COMMANDS.SHARE_KNOWLEDGE) {
    emitCommandResult(message, null, "Sharing bestiary entries is disabled in this world");
    return true;
  }

  try {
    const result = await enqueueCommand(stampCommand(command, requester));
    emitCommandResult(message, result);
  } catch (error) {
    emitCommandResult(message, null, error.message);
  }
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

/**
 * The authority — not the sender — decides who the command acts as, so a
 * player can never write knowledge or comments in someone else's name.
 */
function stampCommand(command, user) {
  return { ...command, userId: user.id, isGM: !!user.isGM };
}

async function enqueueCommand(command) {
  const operation = writeQueue.then(async () => {
    const current = createBestiaryState(getBestiaryState());
    const result = applyBestiaryCommand(current, command, {
      generateId: () => foundry.utils.randomID(16)
    });
    if (!result.changedAny) return { changed: false };

    for (const key of STORE_KEYS) {
      if (!result.changed[key]) continue;
      await game.settings.set(MODULE_ID, SETTING_BY_STORE[key], result.state[key]);
    }
    const payload = {
      action: "refreshBestiary",
      changed: result.changed,
      revision: result.state.data.revision
    };
    game.socket?.emit(SOCKET_NAME, payload);
    Hooks.callAll("bestiaryJournalRefresh", payload);
    return { changed: true, stores: result.changed };
  });
  writeQueue = operation.catch(() => {});
  return operation;
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
    error
  });
}

function settlePendingRequest(message) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(message.requestId);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(message.result);
}
