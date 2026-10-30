import test from "node:test";
import assert from "node:assert/strict";

import { judgeResearchRoll, RESEARCH_ROLL_MAX_AGE_MS } from "../scripts/core/research-judge.js";
import { BESTIARY_COMMANDS } from "../scripts/core/bestiary-domain.js";

const UUID = "Actor.goblin";
const NOW = 1_000_000;
const section = (id, research, extra = {}) => ({
  id, name: id, families: [], creatures: [{ uuid: UUID, research }], ...extra
});
const goodRoll = { authorId: "p1", creatureUuid: UUID, consumed: false, isSkillCheck: true, skill: "his", total: 14, at: NOW - 1000, ownedByRequester: true };

function judge(overrides = {}) {
  return judgeResearchRoll({
    requester: { id: "p1" },
    uuid: UUID,
    roll: goodRoll,
    data: { sections: [section("caves", { dc: 15, skills: [] })] },
    knowledge: { users: {} },
    creature: { cr: 0.25, creatureTypeKey: "humanoid" },
    settings: { enabled: true, singleAttempt: false },
    now: NOW,
    ...overrides
  });
}
const refuses = (overrides, key) => assert.throws(() => judge(overrides), { key });

test("a roll that meets the DC records a success, one that misses a failure", () => {
  const { command } = judge({ roll: { ...goodRoll, total: 15 } });
  assert.deepEqual(command, {
    type: BESTIARY_COMMANDS.RECORD_RESEARCH, uuid: UUID, userId: "p1", isGM: false,
    total: 15, dc: 15, success: true, skill: "his", singleAttempt: false
  });
  assert.equal(judge({ roll: { ...goodRoll, total: 14.9 } }).command.success, false);
  assert.equal(judge({ settings: { enabled: true, singleAttempt: true } }).command.singleAttempt, true);
});

test("the roll is judged by the easiest collection the player can see, wherever it was made", () => {
  const data = { sections: [
    section("caves", { dc: 15, skills: [] }),
    section("forest", { dc: 12, skills: [] }),
    section("secret", { dc: 5, skills: ["arc"] }, { hidden: true })
  ] };
  const { command, config } = judge({ data, roll: { ...goodRoll, total: 12 } });
  assert.equal(command.dc, 12);
  assert.equal(command.success, true);
  assert.deepEqual(config.skills, ["his"], "the hidden collection's skill does not count");
});

test("each refusal names its reason, in the order the GM checks them", () => {
  refuses({ settings: { enabled: false } }, "BESTIARY.Errors.ResearchDisabled");
  refuses({ data: { sections: [section("caves", {}, { hidden: true })] } }, "BESTIARY.CreatureUnavailable");
  refuses({ knowledge: { users: { p1: { [UUID]: { tier: 3 } } } } }, "BESTIARY.Research.Complete");
  refuses({ roll: { ...goodRoll, skill: "arc" } }, "BESTIARY.Errors.ResearchSkill");
});

test("a roll that is not the player's own fresh, unused skill check about this creature is not believed", () => {
  for (const roll of [
    null,
    { ...goodRoll, authorId: "p2" },
    { ...goodRoll, creatureUuid: "Actor.other" },
    { ...goodRoll, consumed: true },
    { ...goodRoll, isSkillCheck: false },
    { ...goodRoll, at: NOW - RESEARCH_ROLL_MAX_AGE_MS },
    { ...goodRoll, ownedByRequester: false },
    { ...goodRoll, total: Number.NaN }
  ]) refuses({ roll }, "BESTIARY.Errors.ResearchUnverified");
});
