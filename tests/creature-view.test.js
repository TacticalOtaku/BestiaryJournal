import test from "node:test";
import assert from "node:assert/strict";

// Foundry owns the application frame and persistence; the real card, comments,
// extraction, command dispatch and reducer run against these small host doubles.
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {
    constructor(options) { this.options = options; }
    async render() { return this; }
  }, HandlebarsApplicationMixin: Base => Base } },
  utils: { randomID: (() => { let id = 0; return () => `id${++id}`; })() }
};
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.document = { addEventListener() {} };
globalThis.CONFIG = { DND5E: {} };
globalThis.fromUuid = async uuid => ({ uuid, name: "Wolf", img: "wolf.webp", system: {}, items: [] });
globalThis.ui = { notifications: { warn() {}, error() {} } };
const { BestiaryCreatureView } = await import("../scripts/ui/creature-view.js");

function setup({ collectionLocked = false, entryLocked = false, otherLocked = false } = {}) {
  const values = {
    bestiaryData: { sections: [
      { id: "forest", name: "Forest", locked: collectionLocked, creatures: [{ uuid: "Actor.wolf", locked: entryLocked }] },
      { id: "caves", name: "Caves", creatures: [{ uuid: "Actor.wolf", locked: otherLocked }] }
    ] },
    bestiaryKnowledge: {}, bestiarySocial: {}, tierBlockConfig: {}, favoriteCreatures: []
  };
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  globalThis.game = {
    user: gm, users: { contents: [gm], get: id => id === "gm" ? gm : null },
    settings: {
      get: (_scope, key) => structuredClone(values[key]),
      set: async (_scope, key, value) => { values[key] = structuredClone(value); }
    },
    i18n: { localize: key => key, has: () => false, format: key => key }
  };
  const listeners = {};
  const input = { value: "", addEventListener: (type, handler) => { listeners[type] = handler; } };
  const attributes = {};
  const submit = { disabled: false, setAttribute: (key, value) => { attributes[key] = value; } };
  const element = { querySelector: selector => ({
    ".comment-composer-input": input,
    '[data-action="submitComment"]': submit,
    ".comment-channel-tabs .is-active": { dataset: { channel: "party" } }
  })[selector] ?? null };
  const app = new BestiaryCreatureView({ uuid: "Actor.wolf", sectionId: "forest" });
  app.element = element;
  app._commentDraft = "First note";
  app._activateCommentEditor();
  return { app, values, input, listeners, submit, attributes };
}

function delaySocialSave() {
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const save = game.settings.set;
  game.settings.set = async (scope, key, value) => {
    if (key === "bestiarySocial") { started(); await gate; }
    return save(scope, key, value);
  };
  return { ready, release };
}

test("rapid comment submissions persist one note before acknowledgement", async () => {
  const { app, values, listeners } = setup();
  const gate = delaySocialSave();
  const first = app._onSubmitComment();
  await gate.ready;
  const second = app._onSubmitComment();
  listeners.keydown({ key: "Enter", ctrlKey: true, preventDefault() {} });
  gate.release();
  await Promise.all([first, second]);
  // Also drain any command accidentally queued by the keyboard shortcut.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(values.bestiarySocial.comments.length, 1);
});

test("comment submit is disabled and busy until the save settles", async () => {
  const { app, submit, attributes } = setup();
  const gate = delaySocialSave();
  const saving = app._onSubmitComment();
  await gate.ready;
  const pending = { disabled: submit.disabled, busy: attributes["aria-busy"] };
  gate.release();
  await saving;
  assert.deepEqual(pending, { disabled: true, busy: "true" });
  assert.equal(submit.disabled, false);
  assert.equal(attributes["aria-busy"], "false");
});

test("a saved comment does not erase text typed while acknowledgement is pending", async () => {
  const { app, input, listeners, values } = setup();
  const gate = delaySocialSave();
  const saving = app._onSubmitComment();
  await gate.ready;
  input.value = "Next note";
  listeners.input({ currentTarget: input });
  gate.release();
  await saving;
  assert.equal(values.bestiarySocial.comments[0].text, "First note");
  assert.equal(app._commentDraft, "Next note");
});

test("a refused comment save retains the draft and permits retry", async () => {
  const { app, values, submit } = setup({ collectionLocked: true });
  await app._onSubmitComment();
  assert.equal(app._commentDraft, "First note");
  assert.equal(submit.disabled, false);
  values.bestiaryData.sections[0].locked = false;
  await app._onSubmitComment();
  assert.equal(values.bestiarySocial.comments.length, 1);
  assert.equal(app._commentDraft, "");
});

test("a failed comment save retains its draft and clears busy state for retry", async t => {
  const { app, values, submit } = setup();
  const save = game.settings.set;
  t.mock.method(console, "warn", () => {});
  game.settings.set = async () => { throw new Error("offline"); };
  await app._onSubmitComment();
  assert.equal(app._commentDraft, "First note");
  assert.equal(submit.disabled, false);
  game.settings.set = save;
  await app._onSubmitComment();
  assert.equal(values.bestiarySocial.comments.length, 1);
  assert.equal(app._commentDraft, "");
});

test("an inherited collection lock cannot add an entry lock from the card", async () => {
  const { app, values } = setup({ collectionLocked: true });
  const context = await app._prepareContext();
  assert.equal(context.locked, true);
  assert.equal(context.entryLocked, false);
  assert.equal(context.lockDisabled, true);
  assert.equal(context.lockReason, "BESTIARY.Lock.CollectionLocked");
  await app._onToggleLock();
  assert.equal(values.bestiaryData.sections[0].creatures[0].locked, false);
});

test("a card can clear its own entry lock while the collection remains locked", async () => {
  const { app, values } = setup({ collectionLocked: true, entryLocked: true });
  const context = await app._prepareContext();
  assert.equal(context.entryLocked, true);
  assert.equal(context.lockDisabled, false);
  assert.ok(context.lockLabel.startsWith("BESTIARY.Lock.UnlockEntry"));
  await app._onToggleLock();
  assert.equal(values.bestiaryData.sections[0].creatures[0].locked, false);
  assert.equal((await app._prepareContext()).locked, true);
});

test("another collection entry's lock does not mislabel this entry's action", async () => {
  const { app, values } = setup({ otherLocked: true });
  const context = await app._prepareContext();
  assert.equal(context.locked, true);
  assert.equal(context.entryLocked, false);
  assert.equal(context.lockDisabled, false);
  assert.ok(context.lockLabel.startsWith("BESTIARY.Lock.LockEntry"));
  assert.equal(context.lockReason, "BESTIARY.Lock.InheritedLock");
  await app._onToggleLock();
  assert.equal(values.bestiaryData.sections[0].creatures[0].locked, true);
  assert.equal(values.bestiaryData.sections[1].creatures[0].locked, true);
});

test("item disclosure updates aria-expanded together with visible state", () => {
  const { app } = setup();
  const classes = new Set();
  const attributes = { "aria-expanded": "false" };
  const item = {
    dataset: { itemKey: "actions:bite" },
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => { attributes[name] = value; },
    querySelector: () => null,
    closest: selector => selector === "[data-item-key]" ? item : null
  };
  app._onExpandItem({ target: item }, item);
  assert.equal(classes.has("is-expanded"), true);
  assert.equal(attributes["aria-expanded"], "true");
  app._onExpandItem({ target: item }, item);
  assert.equal(classes.has("is-expanded"), false);
  assert.equal(attributes["aria-expanded"], "false");
});
