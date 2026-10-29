/**
 * Live check of the open Bestiary windows, for the browser console of a running Foundry (see docs/live-check.md).
 * Paste the whole file; it resolves to a report and prints each finding as a table. It reads the page only.
 *
 * - fonts: visible text not set in the module's faces (Bestiary Onest, Bestiary Display);
 * - clipped: text cut off by its box without an ellipsis;
 * - overflow: an element that sticks out of its window sideways;
 * - unlabeled: a button or link with no text, aria-label or tooltip.
 */
(async () => {
  const FACES = ["Bestiary Onest", "Bestiary Display"];
  const roots = [...document.querySelectorAll(".bestiary-app"), ...document.querySelectorAll(".bestiary-chat-card, .bestiary-research-card")];
  const report = { windows: roots.length, fonts: [], clipped: [], overflow: [], unlabeled: [] };

  const describe = element => {
    const id = element.id ? `#${element.id}` : "";
    const classes = [...element.classList].slice(0, 3).map(name => `.${name}`).join("");
    const where = element.closest(".bestiary-app")?.id || element.closest(".chat-message")?.dataset.messageId || "";
    return `${where} ${element.tagName.toLowerCase()}${id}${classes}`.trim();
  };
  const isShown = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const ownText = element => [...element.childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim())
    .join("");
  const isIcon = element => element.matches("i, [class*='fa-'], svg, svg *");

  for (const root of roots) {
    const box = root.getBoundingClientRect();
    for (const element of [root, ...root.querySelectorAll("*")]) {
      // Screen-reader-only text is clipped on purpose.
      if (!isShown(element) || isIcon(element) || element.closest(".sr-only")) continue;
      const style = getComputedStyle(element);
      const text = ownText(element) || (element.matches("input, select, textarea, button") ? element.value ?? element.textContent : "");

      if (text) {
        const face = style.fontFamily.split(",")[0].replaceAll('"', "").trim();
        if (!FACES.includes(face)) report.fonts.push({ element: describe(element), font: face, text: text.slice(0, 40) });
      }

      const clips = ["hidden", "clip"].includes(style.overflowX) && style.textOverflow !== "ellipsis";
      if (text && clips && element.scrollWidth > element.clientWidth + 1) {
        report.clipped.push({ element: describe(element), text: text.slice(0, 40), by: element.scrollWidth - element.clientWidth });
      }

      if (root.matches(".bestiary-app") && element !== root) {
        const rect = element.getBoundingClientRect();
        const out = Math.max(box.left - rect.left, rect.right - box.right);
        if (out > 1 && rect.width > 0 && !element.closest(".bestiary-scrollable, [class*='scroll']")) {
          report.overflow.push({ element: describe(element), by: Math.round(out) });
        }
      }

      if (element.matches("button, a, [role='button']")) {
        const named = element.textContent.trim() || element.getAttribute("aria-label") || element.dataset.tooltip || element.title;
        if (!named) report.unlabeled.push({ element: describe(element) });
      }
    }
  }

  for (const [kind, rows] of Object.entries(report)) {
    if (!Array.isArray(rows)) continue;
    console.log(`Bestiary live check: ${kind} — ${rows.length}`);
    if (rows.length) console.table(rows);
  }
  return report;
})();
