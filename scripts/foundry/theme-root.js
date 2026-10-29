import { effectiveMotion, normalizeAccent, resolveTheme } from "../core/theme.js";
import { log } from "../core/logger.js";

const MODULE_ID = "bestiary-journal";
const AIM_ID = "actor-inventory-manager";

/** «Как в AIM» borrows AIM's own theme and accent while AIM is active; otherwise it acts as «Авто». */
function chosenLook() {
  const theme = game.settings.get(MODULE_ID, "uiTheme");
  const accent = game.settings.get(MODULE_ID, "uiAccent");
  if (theme !== "aim") return { theme, accent };
  try {
    if (game.modules.get(AIM_ID)?.active) {
      return { theme: game.settings.get(AIM_ID, "windowTheme"), accent: game.settings.get(AIM_ID, "windowAccent") };
    }
  } catch (error) {
    log.debug("AIM's theme settings are not readable; using «Авто»", error);
  }
  return { theme: "auto", accent };
}

/** Foundry puts the applications' colour scheme on each window, and the interface one on `body`. */
function schemeIsLight(element) {
  if (element.classList.contains("theme-light")) return true;
  if (element.classList.contains("theme-dark")) return false;
  return document.body.classList.contains("theme-light");
}

/** Theme, accent, density and motion as data attributes on a bestiary window root. */
export function stampTheme(element) {
  if (!element?.classList.contains("bestiary-app")) return;
  const { theme, accent } = chosenLook();
  element.dataset.theme = resolveTheme(theme, schemeIsLight(element));
  element.dataset.accent = normalizeAccent(accent);
  element.dataset.tooltipClass = "bestiary-tooltip";
  element.dataset.density = game.settings.get(MODULE_ID, "uiDensity");
  element.dataset.motion = effectiveMotion(game.settings.get(MODULE_ID, "uiMotion"), {
    reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    performanceLow: document.body.classList.contains("performance-low")
  });
}

/** Restamps every open bestiary window, dialogs included, after a look setting changed. */
export function restampAll() {
  for (const element of document.querySelectorAll(".bestiary-app")) stampTheme(element);
}

/**
 * Stamps each bestiary window as it renders, and follows the sources of «Авто»
 * and «Как в AIM»: Foundry's colour scheme classes and AIM's own settings.
 */
export function registerThemeRoot() {
  Hooks.on("renderApplicationV2", (application, element) => stampTheme(element));
  // A user's first change of an AIM setting creates its document; later ones update it.
  const followAim = setting => {
    if (setting.key?.startsWith(`${AIM_ID}.window`)) restampAll();
  };
  Hooks.on("createSetting", followAim);
  Hooks.on("updateSetting", followAim);
  new MutationObserver(restampAll).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}
