import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
});
