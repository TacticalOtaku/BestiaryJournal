import test from "node:test";
import assert from "node:assert/strict";

import { handleBestiaryStoreSocket } from "../scripts/foundry/bestiary-store.js";

const UUID = "Actor.goblin";

/** Just enough Foundry for the authoritative GM to relay a player's command. */
function setupWorld() {
  const values = {
    bestiaryData: { sections: [{ id: "s1", name: "Caves", creatures: [{ uuid: UUID }] }] },
    bestiaryKnowledge: {},
    bestiarySocial: {},
    tierBlockConfig: {},
    researchRollEnabled: true,
    researchSingleAttempt: false
  };
  const flags = {};
  const user = (id, isGM) => ({
    id,
    isGM,
    active: true,
    getFlag: (scope, key) => flags[`${id}.${key}`],
    unsetFlag: async (scope, key) => delete flags[`${id}.${key}`]
  });
  const gm = user("gm", true);
  const player = user("p1", false);
  const users = [gm, player];
  const emitted = [];
  const messages = new Map();
  let counter = 0;

  globalThis.game = {
    user: gm,
    users: { contents: users, get: id => users.find(item => item.id === id), filter: fn => users.filter(fn) },
    settings: {
      get: (scope, key) => structuredClone(values[key]),
      set: async (scope, key, value) => {
        values[key] = structuredClone(value);
      }
    },
    socket: { emit: (name, message) => emitted.push(message) },
    messages: { get: id => messages.get(id) },
    actors: { get: id => (id === "hero" ? { name: "Hero", testUserPermission: owner => owner.id === "p1" } : null) },
    i18n: { localize: key => key, format: key => key, has: () => false }
  };
  globalThis.foundry = { utils: { randomID: () => `id${++counter}` } };
  globalThis.Hooks = { callAll() {} };
  globalThis.CONFIG = { DND5E: { skills: {} } };
  globalThis.fromUuid = async () => ({ name: "Goblin", system: { details: { cr: 0.25, type: { value: "humanoid" } } } });
  globalThis.ChatMessage = { create: async () => ({}) };
  globalThis.document = {
    createElement: () => ({ className: "", textContent: "", append() {}, outerHTML: "<div></div>" })
  };

  /** What a player's client does: persist the request on its own user, then name it over the socket. */
  async function send(requestId, command, { requesterId = "p1" } = {}) {
    flags[`${requesterId}.commandRequest`] = JSON.stringify({ requestId, command, issuedAt: Date.now() });
    await handleBestiaryStoreSocket({ action: "bestiaryCommand", requestId, requesterId });
    return emitted.at(-1);
  }

  function addRoll(id, { consumed = false, total = 18 } = {}) {
    const message = {
      id,
      flags: { research: { uuid: UUID, consumed } },
      getFlag: (scope, key) => (scope === "dnd5e" ? { type: "skill", skillId: "his" } : message.flags[key]),
      setFlag: async (scope, key, value) => {
        message.flags[key] = value;
      },
      rolls: [{ total }],
      author: { id: "p1" },
      speaker: { actor: "hero" },
      timestamp: Date.now(),
      whisper: [],
      blind: false
    };
    messages.set(id, message);
    return message;
  }

  return { values, flags, send, addRoll };
}

const comment = { type: "addComment", uuid: UUID, text: "Smells of smoke", channel: "party" };

test("a replayed request runs its command once", async () => {
  const world = setupWorld();
  assert.equal((await world.send("r-replay", comment)).error, null);
  assert.equal(world.flags["p1.commandRequest"], undefined, "the GM clears the handled request");
  await world.send("r-replay", comment);
  assert.equal(world.values.bestiarySocial.comments.length, 1);
});

test("a socket message naming a request the player never persisted is rejected", async () => {
  const world = setupWorld();
  world.flags["p1.commandRequest"] = JSON.stringify({ requestId: "r-real", command: comment });
  await handleBestiaryStoreSocket({ action: "bestiaryCommand", requestId: "r-forged", requesterId: "p1" });
  assert.equal(world.values.bestiarySocial.comments, undefined);
});

test("a player cannot run a GM command through the relay", async () => {
  const world = setupWorld();
  const result = await world.send("r-gm", { type: "setKnowledge", uuid: UUID, userIds: ["p1"], tier: 3 });
  assert.equal(result.error, "BESTIARY.Errors.GmOnly");
  assert.deepEqual(world.values.bestiaryKnowledge, {});
});

test("a research roll is judged by the GM and counts once", async () => {
  const world = setupWorld();
  const roll = world.addRoll("m1");
  const research = { type: "recordResearch", uuid: UUID, sectionId: "s1", messageId: "m1" };

  assert.equal((await world.send("r-roll", research)).error, null);
  assert.equal(world.values.bestiaryKnowledge.users.p1[UUID].tier, 1);
  assert.equal(roll.flags.research.consumed, true);

  const replay = await world.send("r-roll-again", research);
  assert.equal(replay.error, "BESTIARY.Errors.ResearchUnverified");
  assert.equal(world.values.bestiaryKnowledge.users.p1[UUID].tier, 1);
});

test("a roll made by someone else's character is rejected", async () => {
  const world = setupWorld();
  world.addRoll("m2").speaker.actor = "villain";
  const result = await world.send("r-foreign", { type: "recordResearch", uuid: UUID, messageId: "m2" });
  assert.equal(result.error, "BESTIARY.Errors.ResearchUnverified");
  assert.deepEqual(world.values.bestiaryKnowledge, {});
});
