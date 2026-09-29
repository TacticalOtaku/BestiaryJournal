/**
 * Creature artwork framing.
 *
 * Portraits come in every aspect ratio imaginable, so the default ("auto")
 * never crops: the art is letterboxed with `contain` over a blurred copy of
 * itself, which fills the tile without hiding a head or a tail. When the GM
 * picks a focal point the frame switches to `cover` anchored on that point,
 * which keeps the dense look for art that can take it.
 */

const SILHOUETTE_PLACEHOLDER = "icons/svg/mystery-man.svg";

export function resolveCreatureImage(entry, creature) {
  const useToken = entry?.image?.source === "token";
  const portrait = creature?.img || creature?.portrait || "";
  const token = creature?.prototypeToken || portrait;
  return (useToken ? token : portrait) || portrait || token || "";
}

/**
 * @returns {{src: string, fit: string, position: string, isSilhouette: boolean,
 *            useBackdrop: boolean, imageStyle: string, backdropStyle: string,
 *            frameClass: string}}
 */
export function buildImageView(entry, creature, { silhouette = false } = {}) {
  const src = silhouette ? SILHOUETTE_PLACEHOLDER : resolveCreatureImage(entry, creature);
  const focusX = clampPercent(entry?.image?.focusX, 50);
  const focusY = clampPercent(entry?.image?.focusY, 50);
  const fit = entry?.image?.fit === "cover" ? "cover" : "contain";
  const useBackdrop = fit === "contain" && !silhouette && !!src;
  const position = `${focusX}% ${focusY}%`;

  return {
    src,
    fit,
    focusX,
    focusY,
    position,
    isSilhouette: !!silhouette,
    useBackdrop,
    imageStyle: `object-fit:${fit};object-position:${position};`,
    backdropStyle: useBackdrop ? `background-image:url(${cssUrl(src)});` : "",
    frameClass: [
      "bestiary-frame",
      `is-${fit}`,
      useBackdrop ? "has-backdrop" : "",
      silhouette ? "is-silhouette" : ""
    ].filter(Boolean).join(" ")
  };
}

/** Compact variant for list rows and chips, where a backdrop would be noise. */
export function buildThumbView(entry, creature, { silhouette = false } = {}) {
  const view = buildImageView(entry, creature, { silhouette });
  return { ...view, useBackdrop: false, backdropStyle: "", frameClass: `${view.frameClass} is-thumb` };
}

export function cssUrl(path) {
  return `"${String(path).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clampPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export { SILHOUETTE_PLACEHOLDER };
