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
document.addEventListener("pointermove", event => {
  const card = event.target.closest?.(".bestiary-spot");
  if (!card || spotFrame) return;
  spotFrame = requestAnimationFrame(() => {
    spotFrame = 0;
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  });
}, { passive: true });

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

  // Opening a section explains where its content came from, so it plays at «reduced» too.
  if (motionLevel(element) === "off" || typeof element.animate !== "function") {
    element.classList.toggle("is-collapsed", !expanded);
    return;
  }

  if (expanded) element.classList.remove("is-collapsed");
  const startHeight = expanded ? 0 : element.getBoundingClientRect().height;
  const endHeight = expanded ? element.scrollHeight : 0;
  element.style.overflow = "hidden";

  const animation = element.animate([
    { height: `${startHeight}px`, opacity: expanded ? 0 : 1, transform: expanded ? "translateY(-4px)" : "translateY(0)" },
    { height: `${endHeight}px`, opacity: expanded ? 1 : 0, transform: expanded ? "translateY(0)" : "translateY(-4px)" }
  ], {
    duration: expanded ? 280 : 210,
    easing: "cubic-bezier(.22, 1, .36, 1)"
  });

  disclosureAnimations.set(element, animation);
  animation.onfinish = () => {
    if (disclosureAnimations.get(element) !== animation) return;
    element.classList.toggle("is-collapsed", !expanded);
    element.style.removeProperty("overflow");
    disclosureAnimations.delete(element);
  };
  animation.oncancel = () => {
    if (disclosureAnimations.get(element) !== animation) return;
    element.style.removeProperty("overflow");
    disclosureAnimations.delete(element);
  };
}

/**
 * Lightweight right-click menu shared by the library and collection views.
 * Items are `{name, icon, callback, danger, disabled}` or `{separator: true}`.
 * Closes on an outside click, Escape, scrolling or losing window focus.
 */
let closeOpenMenu = null;

export function showContextMenu(event, items) {
  closeOpenMenu?.();

  const menu = document.createElement("nav");
  menu.className = "bestiary-context-menu bestiary-app";
  menu.setAttribute("role", "menu");
  // It lives on <body>, outside any window: it borrows the look of the window it was opened from.
  const origin = event.target?.closest?.(".bestiary-app");
  if (origin) Object.assign(menu.dataset, { theme: origin.dataset.theme, accent: origin.dataset.accent, motion: origin.dataset.motion });
  else stampTheme(menu);
  const list = document.createElement("ol");
  list.className = "context-items";
  menu.appendChild(list);

  for (const item of items) {
    if (item.separator) {
      const divider = document.createElement("li");
      divider.className = "context-separator";
      divider.setAttribute("role", "separator");
      list.appendChild(divider);
      continue;
    }
    const row = document.createElement("li");
    row.className = `context-item${item.danger ? " is-danger" : ""}${item.disabled ? " is-disabled" : ""}`;
    row.setAttribute("role", "menuitem");
    row.tabIndex = item.disabled ? -1 : 0;
    if (item.disabled) row.setAttribute("aria-disabled", "true");
    const icon = document.createElement("i");
    icon.className = `fas ${item.icon}`;
    const label = document.createElement("span");
    label.textContent = item.name;
    row.append(icon, label);
    const activate = () => {
      if (item.disabled) return;
      close();
      item.callback?.();
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", keyEvent => {
      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
        keyEvent.preventDefault();
        activate();
      }
    });
    list.appendChild(row);
  }

  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  document.body.appendChild(menu);

  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;

  const onPointerDown = pointer => {
    if (!menu.contains(pointer.target)) close();
  };
  const onKeyDown = keyEvent => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    close();
  };
  function close() {
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", close, true);
    window.removeEventListener("blur", close);
    if (closeOpenMenu === close) closeOpenMenu = null;
  }
  closeOpenMenu = close;
  setTimeout(() => {
    if (closeOpenMenu !== close) return;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
  }, 0);
  menu.querySelector(".context-item:not(.is-disabled)")?.focus({ preventScroll: true });
  return menu;
}
