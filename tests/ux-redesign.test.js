import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

globalThis.foundry = {
  applications: {
    instances: new Map(),
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
          this.closeCount = 0;
        }
        async render() {
          return this;
        }
        async close() {
          this.closeCount += 1;
          return this;
        }
        bringToFront() {}
      },
      HandlebarsApplicationMixin: (Base) => Base,
    },
  },
  utils: {
    randomID: (() => {
      let id = 0;
      return () => `ux${++id}`;
    })(),
    escapeHTML: (value) => String(value),
    mergeObject: (base, extra) => ({ ...base, ...extra }),
  },
};
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.document = { addEventListener() {} };
globalThis.CONFIG = {
  DND5E: {
    creatureTypes: { beast: { label: "Beast" }, undead: { label: "Undead" } },
    actorSizes: { med: { label: "Medium" } },
  },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const actors = new Map([
  [
    "Actor.wolf",
    { uuid: "Actor.wolf", name: "Dire Wolf", type: "npc", img: "wolf.webp", system: {}, items: [] },
  ],
  [
    "Actor.goblin",
    { uuid: "Actor.goblin", name: "Goblin Scout", type: "npc", img: "goblin.webp", system: {}, items: [] },
  ],
  [
    "Actor.lich",
    { uuid: "Actor.lich", name: "Archlich", type: "npc", img: "lich.webp", system: {}, items: [] },
  ],
]);
globalThis.fromUuid = async (uuid) => actors.get(uuid) ?? null;

function setupGame({ players = [] } = {}) {
  const values = {
    bestiaryData: {
      sections: [
        {
          id: "forest",
          name: "Whispering Woods",
          families: [{ id: "beasts", name: "Forest Beasts", image: "beasts.webp" }],
          creatures: [
            { uuid: "Actor.wolf", familyId: "beasts" },
            { uuid: "Actor.goblin", familyId: null },
          ],
        },
        {
          id: "crypt",
          name: "Sunken Crypt",
          families: [],
          creatures: [{ uuid: "Actor.lich", locked: true }],
        },
      ],
    },
    bestiaryKnowledge: {
      users: {
        p1: { "Actor.wolf": { tier: 2 }, "Actor.goblin": { tier: 1 }, "Actor.lich": { tier: 3 } },
        p2: { "Actor.wolf": { tier: 2 }, "Actor.goblin": { tier: 0 }, "Actor.lich": { tier: 3 } },
      },
    },
    bestiarySocial: {},
    tierBlockConfig: {},
    favoriteCreatures: [],
    collapsedFamilies: [],
    libraryViewMode: "grid",
    onboardingHints: false,
    dismissedTipBanner: true,
    uiTheme: "night",
    uiAccent: "brass",
    uiDensity: "comfortable",
    uiCoverSize: "medium",
    uiMotion: "full",
  };
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const users = [gm, ...players];
  globalThis.game = {
    user: gm,
    users: { contents: users, get: (id) => users.find((u) => u.id === id) ?? null },
    modules: { get: () => null },
    settings: {
      get: (_scope, key) => structuredClone(values[key]),
      set: async (_scope, key, value) => {
        values[key] = structuredClone(value);
      },
    },
    i18n: {
      lang: "en",
      localize: (key) => key,
      has: () => false,
      format: (key, data = {}) => `${key}:${JSON.stringify(data)}`,
    },
  };
  return values;
}

setupGame({
  players: [
    { id: "p1", name: "Alice", isGM: false },
    { id: "p2", name: "Bob", isGM: false },
  ],
});

const { BestiaryKnowledgeBoard } = await import("../scripts/ui/knowledge-board.js");
const { BestiaryApp } = await import("../scripts/ui/bestiary-app.js");
const { BestiaryCreatureView } = await import("../scripts/ui/creature-view.js");
const { BestiaryGuideApp } = await import("../scripts/ui/guide-app.js");
const { createApi } = await import("../scripts/ui/api.js");
const { CollectionWorkspaceController } = await import("../scripts/ui/collection-workspace.js");
const { buildFamilyGroups } = await import("../scripts/ui/section-model.js");
const { SILHOUETTE_PLACEHOLDER } = await import("../scripts/core/image-framing.js");

test("KnowledgeBoard computes whole-party status, scopes families, prunes locked selections, and batch-applies selected rows", async () => {
  const values = setupGame({
    players: [
      { id: "p1", name: "Alice", isGM: false },
      { id: "p2", name: "Bob", isGM: false },
    ],
  });
  const board = new BestiaryKnowledgeBoard({ sectionId: "forest" });
  board._selectedUuids.add("Actor.wolf");
  board._selectedUuids.add("Actor.goblin");

  const context = await board._prepareContext();
  assert.equal(context.rows.length, 2);

  const wolf = context.rows.find((row) => row.uuid === "Actor.wolf");
  const goblin = context.rows.find((row) => row.uuid === "Actor.goblin");
  assert.equal(wolf.partyIsMixed, false);
  assert.equal(wolf.partyKey, "studied");
  assert.equal(goblin.partyIsMixed, true);
  assert.equal(goblin.partyOptions[0].selected, true);

  assert.equal(context.hasFamilies, true);
  assert.equal(context.selectedCount, 2);

  board._family = "beasts";
  const beastsContext = await board._prepareContext();
  assert.deepEqual(
    beastsContext.rows.map((row) => row.uuid),
    ["Actor.wolf"],
  );
  assert.equal(board._selectedUuids.has("Actor.goblin"), false);

  board.element = {
    querySelector: (selector) =>
      ({
        ".board-bulk-tier": { value: "3" },
        ".board-bulk-user": { value: "" },
        ".board-search-empty": null,
        ".board-select-all": null,
        '[data-action="applySelected"]': null,
        '[data-action="applyAll"]': null,
        '[data-action="clearSelection"]': null,
        ".board-selection-status": null,
      })[selector] ?? null,
    querySelectorAll: () => [],
  };
  await board._onApplySelected();
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.wolf"].tier, 3);
  assert.equal(values.bestiaryKnowledge.users.p2["Actor.wolf"].tier, 3);
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.goblin"].tier, 1);
  assert.equal(board._selectedUuids.size, 0);

  const cryptBoard = new BestiaryKnowledgeBoard({ sectionId: "crypt" });
  cryptBoard._selectedUuids.add("Actor.lich");
  const cryptContext = await cryptBoard._prepareContext();
  assert.equal(cryptContext.unlockedCount, 0);
  assert.equal(cryptContext.selectedCount, 0);
});

test("buildFamilyGroups attaches progress summaries and distinguishes system vs custom families", () => {
  setupGame();
  const groups = buildFamilyGroups(
    { id: "forest" },
    [{ id: "beasts", name: "Forest Beasts", image: "beasts.webp" }],
    [
      { uuid: "Actor.wolf", familyId: "beasts", progressTier: 2, isMissing: false },
      { uuid: "Actor.goblin", familyId: "__ungrouped__", progressTier: 0, isMissing: false },
    ],
    true,
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].isSystemGroup, false);
  assert.equal(groups[0].progress.known, 1);
  assert.equal(groups[0].progress.total, 1);
  assert.equal(groups[1].isSystemGroup, true);
  assert.equal(groups[1].progress.known, 0);
  assert.equal(groups[1].progress.total, 1);
});

