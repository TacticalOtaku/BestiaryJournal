const entrancePlayed = new WeakSet();
const disclosureAnimations = new WeakMap();
const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

function reduceMotion() {
  return motionQuery?.matches ?? false;
}

export function playApplicationEntrance(application, selector) {
  if (entrancePlayed.has(application) || reduceMotion()) return;
  const root = application.element?.querySelector(selector);
  if (!root) return;
  entrancePlayed.add(application);
  root.classList.add("suite-entering");
}

export function animateDisclosure(element, expanded) {
  if (!element) return;
  disclosureAnimations.get(element)?.cancel();

  if (reduceMotion() || typeof element.animate !== "function") {
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
 * Items are `{name, icon, callback, danger}` or `{separator: true}`.
 */
export function showContextMenu(event, items) {
  document.querySelectorAll(".bestiary-context-menu").forEach(element => element.remove());

  const menu = document.createElement("nav");
  menu.className = "bestiary-context-menu bestiary-app";
  const list = document.createElement("ol");
  list.className = "context-items";
  menu.appendChild(list);

  for (const item of items) {
    if (item.separator) {
      const divider = document.createElement("li");
      divider.className = "context-separator";
      list.appendChild(divider);
      continue;
    }
    const row = document.createElement("li");
    row.className = `context-item${item.danger ? " is-danger" : ""}`;
    const icon = document.createElement("i");
    icon.className = `fas ${item.icon}`;
    const label = document.createElement("span");
    label.textContent = item.name;
    row.append(icon, label);
    row.addEventListener("click", () => {
      menu.remove();
      item.callback?.();
    });
    list.appendChild(row);
  }

  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  document.body.appendChild(menu);

  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;

  const close = click => {
    if (menu.contains(click.target)) return;
    menu.remove();
    document.removeEventListener("pointerdown", close);
  };
  setTimeout(() => document.addEventListener("pointerdown", close), 0);
  return menu;
}
