import test from "node:test";
import assert from "node:assert/strict";

import {
  BESTIARY_COMMANDS,
  applyBestiaryCommand,
  canViewCreature,
  createBestiaryState,
  isCreatureLocked,
  getUserTier,
  normalizeBestiaryData,
  selectComments,
  selectVisibleCreatureEntries
} from "../scripts/core/bestiary-domain.js";

let counter = 0;
const deps = { now: () => 1_000, generateId: () => `id${++counter}` };

function stateWith(sections = [], extra = {}) {
  return createBestiaryState({ data: { sections }, ...extra });
}

function sectionFixture(overrides = {}) {
  return {
    id: "sec1",
    name: "Forest",
    families: [{ id: "fam1", name: "Wolves" }],
    creatures: [{ uuid: "Actor.wolf", familyId: "fam1" }],
    ...overrides
  };
}

function run(state, command) {
  return applyBestiaryCommand(state, { isGM: true, userId: "gm", ...command }, deps);
}

test("normalizes pre-0.2 data without families or entry settings", () => {
  const data = normalizeBestiaryData({
    sections: [{ id: "a", name: "Old", creatures: [{ uuid: "Actor.x", hidden: true }] }]
  });
  const [section] = data.sections;
  assert.deepEqual(section.families, []);
  assert.equal(section.locked, false);
  assert.equal(section.creatures[0].familyId, null);
  assert.equal(section.creatures[0].image.fit, "auto");
  assert.equal(section.creatures[0].image.focusX, 50);
  assert.deepEqual(section.creatures[0].blockTiers, {});
});

test("hidden families hide their creatures from players but not the GM", () => {
  const section = sectionFixture({ families: [{ id: "fam1", name: "Wolves", hidden: true }] });
  const normalized = normalizeBestiaryData({ sections: [section] }).sections[0];
  assert.equal(selectVisibleCreatureEntries(normalized, false).length, 0);
  assert.equal(selectVisibleCreatureEntries(normalized, true).length, 1);
});

test("deleting a family releases its creatures instead of removing them", () => {
  const state = stateWith([sectionFixture()]);
  const result = run(state, {
    type: BESTIARY_COMMANDS.DELETE_FAMILY,
    sectionId: "sec1",
    familyId: "fam1"
  });
  const section = result.state.data.sections[0];
  assert.equal(section.families.length, 0);
  assert.equal(section.creatures.length, 1);
  assert.equal(section.creatures[0].familyId, null);
});

test("moving a creature to another collection carries its settings over", () => {
  const state = stateWith([
    sectionFixture({ creatures: [{ uuid: "Actor.wolf", familyId: "fam1", blockTiers: { hp: 3 } }] }),
    { id: "sec2", name: "Caves", families: [], creatures: [] }
  ]);
  const result = run(state, {
    type: BESTIARY_COMMANDS.MOVE_CREATURE,
    sectionId: "sec1",
    uuid: "Actor.wolf",
    targetSectionId: "sec2"
  });
  const [from, to] = result.state.data.sections;
  assert.equal(from.creatures.length, 0);
  assert.equal(to.creatures.length, 1);
  assert.equal(to.creatures[0].blockTiers.hp, 3);
  assert.equal(to.creatures[0].familyId, null);
});

test("assigning knowledge targets userIds, never the acting user", () => {
  const state = stateWith([sectionFixture()]);
  // The store stamps `userId` with whoever issued the command; it must not be
  // mistaken for the assignment target.
  const result = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
    uuid: "Actor.wolf",
    userIds: ["p1"],
    userId: "gm",
    isGM: true,
    tier: 2
  }, deps);

  assert.equal(getUserTier(result.state.knowledge, "p1", "Actor.wolf"), 2);
  assert.equal(getUserTier(result.state.knowledge, "gm", "Actor.wolf"), 0, "the GM must not be assigned");
  assert.equal(result.state.knowledge.users.p1["Actor.wolf"].grantedBy, "gm");
});

test("assigning knowledge without userIds changes nothing", () => {
  const state = stateWith([sectionFixture()]);
  const result = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
    uuid: "Actor.wolf", userId: "gm", isGM: true, tier: 3
  }, deps);
  assert.equal(result.changedAny, false);
  assert.equal(getUserTier(result.state.knowledge, "gm", "Actor.wolf"), 0);
});