test("BestiaryApp switches to collection workspace in-place without closing and recovers gracefully when removed", async () => {
  setupGame();
  const app = new BestiaryApp();
  await app.openCollection("forest");

  assert.equal(app.closeCount, 0);
  assert.equal(app._activeView, "collection");
  assert.equal(app._activeSectionId, "forest");

  const colContext = await app._prepareContext();
  assert.equal(colContext.isCollection, true);
  assert.equal(colContext.collection.sectionName, "Whispering Woods");
  assert.equal(colContext.collection.showcaseFamilies.length, 2);
  assert.equal(colContext.sections.find((section) => section.id === "forest").isActive, true);

  app._onSetLibraryView({}, { dataset: { libraryView: "overview" } });
  assert.equal(app._activeView, "overview");
  assert.equal(app._activeSectionId, null);

  await app.openCollection("nonexistent");
  const fallbackContext = await app._prepareContext();
  assert.equal(fallbackContext.isCollection, false);
  assert.equal(fallbackContext.isOverview, true);
});

test("UX redesign invariants hold across templates, custom silhouette SVG, and CSS rules", () => {
  assert.equal(SILHOUETTE_PLACEHOLDER, "modules/bestiary-journal/assets/unknown-creature.svg");
  const svg = readFileSync(join(process.cwd(), "assets/unknown-creature.svg"), "utf8");
  assert.match(svg, /<svg\b/);

  for (const templatePath of ["templates/bestiary-main.hbs", "templates/section-view.hbs"]) {
    const html = readFileSync(join(process.cwd(), templatePath), "utf8");
    assert.doesNotMatch(html, /library-brand|library-top-actions|library-creature-actions|is-color-/);
    assert.match(html, /collection-families-view/);
    assert.match(html, /family-header-bg/);
    assert.match(html, /family-cover-frame/);
    assert.match(html, /creature-card-quick/);
  }

  const creatureHtml = readFileSync(join(process.cwd(), "templates/creature-view.hbs"), "utf8");
  assert.match(creatureHtml, /creature-vitals-strip/);
  assert.match(creatureHtml, /creature-traits-ledger/);
  assert.match(creatureHtml, /ability-meta/);
  assert.doesNotMatch(creatureHtml, /creature-key-stats|creature-info-grid/);

  const frameCss = readFileSync(join(process.cwd(), "styles/frame.css"), "utf8");
  assert.match(frameCss, /\.bestiary-app:is\(\.minimized,\s*\.minimizing\)/);

  const libraryCss = readFileSync(join(process.cwd(), "styles/library.css"), "utf8");
  assert.match(libraryCss, /\.library-collection-nav:has\(\.library-nav-item\)/);
  assert.match(
    libraryCss,
    /\.library-scroll\.is-searching[\s\S]*?:not\(\.library-search-results,\s*\.library-creature-results,\s*\.library-notes-feed\)/,
  );

  const templateFiles = readdirSync(join(process.cwd(), "templates")).filter((name) => name.endsWith(".hbs"));
  assert.equal(templateFiles.length >= 9, true);
  for (const name of templateFiles) {
    const html = readFileSync(join(process.cwd(), "templates", name), "utf8");
    assert.doesNotMatch(
      html,
      /class="[^"]*\b(?:library-search|library-eyebrow)(?:\s|")/,
      `Legacy class in ${name}`,
    );
  }

  assert.match(creatureHtml, /is-previewing/);
  assert.match(creatureHtml, /btn-primary-soft/);
  assert.match(creatureHtml, /rail-inline-button is-danger/);

  const frameCssNew = readFileSync(join(process.cwd(), "styles/frame.css"), "utf8");
  assert.match(frameCssNew, /\.toolbar-search/);
  assert.match(frameCssNew, /\.window-kicker/);
  assert.match(frameCssNew, /\.inline-tip/);
  assert.match(
    frameCssNew,
    /\.bestiary-frame:not\(\.is-silhouette,\s*\.is-placeholder,\s*\.bestiary-art\)::after/,
  );

  const creatureCss = readFileSync(join(process.cwd(), "styles/creature.css"), "utf8");
  assert.doesNotMatch(creatureCss, /container:\s*bestiary-card/);
  assert.match(creatureCss, /container:\s*bestiary-sheet \/ size/);
  for (const cssFile of ["library.css", "collection.css", "creature.css", "board.css", "editors.css"]) {
    const css = readFileSync(join(process.cwd(), "styles", cssFile), "utf8");
    assert.match(css, /@container bestiary-window/, `Missing container query in ${cssFile}`);
    assert.doesNotMatch(css, /@media\s*\(max-width:/, `Legacy viewport media query in ${cssFile}`);
  }
});

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    contains: (name) => set.has(name),
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle: (name, force) => {
      const next = typeof force === "boolean" ? force : !set.has(name);
      if (next) set.add(name);
      else set.delete(name);
      return next;
    },
  };
}

