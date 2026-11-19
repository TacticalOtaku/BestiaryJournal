import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        _onFirstRender() {}
        _onRender() {}
      },
      HandlebarsApplicationMixin: (Base) => Base,
      DialogV2: {
        confirmCalls: [],
        confirm: async (config) => {
          globalThis.foundry.applications.api.DialogV2.confirmCalls.push(config);
          return true;
        },
      },
    },
  },
  utils: {
    randomID: () => "entry1",
  },
};
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  body: { classList: { contains: () => false }, appendChild() {} },
  querySelectorAll: () => [],
};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};

const { BestiaryEntryEditor } = await import("../scripts/ui/entry-editor.js");
const { BestiaryCreatureView } = await import("../scripts/ui/creature-view.js");
const { sortByKnownName } = await import("../scripts/ui/creature-cards.js");
const { confirmDialog } = await import("../scripts/foundry/foundry-runtime.js");
const { registerThemeRoot } = await import("../scripts/foundry/theme-root.js");
const { activateTablistKeyboard, showContextMenu } = await import("../scripts/ui/ui-effects.js");

test("BestiaryCreatureView marks the root wrapper part as scrollable using Foundry empty-string selector", () => {
  assert.deepEqual(BestiaryCreatureView.PARTS.creature.scrollable, ["", ".rail-body"]);
});

test("BestiaryEntryEditor binds its change listener once across rerenders", () => {
  const editor = new BestiaryEntryEditor({ sectionId: "sec", uuid: "Actor.1" });
  const listeners = [];
  editor.element = {
    addEventListener: (type, handler) => listeners.push({ type, handler }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  editor._onFirstRender({ error: false }, {});
  editor._onRender({ error: false }, {});
  editor._onRender({ error: false }, {});
  editor._onRender({ error: false }, {});

  const changeListeners = listeners.filter((entry) => entry.type === "change");
  assert.equal(changeListeners.length, 1);
});

test("sortByKnownName returns a sorted array without mutating its input", () => {
  const input = [
    { name: "Unknown", sortName: "" },
    { name: "Zombie", sortName: "Zombie" },
    { name: "Aboleth", sortName: "Aboleth" },
  ];
  const snapshot = input.map((item) => item.name);
  const sorted = sortByKnownName(input);

  assert.deepEqual(
    sorted.map((item) => item.name),
    ["Aboleth", "Zombie", "Unknown"],
  );
  assert.deepEqual(
    input.map((item) => item.name),
    snapshot,
  );
});

test("confirmDialog opens a modal DialogV2 confirmation", async () => {
  globalThis.game = { i18n: { localize: (key) => key } };
  globalThis.foundry.applications.api.DialogV2.confirmCalls.length = 0;

  const result = await confirmDialog({
    title: "Delete",
    content: "<p>Sure?</p>",
    yesLabel: "Delete",
  });

  assert.equal(result, true);
  assert.equal(globalThis.foundry.applications.api.DialogV2.confirmCalls.length, 1);
  assert.equal(globalThis.foundry.applications.api.DialogV2.confirmCalls[0].modal, true);
  assert.equal(globalThis.foundry.applications.api.DialogV2.confirmCalls[0].rejectClose, false);
});

test("registerThemeRoot reacts to live prefers-reduced-motion changes", () => {
  const prevMatchMedia = globalThis.matchMedia;
  const prevObserver = globalThis.MutationObserver;
  const prevDocument = globalThis.document;
  const prevGame = globalThis.game;

  let changeListener = null;
  let reduced = false;
  const appElement = {
    dataset: {},
    classList: { contains: (name) => name === "bestiary-app" },
  };
  globalThis.matchMedia = () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (event, fn) => {
      if (event === "change") changeListener = fn;
    },
  });
  globalThis.MutationObserver = class {
    observe() {}
  };
  globalThis.document = {
    body: { classList: { contains: () => false } },
    querySelectorAll: (selector) => (selector === ".bestiary-app" ? [appElement] : []),
  };
  globalThis.game = {
    modules: { get: () => null },
    settings: {
      get: (_scope, key) =>
        ({
          uiTheme: "night",
          uiAccent: "brass",
          uiDensity: "comfortable",
          uiCoverSize: "medium",
          uiMotion: "full",
        })[key],
    },
  };

  try {
    registerThemeRoot();
    assert.equal(typeof changeListener, "function");
    reduced = true;
    changeListener();
    assert.equal(appElement.dataset.motion, "off");
    reduced = false;
    changeListener();
    assert.equal(appElement.dataset.motion, "full");
  } finally {
    globalThis.matchMedia = prevMatchMedia;
    globalThis.MutationObserver = prevObserver;
    globalThis.document = prevDocument;
    globalThis.game = prevGame;
  }
});

