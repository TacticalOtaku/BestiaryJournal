const PREFIX = "Bestiary Journal |";

let debugEnabled = false;

/** Toggle verbose diagnostics (bound to the client "debug" setting). */
export function setDebugLogging(enabled) {
  debugEnabled = enabled === true;
}

/** The module's only way to write to the console: one prefix, and debug output only on request. */
export const log = {
  debug(...args) {
    if (debugEnabled) console.debug(PREFIX, ...args);
  },
  info(...args) {
    console.info(PREFIX, ...args);
  },
  warn(...args) {
    console.warn(PREFIX, ...args);
  },
  error(...args) {
    console.error(PREFIX, ...args);
  }
};