test("KnowledgeBoard excludes hidden filtered rows from Apply Selected and restores rows via _clearSearch", async () => {
  const values = setupGame({
    players: [
      { id: "p1", name: "Alice", isGM: false },
      { id: "p2", name: "Bob", isGM: false },
    ],
  });
  const board = new BestiaryKnowledgeBoard({ sectionId: "forest" });
  await board._prepareContext();
  board._selectedUuids.add("Actor.wolf");
  board._selectedUuids.add("Actor.goblin");

  const wolfRow = {
    dataset: { uuid: "Actor.wolf", searchText: "dire wolf beast" },
    classList: createClassList(["is-selected"]),
  };
  const goblinRow = {
    dataset: { uuid: "Actor.goblin", searchText: "goblin scout" },
    classList: createClassList(["is-selected", "is-filtered-out"]),
  };
  const searchInput = { value: "wolf", focus() {} };
  const clearBtn = { classList: createClassList(["is-visible"]) };
  const emptyBanner = { hidden: true };

  board._searchQuery = "wolf";
  board.element = {
    querySelector: (selector) =>
      ({
        ".board-bulk-tier": { value: "3" },
        ".board-bulk-user": { value: "" },
        ".board-search-input": searchInput,
        ".board-search-clear": clearBtn,
        ".board-search-empty": emptyBanner,
      })[selector] ?? null,
    querySelectorAll: (selector) => {
      if (selector === "tbody tr[data-uuid]") return [wolfRow, goblinRow];
      return [];
    },
  };

  await board._onApplySelected();
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.wolf"].tier, 3);
  assert.equal(values.bestiaryKnowledge.users.p2["Actor.wolf"].tier, 3);
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.goblin"].tier, 1);
  assert.equal(values.bestiaryKnowledge.users.p2["Actor.goblin"].tier, 0);
  assert.equal(board._selectedUuids.has("Actor.wolf"), false);
  assert.equal(board._selectedUuids.has("Actor.goblin"), true);

  board._clearSearch();
  assert.equal(searchInput.value, "");
  assert.equal(board._searchQuery, "");
  assert.equal(goblinRow.classList.contains("is-filtered-out"), false);
  assert.equal(clearBtn.classList.contains("is-visible"), false);
});

