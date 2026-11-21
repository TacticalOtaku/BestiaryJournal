import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options) {
          this.options = options;
        }
        async render() {
          return this;
        }
      },
      HandlebarsApplicationMixin: (Base) => Base,
    },
  },
  utils: {
    randomID: (() => {
      let id = 0;
      return () => `cid${++id}`;
    })(),
  },
};
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.document = { addEventListener() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { GM_TIER, NEVER_TIER, RESEARCH_TIERS, defaultResearchTiers } =
  await import("../scripts/core/research-model.js");
const { saveResearchTierConfig } = await import("../scripts/foundry/bestiary-store.js");
const { syncEncounterRevealTierChoices } = await import("../scripts/foundry/settings.js");
const { buildTierSteps } = await import("../scripts/ui/creature-statblock.js");
const { BestiaryTierSettings } = await import("../scripts/ui/tier-settings.js");

function setupWorld() {
  const encounterSettingMeta = { choices: {} };
  const settings = {
    researchTiers: defaultResearchTiers(),
    tierBlockConfig: { hp: 2, biography: 3, alignment: NEVER_TIER },
    encounterRevealTier: 1,
    bestiaryData: {
      revision: 1,
      sections: [
        {
          id: "s1",
          name: "Caves",
          creatures: [{ uuid: "Actor.goblin", blockTiers: { ac: 2, biography: 3, alignment: NEVER_TIER } }],
        },
      ],
    },
    bestiaryKnowledge: {
      revision: 1,
      users: { p1: { "Actor.goblin": { tier: 2 } } },
    },
    bestiarySocial: { revision: 0, comments: [] },
    includeCustomSkills: false,
  };
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const emitted = [];

  globalThis.game = {
    user: gm,
    users: { contents: [gm], get: (id) => (id === "gm" ? gm : null) },
    settings: {
      settings: new Map([["bestiary-journal.encounterRevealTier", encounterSettingMeta]]),
      get: (_scope, key) => structuredClone(settings[key]),
      set: async (_scope, key, value) => {
        settings[key] = structuredClone(value);
        if (key === "researchTiers") syncEncounterRevealTierChoices();
      },
    },
    socket: { emit: (_name, msg) => emitted.push(msg) },
    i18n: { localize: (key) => key, format: (key) => key, has: () => false },
  };

  return { settings, encounterSettingMeta, emitted };
}

test("saveResearchTierConfig inserts a custom tier and remaps block rules, creature entries, player knowledge, and encounter reveal tier", async () => {
  const { settings, encounterSettingMeta, emitted } = setupWorld();
  settings.encounterRevealTier = 2;

  const inserted = [
    RESEARCH_TIERS[0],
    { id: "sightings", label: "Sightings", hint: "Spotted from afar", icon: "fa-eye", color: "frost" },
    RESEARCH_TIERS[1],
    RESEARCH_TIERS[2],
    RESEARCH_TIERS[3],
  ];

  await saveResearchTierConfig({
    tiers: inserted,
    blockTiers: { hp: 3, biography: 4, alignment: NEVER_TIER },
  });

  assert.equal(settings.researchTiers.length, 5);
  assert.equal(settings.researchTiers[1].label, "Sightings");
  assert.equal(settings.encounterRevealTier, 3, "encounter target shifted along with its tier");
  assert.equal(encounterSettingMeta.choices["1"], "Sightings");
  assert.equal(settings.bestiaryData.sections[0].creatures[0].blockTiers.ac, 3);
  assert.equal(settings.bestiaryData.sections[0].creatures[0].blockTiers.biography, 4);
  assert.equal(settings.bestiaryData.sections[0].creatures[0].blockTiers.alignment, NEVER_TIER);
  assert.equal(settings.bestiaryKnowledge.users.p1["Actor.goblin"].tier, 3);
  assert.ok(emitted.some((msg) => msg.action === "refreshBestiary"));
});

test("BestiaryTierSettings edits, inserts, reorders, deletes tiers, and saves atomically", async () => {
  const { settings } = setupWorld();
  const app = new BestiaryTierSettings();
  await app._prepareContext();

  // Insert a new tier after Unknown (index 0 -> lands at index 1)
  app._onInsertTier(0);
  assert.equal(app._tiersDraft.length, 5);
  assert.equal(app._blockDraft.hp, 3);
  assert.equal(app._blockDraft.biography, 4);

  // Rename the inserted tier and preserve unmodified built-in i18n keys
  app._updateTierField(1, "label", "Tracks & Signs");
  app._updateTierField(1, "color", "arcane");
  app._updateTierField(1, "icon", "fa-magnifying-glass");
  app._updateTierField(0, "label", "BESTIARY.Tier.Unknown");

  // Move inserted tier from 1 -> 2
  app._onMoveTier(1, 2);
  assert.equal(app._tiersDraft[2].label, "Tracks & Signs");
  assert.equal(app._blockDraft.hp, 3);

  // Submit form -> persists custom tiers and remaps player knowledge (2 -> 3)
  await app._onFormSubmit();
  assert.equal(settings.researchTiers.length, 5);
  assert.equal(settings.researchTiers[0].label, "BESTIARY.Tier.Unknown");
  assert.equal(settings.researchTiers[2].label, "Tracks & Signs");
  assert.equal(settings.researchTiers[2].color, "arcane");
  assert.equal(settings.bestiaryKnowledge.users.p1["Actor.goblin"].tier, 3);

  // buildTierSteps renders all 5 steps with their colors and reached state
  const steps = buildTierSteps(3, settings.researchTiers);
  assert.equal(steps.length, 5);
  assert.equal(steps[2].color, "arcane");
  assert.equal(steps[3].isCurrent, true);
  assert.equal(steps[4].reached, false);

  // In GM view, every tier bar is unlocked equally without flagging any single tier as current
  const gmSteps = buildTierSteps(GM_TIER, settings.researchTiers);
  assert.equal(
    gmSteps.every((step) => step.reached && !step.isCurrent),
    true,
  );

  // Remove the custom tier and save -> reverts smoothly back to 4 tiers and remaps 3 -> 2
  const app2 = new BestiaryTierSettings();
  await app2._prepareContext();
  app2._onRemoveTier(2);
  assert.equal(app2._tiersDraft.length, 4);
  await app2._onFormSubmit();
  assert.equal(settings.researchTiers.length, 4);
  assert.equal(settings.bestiaryKnowledge.users.p1["Actor.goblin"].tier, 2);
});
