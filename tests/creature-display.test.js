import test from "node:test";
import assert from "node:assert/strict";

import { localizedTierChoices } from "../scripts/foundry/creature-display.js";

globalThis.game = { i18n: { localize: key => key } };

const chosen = (value, options) => localizedTierChoices(value, options).filter(choice => choice.selected).map(choice => choice.value);

test("an item without its own tier shows «as its block», never «Unknown» as well", () => {
  assert.deepEqual(chosen("", { includeInherit: true }), [""]);
  assert.deepEqual(chosen(undefined, { includeInherit: true }), [""]);
  assert.deepEqual(chosen(0, { includeInherit: true }), [0]);
  assert.deepEqual(chosen(4, { includeInherit: true }), [4]);
  assert.deepEqual(chosen(null), [], "no tier chosen at all");
});
