import test from "node:test";
import assert from "node:assert/strict";

import { enrichText, extractItemActivities, localizeConfigLabel } from "../scripts/integrations/dnd5e.js";

globalThis.game = { i18n: { localize: key => key, has: () => false } };
globalThis.CONFIG = { DND5E: { abilities: { dex: { abbreviation: "DEX" }, con: { abbreviation: "CON" } } } };

test("activities read the dnd5e 5.3 shapes: prepared to-hit and damage, a Set of save abilities", () => {
  const item = {
    id: "breath",
    system: {
      activities: new Map([
        ["a1", {
          id: "a1", name: "Bite", type: "attack", actionType: "mwak", activation: { type: "action" },
          attack: { bonus: "" },
          damage: { parts: [{ formula: "1d6 + @mod", types: new Set(["piercing"]) }] },
          labels: { toHit: "+4", damage: [{ label: "1d6 + 2 Piercing" }] }
        }],
        ["a2", {
          id: "a2", name: "Breath", type: "save", activation: { type: "action" },
          save: { ability: new Set(["dex", "con"]), dc: { value: 13 } },
          labels: {}
        }]
      ])
    }
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
    druidic: "Druidic"
  };
  assert.equal(localizeConfigLabel(languages, "common", "common"), "Common");
  assert.equal(localizeConfigLabel(languages, "goblin", "goblin"), "Goblin");
  assert.equal(localizeConfigLabel(languages, "druidic"), "Druidic");
  assert.equal(localizeConfigLabel(languages, "abyssal", "abyssal"), "abyssal", "an unknown key keeps its fallback");
});