test("resetting knowledge is scoped by userIds, not the acting user", () => {
  let state = stateWith([sectionFixture()]);
  state = run(state, { type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuid: "Actor.wolf", userIds: ["p1", "p2"], tier: 2 }).state;

  const result = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.RESET_KNOWLEDGE,
    uuid: "Actor.wolf", userIds: ["p1"], userId: "gm", isGM: true
  }, deps);
  assert.equal(getUserTier(result.state.knowledge, "p1", "Actor.wolf"), 0);
  assert.equal(getUserTier(result.state.knowledge, "p2", "Actor.wolf"), 2);
});

test("a locked entry freezes knowledge and comments for everyone", () => {
  const state = stateWith([sectionFixture({ creatures: [{ uuid: "Actor.wolf", locked: true }] })]);
  assert.equal(isCreatureLocked(state.data, "Actor.wolf"), true);

  const knowledge = run(state, {
    type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
    uuid: "Actor.wolf",
    userIds: ["p1"],
    tier: 3
  });
  assert.equal(knowledge.changedAny, false, "the lock, not a missing target, blocks this");

  const comment = run(state, {
    type: BESTIARY_COMMANDS.ADD_COMMENT,
    uuid: "Actor.wolf",
    userId: "p1",
    channel: "party",
    text: "Weak to fire"
  });
  assert.equal(comment.changedAny, false);
});

test("a locked section locks the entries inside it", () => {
  const state = stateWith([sectionFixture({ locked: true })]);
  assert.equal(isCreatureLocked(state.data, "Actor.wolf"), true);
});

test("a successful research roll raises the tier by exactly one step", () => {
  let state = stateWith([sectionFixture()]);
  for (const expected of [1, 2, 3, 3]) {
    state = applyBestiaryCommand(state, {
      type: BESTIARY_COMMANDS.RECORD_RESEARCH,
      uuid: "Actor.wolf",
      userId: "p1",
      success: true,
      total: 18,
      dc: 12,
      skill: "nat"
    }, deps).state;
    assert.equal(getUserTier(state.knowledge, "p1", "Actor.wolf"), expected);
  }
});

test("a failed roll only blocks retries when the world asks for one attempt", () => {
  const state = stateWith([sectionFixture()]);
  const lenient = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.RECORD_RESEARCH,
    uuid: "Actor.wolf", userId: "p1", success: false, total: 4, dc: 12
  }, deps).state;
  assert.equal(lenient.knowledge.users.p1["Actor.wolf"].blocked, false);
  assert.equal(lenient.knowledge.users.p1["Actor.wolf"].attempts, 1);

  const strict = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.RECORD_RESEARCH,
    uuid: "Actor.wolf", userId: "p1", success: false, total: 4, dc: 12, singleAttempt: true
  }, deps).state;
  assert.equal(strict.knowledge.users.p1["Actor.wolf"].blocked, true);
});

test("sharing is capped at the sender's tier and never lowers the recipient", () => {
  let state = stateWith([sectionFixture()]);
  state = run(state, { type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuid: "Actor.wolf", userIds: ["p1"], tier: 2 }).state;
  state = run(state, { type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuid: "Actor.wolf", userIds: ["p3"], tier: 3 }).state;

  state = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.SHARE_KNOWLEDGE,
    uuid: "Actor.wolf",
    userId: "p1",
    toUserIds: ["p2", "p3"],
    tier: 3
  }, deps).state;

  assert.equal(getUserTier(state.knowledge, "p2", "Actor.wolf"), 2, "capped at the sender's tier");
  assert.equal(getUserTier(state.knowledge, "p3", "Actor.wolf"), 3, "already knew more, left alone");
  assert.equal(state.social.shares.length, 1);
  assert.equal(state.social.shares[0].toUserId, "p2");
});

test("a player who knows nothing cannot share", () => {
  const state = stateWith([sectionFixture()]);
  const result = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.SHARE_KNOWLEDGE,
    uuid: "Actor.wolf", userId: "p1", toUserIds: ["p2"]
  }, deps);
  assert.equal(result.changedAny, false);
});

