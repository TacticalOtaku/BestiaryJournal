import { stampTheme } from "../foundry/theme-root.js";

const entrancePlayed = new WeakSet();
const disclosureAnimations = new WeakMap();
const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

/** The motion level stamped on the element's window (theme-root.js), or the OS preference before stamping. */
function motionLevel(element) {
  return element?.closest?.("[data-motion]")?.dataset.motion ?? (motionQuery?.matches ? "off" : "full");
}

/** AIM's cursor light: a card marked .bestiary-spot glows softly under the pointer (the CSS hides it with motion off). */
let spotFrame = 0;
document.addEventListener(
  "pointermove",
  (event) => {
    const card = event.target.closest?.(".bestiary-spot");
    if (!card || spotFrame) return;
    spotFrame = requestAnimationFrame(() => {
      spotFrame = 0;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - box.left}px`);
      card.style.setProperty("--my", `${event.clientY - box.top}px`);
    });
  },
  { passive: true },
);

/** Entrances are ornament: only at the full level. */
export function playApplicationEntrance(application, selector) {
  // The render hook stamps the window only after _onRender, where the entrance is decided.
  stampTheme(application.element);
  if (entrancePlayed.has(application) || motionLevel(application.element) !== "full") return;
  const root = application.element?.querySelector(selector);
  if (!root) return;
  entrancePlayed.add(application);
  root.classList.add("suite-entering");
}

export function animateDisclosure(element, expanded) {
  if (!element) return;
  disclosureAnimations.get(element)?.cancel();

  const level = motionLevel(element);
  if (level === "off" || typeof element.animate !== "function") {
    element.classList.toggle("is-collapsed", !expanded);
    return;
  }
  if (!expanded && element.classList?.contains?.("is-collapsed")) return;

  // Compositor-only disclosure (opacity + subtle translateY in full mode, opacity-only in reduced).
  const useTransform = level === "full";
  if (expanded) element.classList.remove("is-collapsed");

  const keyframes = expanded
    ? [
        { opacity: 0, ...(useTransform ? { transform: "translateY(-4px)" } : {}) },
        { opacity: 1, ...(useTransform ? { transform: "translateY(0)" } : {}) },
      ]
    : [
        { opacity: 1, ...(useTransform ? { transform: "translateY(0)" } : {}) },
        { opacity: 0, ...(useTransform ? { transform: "translateY(-4px)" } : {}) },
      ];

  const animation = element.animate(keyframes, {
    duration: expanded ? 220 : 140,
    easing: expanded ? "cubic-bezier(0.22, 1, 0.36, 1)" : "cubic-bezier(0.4, 0, 1, 1)",
  });

  disclosureAnimations.set(element, animation);
  animation.onfinish = () => {
    if (disclosureAnimations.get(element) !== animation) return;
    element.classList.toggle("is-collapsed", !expanded);
    disclosureAnimations.delete(element);
  };
  animation.oncancel = () => {
    if (disclosureAnimations.get(element) !== animation) return;
    disclosureAnimations.delete(element);
  };
}

/**
 * Accessible arrow-key navigation for `[role="tablist"]` bars whose tabs stay
 * manually activated on Enter/Space/click so re-renders only run on selection.
 */
export function activateTablistKeyboard(root) {
  for (const tablist of root?.querySelectorAll?.('[role="tablist"]') ?? []) {
    tablist.addEventListener("keydown", (event) => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]:not([disabled])')];
      if (!tabs.length) return;
      const currentIndex = tabs.indexOf(document.activeElement);
      if (currentIndex === -1) return;
      let nextIndex = -1;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === -1) return;
      event.preventDefault();
      tabs[nextIndex].focus();
    });
  }
}

/**
 * Lightweight right-click menu shared by the library, collection views and actor hooks.
 * Accepts Foundry v14 `{ label, icon, onClick, visible, danger, disabled }` entries
 * (and legacy `{ name, callback }` aliases) or `{ separator: true }`.
 */
let closeOpenMenu = null;

export function showContextMenu(event, items) {
  closeOpenMenu?.();

  const opener =
    event?.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

  const menu = document.createElement("div");
  menu.className = "bestiary-context-menu bestiary-app";
  menu.setAttribute("role", "menu");
  if (typeof menu.showPopover === "function") menu.setAttribute("popover", "manual");

  // It lives on <body>, outside any window: it borrows the look of the window it was opened from.
  const origin = event?.target?.closest?.(".bestiary-app");
  if (origin)
    Object.assign(menu.dataset, {
      theme: origin.dataset.theme,
      accent: origin.dataset.accent,
      motion: origin.dataset.motion,
    });
  else stampTheme(menu);

  const list = document.createElement("div");
  list.className = "context-items";
  menu.appendChild(list);

  for (const item of items) {
    if (item.visible === false) continue;
    if (item.separator) {
      const divider = document.createElement("div");
      divider.className = "context-separator";
      divider.setAttribute("role", "separator");
      list.appendChild(divider);
      continue;
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = `context-item${item.danger ? " is-danger" : ""}${item.disabled ? " is-disabled" : ""}`;
    row.setAttribute("role", "menuitem");
    row.disabled = !!item.disabled;
    row.tabIndex = item.disabled ? -1 : 0;
    if (item.disabled) row.setAttribute("aria-disabled", "true");
    const icon = document.createElement("i");
    icon.className = item.icon?.includes(" ") ? item.icon : `fa-solid ${item.icon}`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = item.label ?? item.name ?? "";
    row.append(icon, label);
    row.addEventListener("click", (clickEvent) => {
      if (item.disabled) return;
      close();
      (item.onClick ?? item.callback)?.(clickEvent);
    });
    list.appendChild(row);
  }

  const clientX = Number(event?.clientX ?? 0);
  const clientY = Number(event?.clientY ?? 0);
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  document.body.appendChild(menu);
  if (typeof menu.showPopover === "function") {
    try {
      menu.showPopover();
    } catch {
      /* Detached/mocked DOM environments without top-layer support keep fixed positioning. */
    }
  }

  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - bounds.height - 8))}px`;

  const enabledItems = () => [...menu.querySelectorAll('.context-item[role="menuitem"]:not([disabled])')];
  const onPointerDown = (pointer) => {
    if (!menu.contains(pointer.target)) close();
  };
  const onKeyDown = (keyEvent) => {
    if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      close({ restoreFocus: true });
      return;
    }
    if (keyEvent.key === "Tab") {
      keyEvent.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    const targets = enabledItems();
    if (!targets.length) return;
    const index = targets.indexOf(document.activeElement);
    let next = -1;
    if (keyEvent.key === "ArrowDown") next = index === -1 ? 0 : (index + 1) % targets.length;
    else if (keyEvent.key === "ArrowUp")
      next = index === -1 ? targets.length - 1 : (index - 1 + targets.length) % targets.length;
    else if (keyEvent.key === "Home") next = 0;
    else if (keyEvent.key === "End") next = targets.length - 1;
    if (next !== -1) {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      targets[next].focus({ preventScroll: true });
    }
  };
  function close({ restoreFocus = false } = {}) {
    try {
      if (menu.matches?.(":popover-open")) menu.hidePopover?.();
    } catch {
      /* Ignore cleanup errors if already disconnected. */
    }
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", close, true);
    window.removeEventListener("blur", close);
    if (closeOpenMenu === close) closeOpenMenu = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }
  closeOpenMenu = close;
  setTimeout(() => {
    if (closeOpenMenu !== close) return;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
  }, 0);
  enabledItems()[0]?.focus({ preventScroll: true });
  return menu;
}
