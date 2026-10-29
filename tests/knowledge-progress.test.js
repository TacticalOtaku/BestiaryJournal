import test from "node:test";
import assert from "node:assert/strict";

import { isNewToViewer, tierIncreases, tierProgress } from "../scripts/core/knowledge-progress.js";

test("progress counts the known creatures and each tier, leaving empty tiers out", () => {
  assert.deepEqual(tierProgress([0, 0, 1, 3]), {
    total: 4,
    known: 2,
    segments: [{ key: "unknown", count: 2 }, { key: "rumors", count: 1 }, { key: "mastered", count: 1 }]
  });
  assert.deepEqual(tierProgress([]), { total: 0, known: 0, segments: [] });
});

test("only a rise in tier is news, a first record counts from unknown", () => {
  assert.deepEqual(tierIncreases({ wolf: 1, goblin: 2 }, { wolf: 2, goblin: 2, bear: 1, rat: 0 }),
    [{ uuid: "wolf", from: 1, to: 2 }, { uuid: "bear", from: 0, to: 1 }]);
  assert.deepEqual(tierIncreases({ wolf: 3 }, { wolf: 1 }), [], "a GM lowering a tier is not announced");
});

test("a creature stays new until opened, and turns new again when more is learned", () => {
  assert.equal(isNewToViewer(undefined, 0), true);
  assert.equal(isNewToViewer(1, 1), false);
  assert.equal(isNewToViewer(1, 2), true);
  assert.equal(isNewToViewer(2, 1), false);
});