test("comment channels reach exactly the intended readers", () => {
  let state = stateWith([sectionFixture()]);
  const post = (userId, channel, text, isGM = false, shared = false) => {
    state = applyBestiaryCommand(state, {
      type: BESTIARY_COMMANDS.ADD_COMMENT,
      uuid: "Actor.wolf", userId, channel, text, isGM, shared
    }, deps).state;
  };

  post("gm", "gm", "Secret weakness", true, false);
  post("gm", "gm", "Public rumor", true, true);
  post("p1", "private", "My own note");
  post("p2", "party", "Everyone sees this");

  const gmView = selectComments(state.social, "Actor.wolf", { id: "gm", isGM: true });
  const p1View = selectComments(state.social, "Actor.wolf", { id: "p1", isGM: false });
  const p2View = selectComments(state.social, "Actor.wolf", { id: "p2", isGM: false });

  assert.deepEqual(gmView.map(c => c.text).sort(), ["Everyone sees this", "Public rumor", "Secret weakness"]);
  assert.deepEqual(p1View.map(c => c.text).sort(), ["Everyone sees this", "My own note", "Public rumor"]);
  assert.deepEqual(p2View.map(c => c.text).sort(), ["Everyone sees this", "Public rumor"]);
});

test("a player cannot post into the GM channel", () => {
  const state = stateWith([sectionFixture()]);
  const result = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.ADD_COMMENT,
    uuid: "Actor.wolf", userId: "p1", channel: "gm", text: "sneaky", isGM: false
  }, deps);
  assert.equal(result.changedAny, false);
});

test("only the author or a GM may edit a comment", () => {
  let state = stateWith([sectionFixture()]);
  state = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.ADD_COMMENT,
    uuid: "Actor.wolf", userId: "p1", channel: "party", text: "mine"
  }, deps).state;
  const commentId = state.social.comments[0].id;

  const stranger = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.UPDATE_COMMENT,
    commentId, userId: "p2", isGM: false, patch: { text: "hijacked" }
  }, deps);
  assert.equal(stranger.changedAny, false);

  const author = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.UPDATE_COMMENT,
    commentId, userId: "p1", isGM: false, patch: { text: "edited" }
  }, deps);
  assert.equal(author.state.social.comments[0].text, "edited");
});

test("private comments stay private even from the GM", () => {
  let state = stateWith([sectionFixture()]);
  state = applyBestiaryCommand(state, {
    type: BESTIARY_COMMANDS.ADD_COMMENT,
    uuid: "Actor.wolf", userId: "p1", channel: "private", text: "hidden"
  }, deps).state;
  const gmView = selectComments(state.social, "Actor.wolf", { id: "gm", isGM: true });
  assert.deepEqual(gmView, []);
});

test("hidden entries stay out of a player's reach", () => {
  const state = stateWith([sectionFixture({ creatures: [{ uuid: "Actor.wolf", hidden: true }] })]);
  assert.equal(canViewCreature(state.data, "Actor.wolf", { isGM: false }), false);
  assert.equal(canViewCreature(state.data, "Actor.wolf", { isGM: true }), true);
});

test("merging an import keeps existing entries and adds the missing ones", () => {
  const state = stateWith([sectionFixture()]);
  const result = run(state, {
    type: BESTIARY_COMMANDS.IMPORT_SNAPSHOT,
    mode: "merge",
    payload: {
      sections: [{
        id: "sec1",
        name: "Forest",
        families: [{ id: "fam2", name: "Bears" }],
        creatures: [{ uuid: "Actor.wolf" }, { uuid: "Actor.bear", familyId: "fam2" }]
      }]
    }
  });
  const section = result.state.data.sections[0];
  assert.equal(section.creatures.length, 2);
  assert.equal(section.families.length, 2);
  assert.equal(section.creatures.find(entry => entry.uuid === "Actor.bear").familyId, "fam2");
});

test("replacing an import wipes the previous structure", () => {
  const state = stateWith([sectionFixture()]);
  const result = run(state, {
    type: BESTIARY_COMMANDS.IMPORT_SNAPSHOT,
    mode: "replace",
    payload: { sections: [{ id: "other", name: "Swamp", creatures: [] }] }
  });
  assert.equal(result.state.data.sections.length, 1);
  assert.equal(result.state.data.sections[0].name, "Swamp");
});

test("each store bumps its own revision only", () => {
  const state = stateWith([sectionFixture()]);
  const result = run(state, {
    type: BESTIARY_COMMANDS.ADD_COMMENT,
    uuid: "Actor.wolf", userId: "p1", channel: "party", text: "note"
  });
  assert.equal(result.changed.social, true);
  assert.equal(result.changed.data, false);
  assert.equal(result.state.data.revision, state.data.revision);
  assert.equal(result.state.social.revision, state.social.revision + 1);
});

test("an unknown command is rejected loudly", () => {
  assert.throws(() => applyBestiaryCommand(stateWith(), { type: "nope" }, deps), /Unknown bestiary command/);
});