test("CollectionWorkspaceController filters showcase families case-insensitively, preserves create card, toggles empty state, and sets party tier", async () => {
  const values = setupGame({
    players: [
      { id: "p1", name: "Alice", isGM: false },
      { id: "p2", name: "Bob", isGM: false },
    ],
  });
  const familyBeasts = {
    dataset: { familyId: "beasts", searchText: "Forest Beasts" },
    classList: createClassList(),
  };
  const familyUngrouped = {
    dataset: { familyId: "__ungrouped__", searchText: "Ungrouped" },
    classList: createClassList(),
  };
  const createCard = {
    dataset: {},
    classList: createClassList(["is-create-card"]),
  };
  const creatureWolf = {
    dataset: { searchText: "Dire Wolf", creatureType: "beast", sizeKey: "med", cr: "1", familyId: "beasts" },
    classList: createClassList(),
  };
  const creatureGoblin = {
    dataset: {
      searchText: "Goblin Scout",
      creatureType: "humanoid",
      sizeKey: "sm",
      cr: "0.25",
      familyId: "__ungrouped__",
    },
    classList: createClassList(),
  };
  const workspace = { classList: createClassList() };
  const searchInput = { value: "forest" };

  const root = {
    querySelector: (selector) =>
      ({
        ".collection-workspace": workspace,
        ".collection-search-input": searchInput,
        ".filter-count-badge": null,
        ".collection-search-clear": null,
        ".active-filter-chips": null,
      })[selector] ?? null,
    querySelectorAll: (selector) => {
      if (selector === ".collection-grid-view [data-creature-entry]") return [creatureWolf, creatureGoblin];
      if (selector === ".collection-list-view [data-creature-entry]") return [];
      if (selector === ".collection-sort-container") return [];
      if (selector === "[data-family-group]") return [];
      if (selector === ".family-showcase-card:not(.is-create-card)") return [familyBeasts, familyUngrouped];
      if (selector === ".collection-result-count") return [];
      if (selector === ".collection-result-label") return [];
      if (selector === ".collection-filter-panel input") return [];
      return [];
    },
  };

  const controller = new CollectionWorkspaceController({ element: root }, "forest");
  controller.state.viewMode = "families";
  controller.state.searchQuery = "forest";
  controller.state.selectedUuid = "Actor.goblin";

  controller.applyClientState();
  assert.equal(familyBeasts.classList.contains("is-filtered-out"), false);
  assert.equal(familyUngrouped.classList.contains("is-filtered-out"), true);
  assert.equal(createCard.classList.contains("is-filtered-out"), false);
  assert.equal(workspace.classList.contains("is-filtered-empty"), false);

  controller.state.searchQuery = "nomatch";
  controller.applyClientState();
  assert.equal(familyBeasts.classList.contains("is-filtered-out"), true);
  assert.equal(workspace.classList.contains("is-filtered-empty"), true);

  controller.resetAllFiltering();
  assert.equal(searchInput.value, "");
  assert.equal(controller.state.searchQuery, "");
  assert.equal(workspace.classList.contains("is-filtered-empty"), false);

  await controller.setPartyTier(2);
  assert.equal(values.bestiaryKnowledge.users.p1["Actor.goblin"].tier, 2);
  assert.equal(values.bestiaryKnowledge.users.p2["Actor.goblin"].tier, 2);
});

