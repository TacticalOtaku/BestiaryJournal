import test from "node:test";
import assert from "node:assert/strict";
import { bindArtwork } from "../scripts/ui/artwork.js";

class Element extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { this.children.push(...children); }
  remove() { this.removed = true; }
  contains(node) { return node === this || this.children.includes(node); }
  matches() { return false; }
}

function fixture({ complete = true, silhouette = false, canvasFailure = false } = {}) {
  const doc = new Element();
  doc.hidden = false;
  const motion = new Element();
  motion.matches = false;
  const root = new Element();
  root.ownerDocument = doc;
  root.dataset.motion = "full";
  root.closest = () => root;
  const frame = new Element();
  if (silhouette) frame.classList.add("is-silhouette");
  const image = new Element();
  image.complete = complete;
  image.naturalWidth = 2400;
  image.naturalHeight = 1200;
  image.alt = "Forest";
  image.setAttribute("src", "forest.gif");
  image.style = { objectFit: "contain", objectPosition: "50% 50%" };
  frame.children.push(image);
  frame.querySelector = () => image;
  frame.closest = () => frame;
  root.querySelectorAll = () => [frame];
  const drawn = [];
  doc.createElement = () => {
    const canvas = new Element();
    canvas.style = {};
    canvas.getContext = () => canvasFailure ? null : { drawImage: source => drawn.push(source) };
    return canvas;
  };
  doc.defaultView = {
    matchMedia: () => motion,
    URL,
    fetch: async () => ({ ok: true, blob: async () => new Blob(["GIF89a"], { type: "image/gif" }) })
  };
  return { root, frame, image, doc, motion, drawn };
}

test("artwork freezes a loaded image into bounded, proportional posters", () => {
  const { root, frame, image, drawn } = fixture();
  const cleanup = bindArtwork(root);
  const posters = frame.children.filter(child => child !== image);
  assert.equal(posters.length, 2);
  assert.equal(posters[0].width, 1024);
  assert.equal(posters[0].height, 512);
  assert.ok(posters[1].width <= 256, "blurred background should not keep a second full-size bitmap");
  assert.equal(drawn[0], image);
  assert.equal(frame.classList.contains("is-art-ready"), true);
  assert.equal(frame.classList.contains("is-art-active"), false);
  cleanup();
  assert.ok(posters.every(canvas => canvas.removed && canvas.width === 0));
});

