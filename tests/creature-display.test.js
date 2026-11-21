import test from "node:test";
import assert from "node:assert/strict";

import { NEVER_TIER } from "../scripts/core/research-model.js";
import { localizedTierChoices } from "../scripts/foundry/creature-display.js";

globalThis.game = { i18n: { localize: (key) => key } };

const chosen = (value, options) =>
  localizedTierChoices(value, options)
    .filter((choice) => choice.selected)
    .map((choice) => choice.value);

test("an item without its own tier shows «as its block», never «Unknown» as well", () => {
  assert.deepEqual(chosen("", { includeInherit: true }), [""]);
  assert.deepEqual(chosen(undefined, { includeInherit: true }), [""]);
  assert.deepEqual(chosen(0, { includeInherit: true }), [0]);
  assert.deepEqual(chosen(NEVER_TIER, { includeInherit: true }), [NEVER_TIER]);
  assert.deepEqual(chosen(null), [], "no tier chosen at all");
});

test("localizedTierChoices supports custom tier lists including custom labels and colors", () => {
  const custom = [
    {
      value: 0,
      id: "unknown",
      key: "unknown",
      label: "BESTIARY.Tier.Unknown",
      hint: "",
      icon: "fa-circle-question",
      color: "unknown",
    },
    {
      value: 1,
      id: "sightings",
      key: "frost",
      label: "Sightings",
      hint: "Footprints",
      icon: "fa-eye",
      color: "frost",
    },
    {
      value: 2,
      id: "mastered",
      key: "mastered",
      label: "BESTIARY.Tier.Mastered",
      hint: "",
      icon: "fa-crown",
      color: "mastered",
    },
  ];
  const list = localizedTierChoices(1, { tiers: custom });
  assert.deepEqual(
    list.map((c) => [c.value, c.label, c.color, c.selected]),
    [
      [0, "BESTIARY.Tier.Unknown", "unknown", false],
      [1, "Sightings", "frost", true],
      [2, "BESTIARY.Tier.Mastered", "mastered", false],
      [NEVER_TIER, "BESTIARY.Tier.Never", "never", false],
    ],
  );
});