test("BestiaryApp._applySearch matches mixed-case text and toggles notes empty state", () => {
  setupGame();
  const app = new BestiaryApp();
  const wolfNote = { dataset: { searchText: "Dire Wolf Pack Note" }, classList: createClassList() };
  const goblinNote = { dataset: { searchText: "Goblin Ambush" }, classList: createClassList() };
  const clearBtn = { classList: createClassList() };
  const scroll = { classList: createClassList() };
  const notesFeed = {
    classList: createClassList(),
    querySelectorAll: (selector) => (selector === ".notes-feed-item" ? [wolfNote, goblinNote] : []),
  };

  app.element = {
    querySelector: (selector) =>
      ({
        ".library-search-clear": clearBtn,
        ".library-scroll": scroll,
        ".library-search-results, .library-creature-results": null,
        ".library-notes-feed": notesFeed,
      })[selector] ?? null,
    querySelectorAll: (selector) => (selector === "[data-search-text]" ? [wolfNote, goblinNote] : []),
  };

  app._searchQuery = "wolf";
  app._applySearch();
  assert.equal(wolfNote.classList.contains("is-filtered-out"), false);
  assert.equal(goblinNote.classList.contains("is-filtered-out"), true);
  assert.equal(notesFeed.classList.contains("is-empty"), false);
  assert.equal(clearBtn.classList.contains("is-visible"), true);

  app._searchQuery = "absent";
  app._applySearch();
  assert.equal(notesFeed.classList.contains("is-empty"), true);
});

test("Minimize CSS guards, narrow dock rules, and viewport ceilings hold across styles", () => {
  const frameCss = readFileSync(join(process.cwd(), "styles/frame.css"), "utf8");
  assert.match(frameCss, /\.bestiary-app\.minimized\s*>\s*\.window-content/);
  assert.match(frameCss, /max-height:\s*calc\(100dvh - 16px\)/);

  const libraryCss = readFileSync(join(process.cwd(), "styles/library.css"), "utf8");
  assert.match(libraryCss, /\.library-sidebar-footer[\s\S]*?display:\s*flex/);
  assert.match(libraryCss, /\.library-create-button[\s\S]*?width:\s*auto/);
  assert.match(libraryCss, /\.library-collection-nav:empty/);

  const creatureCss = readFileSync(join(process.cwd(), "styles/creature.css"), "utf8");
  assert.match(
    creatureCss,
    /\.creature-vitals-strip[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
});

test("Window openers maximize minimized instances and switch creature rail tab cleanly", () => {
  setupGame();
  const calls = { maxBoard: 0, maxGuide: 0, maxMain: 0, maxCreature: 0, frontCreature: 0, renderCreature: 0 };

  const fakeBoard = {
    _scope: "forest",
    minimized: true,
    render: () => {},
    maximize: () => {
      fakeBoard.minimized = false;
      calls.maxBoard += 1;
    },
    bringToFront: () => {},
  };
  const fakeGuide = {
    minimized: true,
    setTab: () => {},
    maximize: () => {
      fakeGuide.minimized = false;
      calls.maxGuide += 1;
    },
    bringToFront: () => {},
  };
  foundry.applications.instances.set(BestiaryKnowledgeBoard.DEFAULT_OPTIONS.id, fakeBoard);
  foundry.applications.instances.set(BestiaryGuideApp.DEFAULT_OPTIONS.id, fakeGuide);

  BestiaryKnowledgeBoard.open("forest");
  BestiaryGuideApp.open({ tab: "research" });
  assert.equal(calls.maxBoard, 1);
  assert.equal(calls.maxGuide, 1);

  foundry.applications.instances.delete(BestiaryKnowledgeBoard.DEFAULT_OPTIONS.id);
  foundry.applications.instances.delete(BestiaryGuideApp.DEFAULT_OPTIONS.id);

  const api = createApi();
  let closed = 0;
  api.mainApp = {
    rendered: true,
    minimized: true,
    maximize: () => {
      api.mainApp.minimized = false;
      calls.maxMain += 1;
    },
    bringToFront: () => {},
    close: () => {
      closed += 1;
    },
  };

  api.toggle();
  assert.equal(calls.maxMain, 1);
  assert.equal(closed, 0);

  api.toggle();
  assert.equal(closed, 1);

  const fakeCreature = {
    actorUuid: "Actor.wolf",
    rendered: true,
    minimized: true,
    _rail: "knowledge",
    render: () => {
      calls.renderCreature += 1;
    },
    maximize: () => {
      fakeCreature.minimized = false;
      calls.maxCreature += 1;
    },
    bringToFront: () => {
      calls.frontCreature += 1;
    },
  };
  BestiaryCreatureView._instances.add(fakeCreature);
  try {
    api.openCreature("Actor.wolf", { rail: "comments" });
    assert.equal(fakeCreature._rail, "comments");
    assert.equal(calls.renderCreature, 1);
    assert.equal(calls.maxCreature, 1);
    assert.equal(calls.frontCreature, 1);
  } finally {
    BestiaryCreatureView._instances.delete(fakeCreature);
  }
});