test("hover and focus independently activate art, while reduced motion and hidden pages stop it", async () => {
  const { root, frame, doc, motion } = fixture();
  const cleanup = bindArtwork(root);
  frame.dispatchEvent(new Event("pointerenter"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(frame.classList.contains("is-art-active"), true);
  frame.dispatchEvent(new Event("focusin"));
  frame.dispatchEvent(new Event("pointerleave"));
  assert.equal(frame.classList.contains("is-art-active"), true);
  motion.matches = true;
  motion.dispatchEvent(new Event("change"));
  assert.equal(frame.classList.contains("is-art-active"), false);
  motion.matches = false;
  motion.dispatchEvent(new Event("change"));
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(frame.classList.contains("is-art-active"), false);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(frame.classList.contains("is-art-active"), true);
  frame.dispatchEvent(new Event("focusout"));
  assert.equal(frame.classList.contains("is-art-active"), false);
  cleanup();
});

test("late image loads and repeat binding do not leave stale canvases or handlers", async () => {
  const { root, frame, image } = fixture({ complete: false });
  const first = bindArtwork(root);
  first();
  image.complete = true;
  image.dispatchEvent(new Event("load"));
  assert.equal(frame.children.length, 1);
  const second = bindArtwork(root);
  const third = bindArtwork(root);
  assert.equal(frame.children.filter(canvas => !canvas.removed).length, 3);
  second();
  frame.dispatchEvent(new Event("pointerenter"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(frame.classList.contains("is-art-active"), true);
  third();
  third();
  frame.dispatchEvent(new Event("pointerenter"));
  assert.equal(frame.classList.contains("is-art-active"), false);
});

test("silhouettes never create artwork derivatives", () => {
  const { root, frame, drawn } = fixture({ silhouette: true });
  bindArtwork(root)();
  assert.equal(frame.children.length, 1);
  assert.deepEqual(drawn, []);
});

test("canvas failure shows a still fallback instead of uncontrolled animation", () => {
  const { root, frame } = fixture({ canvasFailure: true });
  const cleanup = bindArtwork(root);
  assert.equal(frame.classList.contains("is-art-ready"), false);
  assert.equal(frame.classList.contains("is-art-unavailable"), true);
  frame.dispatchEvent(new Event("pointerenter"));
  assert.equal(frame.classList.contains("is-art-active"), false);
  assert.equal(frame.children.at(-1).textContent, "Forest");
  cleanup();
});

test("motion settings and offscreen visibility stop and resume a hovered image", async () => {
  const { root, frame, doc } = fixture();
  let changed;
  let visibility;
  let disconnected = 0;
  doc.defaultView.MutationObserver = class {
    constructor(callback) { changed = callback; }
    observe() {}
    disconnect() { disconnected++; }
  };
  doc.defaultView.IntersectionObserver = class {
    constructor(callback) { visibility = callback; }
    observe() {}
    disconnect() { disconnected++; }
  };
  const cleanup = bindArtwork(root);
  frame.dispatchEvent(new Event("pointerenter"));
  await new Promise(resolve => setImmediate(resolve));
  root.dataset.motion = "reduced";
  changed();
  assert.equal(frame.classList.contains("is-art-active"), false);
  root.dataset.motion = "full";
  changed();
  assert.equal(frame.classList.contains("is-art-active"), true);
  visibility([{ target: frame, isIntersecting: false }]);
  assert.equal(frame.classList.contains("is-art-active"), false);
  visibility([{ target: frame, isIntersecting: true }]);
  assert.equal(frame.classList.contains("is-art-active"), true);
  cleanup();
  assert.equal(disconnected, 2);
});

test("a lazy image initializes on load and releases posters when its source fails", () => {
  const { root, frame, image, drawn } = fixture({ complete: false });
  const cleanup = bindArtwork(root);
  assert.equal(drawn.length, 0);
  image.dispatchEvent(new Event("load"));
  assert.equal(frame.classList.contains("is-art-ready"), true);
  const canvases = frame.children.filter(child => child !== image);
  image.dispatchEvent(new Event("error"));
  assert.equal(frame.classList.contains("is-art-ready"), false);
  assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.removed));
  cleanup();
});

test("a GIF gets an independent playback source each time, even when its original decoder has finished", async () => {
  const { root, frame, image } = fixture();
  const cleanup = bindArtwork(root);
  assert.equal(image.getAttribute("src"), null);
  frame.dispatchEvent(new Event("pointerenter"));
  await new Promise(resolve => setImmediate(resolve));
  const firstPlayback = image.getAttribute("src");
  assert.match(firstPlayback, /^blob:/);
  frame.dispatchEvent(new Event("pointerleave"));
  assert.equal(image.getAttribute("src"), null);
  frame.dispatchEvent(new Event("pointerenter"));
  assert.notEqual(image.getAttribute("src"), firstPlayback, "another activation must not share a finished decoder");
  cleanup();
  assert.equal(image.getAttribute("src"), "forest.gif");
});

test("rerendering a cached image under the pointer also starts an independent decoder", async () => {
  const { root, frame, image } = fixture();
  frame.matches = () => true;
  const cleanup = bindArtwork(root);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(image.getAttribute("src"), /^blob:/);
  assert.equal(frame.classList.contains("is-art-active"), true);
  cleanup();
});

test("a denied external image fetch keeps its poster and uses native playback", async () => {
  const { root, frame, image, doc } = fixture();
  doc.defaultView.fetch = async () => { throw new Error("CORS denied"); };
  const cleanup = bindArtwork(root);
  frame.dispatchEvent(new Event("pointerenter"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(image.getAttribute("src"), "forest.gif");
  assert.equal(frame.classList.contains("is-art-ready"), true);
  assert.equal(frame.classList.contains("is-art-unavailable"), false);
  cleanup();
});

test("a pending playback fetch cannot restart art after teardown", async () => {
  const { root, frame, image, doc } = fixture();
  let release;
  doc.defaultView.fetch = () => new Promise(resolve => { release = resolve; });
  const cleanup = bindArtwork(root);
  frame.dispatchEvent(new Event("pointerenter"));
  cleanup();
  release({ ok: true, blob: async () => new Blob(["GIF89a"], { type: "image/gif" }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(image.getAttribute("src"), "forest.gif");
  assert.equal(frame.classList.contains("is-art-active"), false);
  assert.ok(frame.children.slice(1).every(el => el.removed));
});
