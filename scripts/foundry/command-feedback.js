import { describeCommandError, dispatchBestiaryCommand } from "./bestiary-store.js";
import { localize } from "./foundry-runtime.js";
import { log } from "../core/logger.js";

/**
 * Dispatches a command from a UI action and tells the user when it did not go
 * through, instead of leaving a silent unhandled rejection behind.
 *
 * @param {object} command
 * @param {object} [options]
 * @param {string} [options.unchanged]  Warning key shown when the authority
 *                                      accepted the command but changed nothing.
 * @returns {Promise<object|null>} the result, or null when it failed
 */
export async function runCommand(command, { unchanged = null } = {}) {
  try {
    const result = await dispatchBestiaryCommand(command);
    if (result?.changed === false && unchanged) ui.notifications.warn(localize(unchanged));
    return result;
  } catch (error) {
    reportCommandError(error);
    return null;
  }
}

export function reportCommandError(error) {
  log.warn("A bestiary command failed", error);
  ui.notifications.error(describeCommandError(error));
}
