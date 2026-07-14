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
