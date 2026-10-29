import test from "node:test";
import assert from "node:assert/strict";

import { effectiveMotion, normalizeAccent, resolveTheme } from "../scripts/core/theme.js";

test("«Авто» follows Foundry's scheme, anything unknown is night", () => {
  assert.equal(resolveTheme("auto", true), "parchment");
  assert.equal(resolveTheme("auto", false), "night");
  assert.equal(resolveTheme("parchment", false), "parchment");
  assert.equal(resolveTheme("bogus", true), "night");
  assert.equal(normalizeAccent("rose"), "rose");
  assert.equal(normalizeAccent("teal"), "brass");
});

test("the system and Foundry cap motion, the user's choice holds under the cap", () => {
  assert.equal(effectiveMotion("full"), "full");
  assert.equal(effectiveMotion("full", { reducedMotion: true }), "off");
  assert.equal(effectiveMotion("full", { performanceLow: true }), "reduced");
  assert.equal(effectiveMotion("off", { performanceLow: true }), "off");
  assert.equal(effectiveMotion("bogus"), "full");
});
