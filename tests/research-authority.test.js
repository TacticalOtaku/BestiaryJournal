import test from "node:test";
import assert from "node:assert/strict";

import { prepareResearchCommand } from "../scripts/foundry/research-authority.js";

const UUID = "Actor.goblin";

function setupOutcome({ whisper = [], blind = false, partyTier = 0 } = {}) {
  const values = {
    bestiaryData: { sections: [{ id: "s1", creatures: [{ uuid: UUID }] }] },
    bestiaryKnowledge: {},
    tierBlockConfig: { name: 1, cr: 1 },
    researchRollEnabled: true,
    researchSingleAttempt: false
  };
  const users = [
    { id: "gm", name: "GM", isGM: true },
    { id: "p1", name: "Researcher", isGM: false },
    { id: "p2", name: "Other player", isGM: false }
  ];
  const message = {
    getFlag: (scope) => scope === "dnd5e"
      ? { type: "skill", skillId: "his" }
      : { uuid: UUID, consumed: false },
    setFlag: async () => {},
    rolls: [{ total: 30 }],
    author: { id: "p1" },
    speaker: { actor: "hero" },
    timestamp: Date.now(),
    whisper,
    blind
  };
  const outcomes = [];
  globalThis.game = {
    users: { contents: users, get: id => users.find(user => user.id === id), filter: fn => users.filter(fn) },
    settings: { get: (scope, key) => values[key] },
    messages: new Map([["roll", message]]),
    actors: new Map([["hero", { name: "Hero", testUserPermission: user => user.id === "p1" }]]),
    i18n: {
      localize: key => key,
      has: () => false,
      format: (key, data) => `${data.actor}: ${data.creature}; ${data.skill} ${data.total}${key === "BESTIARY.Research.ChatBody" ? `; DC ${data.dc}` : ""}`
    }
  };
  globalThis.CONFIG = { DND5E: { skills: {} } };
  globalThis.fromUuid = async () => ({ name: "Secret Goblin", system: { details: { cr: 2, type: { value: "humanoid" } } } });
  globalThis.ChatMessage = { create: async data => outcomes.push(data) };
  globalThis.document = {
    createElement: tag => ({
      textContent: "", children: [],
      append(...children) { this.children.push(...children); },
      get outerHTML() { return `<${tag}>${this.textContent}${this.children.map(child => child.outerHTML).join("")}</${tag}>`; }
    })
  };

  return async () => {
    const prepared = await prepareResearchCommand({ uuid: UUID, messageId: "roll" }, users[1]);
    // Finalization runs after persistence: the requester just earned Rumors.
    values.bestiaryKnowledge = { users: { p1: { [UUID]: { tier: 1 } }, p2: { [UUID]: { tier: partyTier } } } };
    await prepared.finalize({ changed: true });
    return outcomes[0];
  };
}

test("a public research result hides the name and automatic DC another player does not know", async () => {
  const outcome = await setupOutcome()();
  assert.deepEqual(outcome.whisper, []);
  assert.doesNotMatch(outcome.content, /Secret Goblin|DC \d/);
  assert.match(outcome.content, /BESTIARY.Tier.UnknownName/);
});

test("a public research result includes the name and automatic DC when the whole party knows them", async () => {
  const outcome = await setupOutcome({ partyTier: 1 })();
  assert.deepEqual(outcome.whisper, []);
  assert.match(outcome.content, /Secret Goblin/);
  assert.match(outcome.content, /DC 11/);
});

test("a whispered research result reveals only knowledge shared by every recipient", async () => {
  const outcome = await setupOutcome({ whisper: ["p2"] })();
  assert.deepEqual(new Set(outcome.whisper), new Set(["p1", "p2", "gm"]));
  assert.doesNotMatch(outcome.content, /Secret Goblin|DC \d/);
});

test("a researcher and GMs can receive the researcher's known details privately", async () => {
  const outcome = await setupOutcome({ whisper: ["gm"] })();
  assert.deepEqual(new Set(outcome.whisper), new Set(["p1", "gm"]));
  assert.match(outcome.content, /Secret Goblin/);
  assert.match(outcome.content, /DC 11/);
});

test("a blind result remains blind and reaches only GMs", async () => {
  const outcome = await setupOutcome({ blind: true, whisper: ["p2"] })();
  assert.deepEqual(outcome.whisper, ["gm"]);
  assert.equal(outcome.blind, true);
  assert.match(outcome.content, /Secret Goblin/);
  assert.match(outcome.content, /DC 11/);
});
