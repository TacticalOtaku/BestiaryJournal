import {
  applyBestiaryCommand,
  canViewCreature,
  normalizeBestiaryData
} from "./bestiary-domain.mjs";

const MODULE_ID = "bestiary-journal";
const SOCKET_NAME = `module.${MODULE_ID}`;
const COMMAND_REQUEST_FLAG = "commandRequest";
const REQUEST_TIMEOUT_MS = 10_000;

let writeQueue = Promise.resolve();
let remoteRequestQueue = Promise.resolve();
const pendingRequests = new Map();

export function getBestiaryData() {
  return normalizeBestiaryData(game.settings.get(MODULE_ID, "bestiaryData"));
}

export function canUserViewBestiaryCreature(uuid, user = game.user) {
  return canViewCreature(getBestiaryData(), uuid, user);
}

export async function dispatchBestiaryCommand(command) {
  assertCurrentUserIsGm();
  const authority = getAuthorityGm();
  if (!authority || authority.id === game.user.id) return enqueueCommand(command);

  const operation = remoteRequestQueue.then(() => requestAuthority(command));
  remoteRequestQueue = operation.catch(() => undefined);
  return operation;
}

async function requestAuthority(command) {
  const requestId = foundry.utils.randomID(16);
  await game.user.setFlag(MODULE_ID, COMMAND_REQUEST_FLAG, {
    requestId,
    command
  });

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
  const persistedRequest = requester?.getFlag?.(
    MODULE_ID,
    COMMAND_REQUEST_FLAG
  );
  if (
    !requester?.isGM
    || persistedRequest?.requestId !== message.requestId
    || !persistedRequest?.command
  ) {
    emitCommandResult(
      message,
      null,
      "The bestiary command could not be authenticated"
    );
    return true;
  }

  try {
    const result = await enqueueCommand(persistedRequest.command);
    emitCommandResult(message, result);
  } catch (error) {
    emitCommandResult(message, null, error.message);
  }
  return true;
}

async function enqueueCommand(command) {
  const operation = writeQueue.then(async () => {
    const current = getBestiaryData();
    const result = applyBestiaryCommand(current, command, {
      generateId: () => foundry.utils.randomID(16)
    });
    if (!result.changed) {
      return { changed: false, revision: current.revision };
    }

    await game.settings.set(MODULE_ID, "bestiaryData", result.data);
    game.socket?.emit(SOCKET_NAME, {
      action: "refreshBestiary",
      revision: result.data.revision
    });
    return { changed: true, revision: result.data.revision };
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function getAuthorityGm() {
  const users = game.users?.contents
    ?? [...(game.users?.values?.() ?? [])];
  return users
    .filter(user => user.active && user.isGM)
    .sort((left, right) => left.id.localeCompare(right.id))[0]
    ?? (game.user?.isGM ? game.user : null);
}

function assertCurrentUserIsGm() {
  if (!game.user?.isGM) throw new Error("Only a GM may modify the bestiary");
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