test("activateTablistKeyboard moves focus across tabs with arrow, Home and End keys", () => {
  const prevDocument = globalThis.document;
  const focused = [];
  const makeTab = (name) => ({
    name,
    focus: () => {
      globalThis.document.activeElement = tabByName[name];
      focused.push(name);
    },
  });
  const tabByName = { one: makeTab("one"), two: makeTab("two"), three: makeTab("three") };
  let keydownHandler = null;
  const tablist = {
    addEventListener: (type, fn) => {
      if (type === "keydown") keydownHandler = fn;
    },
    querySelectorAll: () => Object.values(tabByName),
  };
  globalThis.document = {
    ...prevDocument,
    activeElement: tabByName.one,
  };
  try {
    activateTablistKeyboard({ querySelectorAll: () => [tablist] });
    keydownHandler({ key: "ArrowRight", preventDefault() {} });
    keydownHandler({ key: "End", preventDefault() {} });
    keydownHandler({ key: "Home", preventDefault() {} });
    keydownHandler({ key: "ArrowLeft", preventDefault() {} });
    assert.deepEqual(focused, ["two", "three", "one", "three"]);
  } finally {
    globalThis.document = prevDocument;
  }
});

test("showContextMenu builds ARIA menu buttons, handles arrow keys and restores focus on Escape", () => {
  const prevDocument = globalThis.document;
  const prevGame = globalThis.game;
  const prevHTMLElement = globalThis.HTMLElement;
  const docListeners = new Map();
  let appendedMenu = null;

  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this.children = [];
      this.listeners = {};
      this.isConnected = true;
      this.disabled = false;
      this.className = "";
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
      };
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }
    getAttribute(k) {
      return this.attributes[k];
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    append(...nodes) {
      for (const node of nodes) this.appendChild(node);
    }
    appendChild(node) {
      this.children.push(node);
      return node;
    }
    contains() {
      return false;
    }
    focus() {
      globalThis.document.activeElement = this;
    }
    remove() {
      this.isConnected = false;
    }
    getBoundingClientRect() {
      return { width: 200, height: 120 };
    }
    querySelectorAll(selector) {
      if (selector.includes("menuitem")) {
        const list = this.children[0]?.children ?? [];
        return list.filter((item) => item.attributes.role === "menuitem" && !item.disabled);
      }
      return [];
    }
    matches() {
      return false;
    }
  }

  globalThis.HTMLElement = FakeElement;
  const opener = new FakeElement("button");
  globalThis.game = {
    modules: { get: () => null },
    settings: {
      get: (_s, k) =>
        ({
          uiTheme: "night",
          uiAccent: "brass",
          uiDensity: "comfortable",
          uiCoverSize: "medium",
          uiMotion: "full",
        })[k],
    },
  };
  globalThis.document = {
    body: {
      classList: { contains: () => false },
      appendChild: (node) => {
        appendedMenu = node;
      },
    },
    activeElement: opener,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, fn) => docListeners.set(type, fn),
    removeEventListener: (type) => docListeners.delete(type),
  };

  try {
    const prevSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => {
      fn();
      return 1;
    };
    try {
      let clicked = false;
      const menu = showContextMenu({ currentTarget: opener, clientX: 50, clientY: 50 }, [
        { label: "Hidden", icon: "fa-eye", visible: false, onClick: () => {} },
        { label: "First", icon: "fa-pen", onClick: () => (clicked = true) },
        { separator: true },
        { label: "Second", icon: "fa-trash", onClick: () => {} },
      ]);

      assert.equal(appendedMenu, menu);
      assert.equal(menu.getAttribute("role"), "menu");
      const items = menu.querySelectorAll('[role="menuitem"]');
      assert.equal(items.length, 2);
      assert.equal(items[0].tagName, "BUTTON");
      assert.equal(items[0].children[1].textContent, "First");
      assert.equal(globalThis.document.activeElement, items[0]);

      docListeners.get("keydown")?.({ key: "ArrowDown", preventDefault() {}, stopPropagation() {} });
      assert.equal(globalThis.document.activeElement, items[1]);
      docListeners.get("keydown")?.({ key: "Escape", preventDefault() {}, stopPropagation() {} });
      assert.equal(globalThis.document.activeElement, opener);

      showContextMenu({ currentTarget: opener, clientX: 10, clientY: 10 }, [
        { label: "Only", icon: "fa-eye", onClick: () => (clicked = true) },
      ]);
      const reopened = appendedMenu.querySelectorAll('[role="menuitem"]');
      reopened[0].listeners.click({});
      assert.equal(clicked, true);
    } finally {
      globalThis.setTimeout = prevSetTimeout;
    }
  } finally {
    globalThis.document = prevDocument;
    globalThis.game = prevGame;
    globalThis.HTMLElement = prevHTMLElement;
  }
});
