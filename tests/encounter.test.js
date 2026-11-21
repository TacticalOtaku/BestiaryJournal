import test from "node:test";
import assert from "node:assert/strict";

import {
  collectCombatantRevealUuids,
  collectTokenRevealUuids,
  collectVisibleEncounterUuids,
  registerEncounterReveal,
} from "../scripts/foundry/encounter.js";

const bestiaryData = {
  sections: [
    {
      id: "caves",
      name: "Caves",
      creatures: [
        { uuid: "Actor.goblin" },
        { uuid: "Actor.ambusher" },
        { uuid: "Actor.invisible" },
        { uuid: "Actor.ally" },
        { uuid: "Actor.wolf" },
        { uuid: "Actor.hero" },
      ],
    },
  ],
};

test("collectVisibleEncounterUuids skips hidden combatants, hidden tokens, friendly NPCs, non-NPCs, and untracked actors", () => {
  globalThis.CONST = {
    TOKEN_DISPOSITIONS: { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 },
  };
  const combat = {
    combatants: [
      {
        actor: { type: "npc", uuid: "Actor.goblin" },
        hidden: false,
        token: { hidden: false, disposition: -1 },
      },
      {
        actor: { type: "npc", uuid: "Actor.wolf" },
        hidden: false,
        token: { hidden: false, disposition: 0 },
      },
      {
        actor: { type: "npc", uuid: "Actor.ally" },
        hidden: false,
        token: { hidden: false, disposition: 1 },
      },
      {
        actor: { type: "npc", uuid: "Actor.ambusher" },
        hidden: true,
        token: { hidden: false, disposition: -1 },
      },
      {
        actor: { type: "npc", uuid: "Actor.invisible" },
        hidden: false,
        token: { hidden: true, disposition: -1 },
      },
      {
        actor: { type: "character", uuid: "Actor.hero" },
        hidden: false,
        token: { hidden: false, disposition: 1 },
      },
      {
        actor: { type: "npc", uuid: "Actor.stranger" },
        hidden: false,
        token: { hidden: false, disposition: -1 },
      },
      {
        actor: { type: "npc", uuid: "Scene.1.Token.1.Actor.x" },
        hidden: false,
        token: { hidden: false, disposition: -1, baseActor: { uuid: "Actor.goblin" } },
      },
    ],
  };

  assert.deepEqual([...collectVisibleEncounterUuids(combat, bestiaryData)], ["Actor.goblin", "Actor.wolf"]);
});

test("collectVisibleEncounterUuids handles missing combat or empty combatants safely", () => {
  assert.deepEqual([...collectVisibleEncounterUuids(null, bestiaryData)], []);
  assert.deepEqual([...collectVisibleEncounterUuids({ combatants: [] }, bestiaryData)], []);
});

test("collectCombatantRevealUuids reveals only when an unhidden non-friendly combatant is in a started combat", () => {
  const combat = { started: true };
  const ambusher = {
    combat,
    actor: { type: "npc", uuid: "Actor.ambusher" },
    hidden: false,
    token: { hidden: false, disposition: -1 },
  };
  assert.deepEqual(
    [...collectCombatantRevealUuids(ambusher, bestiaryData, { hidden: false })],
    ["Actor.ambusher"],
  );
  assert.deepEqual([...collectCombatantRevealUuids(ambusher, bestiaryData, { initiative: 14 })], []);
  assert.deepEqual(
    [
      ...collectCombatantRevealUuids({ ...ambusher, combat: { started: false } }, bestiaryData, {
        hidden: false,
      }),
    ],
    [],
  );
  assert.deepEqual(
    [
      ...collectCombatantRevealUuids(
        { ...ambusher, token: { hidden: true, disposition: -1 } },
        bestiaryData,
        { hidden: false },
      ),
    ],
    [],
  );
  assert.deepEqual(
    [
      ...collectCombatantRevealUuids(
        { ...ambusher, token: { hidden: false, disposition: 1 } },
        bestiaryData,
        { hidden: false },
      ),
    ],
    [],
  );
});

test("collectTokenRevealUuids reveals when a hidden token or traitor disposition flips mid-combat", () => {
  const token = { id: "tok1", hidden: false, disposition: -1, parent: { id: "scene1" } };
  const combat = {
    started: true,
    scene: { id: "scene1" },
    combatants: [
      {
        token,
        tokenId: "tok1",
        hidden: false,
        actor: { type: "npc", uuid: "Actor.invisible" },
      },
    ],
  };

  assert.deepEqual(
    [...collectTokenRevealUuids(token, [combat], bestiaryData, { hidden: false })],
    ["Actor.invisible"],
  );
  assert.deepEqual(
    [...collectTokenRevealUuids(token, [combat], bestiaryData, { disposition: -1 })],
    ["Actor.invisible"],
  );
  assert.deepEqual([...collectTokenRevealUuids(token, [combat], bestiaryData, { x: 200 })], []);

  const friendlyToken = { ...token, disposition: 1 };
  combat.combatants[0].token = friendlyToken;
  assert.deepEqual(
    [...collectTokenRevealUuids(friendlyToken, [combat], bestiaryData, { hidden: false })],
    [],
  );

  combat.combatants[0].hidden = true;
  assert.deepEqual([...collectTokenRevealUuids(token, [combat], bestiaryData, { hidden: false })], []);
});

test("registerEncounterReveal hooks respect encounterReveal and encounterRevealOnUnhide settings", async () => {
  const hooks = new Map();
  globalThis.Hooks = {
    on: (name, fn) => hooks.set(name, fn),
    callAll() {},
  };

  const token = { id: "tok2", hidden: false, disposition: -1, parent: { id: "scene1" } };
  const combat = {
    started: true,
    scene: { id: "scene1" },
    combatants: [
      {
        combat: null,
        token,
        tokenId: "tok2",
        hidden: false,
        actor: { type: "npc", uuid: "Actor.ambusher" },
      },
    ],
  };
  combat.combatants[0].combat = combat;

  const settings = {
    bestiaryData,
    bestiaryKnowledge: { revision: 0, users: {} },
    encounterReveal: true,
    encounterRevealOnUnhide: false,
  };
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "p1", name: "Ann", isGM: false, active: true };
  globalThis.game = {
    user: gm,
    users: { contents: [gm, player], get: (id) => (id === "gm" ? gm : player) },
    combats: { contents: [combat] },
    settings: {
      get: (_scope, key) => structuredClone(settings[key]),
      set: async (_scope, key, value) => {
        settings[key] = structuredClone(value);
      },
    },
    i18n: { localize: (key) => key, has: () => false },
  };

  registerEncounterReveal(() => true);

  // Disabled mid-combat reveal: updateToken & updateCombatant do nothing
  hooks.get("updateToken")(token, { hidden: false });
  hooks.get("updateCombatant")(combat.combatants[0], { hidden: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settings.bestiaryKnowledge.users.p1, undefined);

  // Enable mid-combat reveal: updateToken grants Rumors (tier 1)
  settings.encounterRevealOnUnhide = true;
  hooks.get("updateToken")(token, { hidden: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settings.bestiaryKnowledge.users.p1["Actor.ambusher"].tier, 1);
  assert.equal(settings.bestiaryKnowledge.users.p1["Actor.ambusher"].source, "encounter");
});
