/**
 * The look of every bestiary window: theme, accent and motion, chosen per user
 * and stamped as data attributes on the window root. The palettes follow the
 * AIM design system: «Ночь» (night) and «Пергамент» (parchment), six named
 * accents with their own value in each theme.
 */

export const THEMES = Object.freeze(["auto", "night", "parchment", "aim"]);
export const ACCENTS = Object.freeze(["brass", "embers", "arcane", "forest", "frost", "rose"]);
export const MOTION_LEVELS = Object.freeze(["full", "reduced", "off"]);
export const DENSITIES = Object.freeze(["comfortable", "compact"]);

/** «Авто» follows Foundry's colour scheme; anything unknown falls back to night. */
export function resolveTheme(choice, schemeIsLight) {
  if (choice === "auto") return schemeIsLight ? "parchment" : "night";
  return choice === "parchment" ? "parchment" : "night";
}

export function normalizeAccent(name) {
  return ACCENTS.includes(name) ? name : ACCENTS[0];
}

/**
 * The motion actually played: the user's choice, capped by the OS asking for
 * reduced motion (nothing moves) and by Foundry's low-performance mode
 * (no entrances or ornamental movement).
 */
export function effectiveMotion(choice, { reducedMotion = false, performanceLow = false } = {}) {
  const wanted = MOTION_LEVELS.includes(choice) ? choice : "full";
  const cap = reducedMotion ? "off" : performanceLow ? "reduced" : "full";
  return MOTION_LEVELS[Math.max(MOTION_LEVELS.indexOf(wanted), MOTION_LEVELS.indexOf(cap))];
}
