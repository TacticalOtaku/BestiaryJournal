import test from "node:test";
import assert from "node:assert/strict";
import { applyBestiaryCommand, createBestiaryState, PLAYER_COMMANDS } from "../scripts/bestiary-domain.mjs";

function fixture() {
  return createBestiaryState({ data: { sections: [
    { id: "a", families: [{ id: "f" }], creatures: [
      { uuid: "Actor.one", familyId: "f", research: { dc: 12, skills: ["nat"] } },
      { uuid: "Actor.two", research: { dc: 16, skills: ["arc"] } },
      { uuid: "Actor.locked", familyId: "f", locked: true }
    ] },
    { id: "b", locked: true, creatures: [{ uuid: "Actor.three" }] },
    { id: "c", creatures: [{ uuid: "Actor.four" }] }
  ] } });
}
const run = (state, options) => applyBestiaryCommand(state, {
  type: "bulkUpdateResearch", isGM: true, ...options
});

test("bulk research updates only the chosen family and preserves unrelated settings", () => {
  const state = fixture();
  const result = run(state, { scope: "family", sectionId: "a", familyId: "f", patch: { dc: 18 } });
  const entries = result.state.data.sections[0].creatures;
  assert.deepEqual(entries[0].research, { dc: 18, skills: ["nat"] });
  assert.equal(entries[1].research.dc, 16);
  assert.equal(entries[2].research.dc, null);
  assert.equal(state.data.sections[0].creatures[0].research.dc, 12);
  assert.equal(result.state.data.revision, 1);
  assert.equal(result.changed.knowledge, false);
});

test("bulk automatic settings reset both overrides but respect entry and collection locks", () => {
  const state = fixture();
  const result = run(state, { scope: "all", patch: { dc: null, skills: [] } });
  assert.deepEqual(result.state.data.sections[0].creatures[0].research, { dc: null, skills: [] });
  assert.deepEqual(result.state.data.sections[1], state.data.sections[1]);
  assert.deepEqual(result.state.data.sections[0].creatures[2], state.data.sections[0].creatures[2]);
});

test("bulk skills leave DC unchanged and do not touch other collections", () => {
  const result = run(fixture(), { scope: "section", sectionId: "a", patch: { skills: ["arc", "rel"] } });
  assert.deepEqual(result.state.data.sections[0].creatures[0].research, { dc: 12, skills: ["arc", "rel"] });
  assert.deepEqual(result.state.data.sections[2].creatures[0].research, { dc: null, skills: [] });
});

test("bulk research rejects invalid scope, DC and skills without a partial update", () => {
  for (const options of [
    { scope: "unknown", patch: { dc: 12 } },
    { scope: "family", sectionId: "a", patch: { dc: 12 } },
    { scope: "all", patch: { dc: -1 } },
    { scope: "all", patch: { dc: 12.5 } },
    { scope: "all", patch: { dc: 12, skills: ["invalid"] } }
  ]) assert.throws(() => run(fixture(), options));
});

test("bulk research is GM-only and an empty patch does not bump revisions", () => {
  assert.equal(PLAYER_COMMANDS.has("bulkUpdateResearch"), false);
  assert.throws(() => run(fixture(), { isGM: false, scope: "all", patch: { dc: 10 } }));
  assert.equal(run(fixture(), { scope: "all", patch: {} }).changedAny, false);
});
