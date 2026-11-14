import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichText,
  extractItemActivities,
  getDnd5eSkillIds,
  localizeConfigLabel,
  readResearchRoll,
  skillLabel,
} from "../scripts/integrations/dnd5e.js";

globalThis.game = { i18n: { localize: (key) => key, has: () => false } };
globalThis.CONFIG = { DND5E: { abilities: { dex: { abbreviation: "DEX" }, con: { abbreviation: "CON" } } } };

test("activities read the dnd5e 5.3 shapes: prepared to-hit and damage, a Set of save abilities", () => {
  const item = {
    id: "breath",
    system: {
      activities: new Map([
        [
          "a1",
          {
            id: "a1",
            name: "Bite",
            type: "attack",
            actionType: "mwak",
            activation: { type: "action" },
            attack: { bonus: "" },
            damage: { parts: [{ formula: "1d6 + @mod", types: new Set(["piercing"]) }] },
            labels: { toHit: "+4", damage: [{ label: "1d6 + 2 Piercing" }] },
          },
        ],
        [
          "a2",
          {
            id: "a2",
            name: "Breath",
            type: "save",
            activation: { type: "action" },
            save: { ability: new Set(["dex", "con"]), dc: { value: 13 } },
            labels: {},
          },
        ],
      ]),
    },
  };
  const [bite, breath] = extractItemActivities(item);
  assert.equal(bite.typeLabel, "BESTIARY.ActivityAttack");
  assert.equal(bite.attack, "+4");
  assert.equal(bite.damage, "1d6 + 2 Piercing");
  assert.equal(breath.save, "DEX/CON DC 13");
});

test("a failed enrichment shows nothing instead of the raw text with its GM secrets", async () => {
  const enrichHTML = async () => {
    throw new Error("broken embed");
  };
  globalThis.foundry = { applications: { ux: { TextEditor: { implementation: { enrichHTML } } } } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await enrichText('<p>Old.</p><section class="secret">A lich in disguise</section>'), "");
  } finally {
    console.warn = warn;
  }
});

test("languages are named from dnd5e's nested catalogue, not shown as keys", () => {
  const languages = {
    standard: { label: "Standard", children: { common: "Common", goblin: { label: "Goblin" } } },
    druidic: "Druidic",
  };
  assert.equal(localizeConfigLabel(languages, "common", "common"), "Common");
  assert.equal(localizeConfigLabel(languages, "goblin", "goblin"), "Goblin");
  assert.equal(localizeConfigLabel(languages, "druidic"), "Druidic");
  assert.equal(
    localizeConfigLabel(languages, "abyssal", "abyssal"),
    "abyssal",
    "an unknown key keeps its fallback",
  );
});

test("a research roll is read from the dnd5e flags and the message itself", () => {
  const message = {
    author: { id: "p1" },
    speaker: { actor: "hero" },
    rolls: [{ total: 17 }],
    timestamp: 42,
    getFlag: (scope, key) =>
      scope === "dnd5e" && key === "roll" ? { type: "skill", skillId: "arc" } : undefined,
  };
  assert.deepEqual(readResearchRoll(message), {
    authorId: "p1",
    actorId: "hero",
    isSkillCheck: true,
    skill: "arc",
    total: 17,
    at: 42,
  });
  assert.equal(readResearchRoll(null), null);
  assert.equal(readResearchRoll({ ...message, getFlag: () => ({ type: "attack" }) }).isSkillCheck, false);
});

test("getDnd5eSkillIds and skillLabel read custom skills from CONFIG.DND5E.skills", () => {
  const previous = globalThis.CONFIG.DND5E.skills;
  try {
    globalThis.CONFIG.DND5E.skills = {
      nat: { label: "Nature" },
      mec: { label: "Механика", ability: "int" },
      sci: { name: "Наука", ability: "int" },
      disabled: null,
    };
    assert.deepEqual(getDnd5eSkillIds(), ["nat", "mec", "sci"]);
    assert.equal(skillLabel("mec"), "Механика");
    assert.equal(skillLabel("sci"), "Наука");

    globalThis.CONFIG.DND5E.skills = new Map([
      ["mec", { label: "Механика" }],
      ["off", false],
    ]);
    assert.deepEqual(getDnd5eSkillIds(), ["mec"]);
  } finally {
    globalThis.CONFIG.DND5E.skills = previous;
  }
});
