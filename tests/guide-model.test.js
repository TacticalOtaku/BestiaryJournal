import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildGmFeatures,
  buildGuideSteps,
  buildQuickTips,
  buildResearchGuideCards,
  buildShortcutCards,
  normalizeGuideTab,
  visibleGuideTabs,
} from "../scripts/core/guide-model.js";

test("guide tabs tailor GM and player roles cleanly", () => {
  assert.deepEqual(visibleGuideTabs(true), ["quickstart", "gm", "research", "shortcuts"]);
  assert.deepEqual(visibleGuideTabs(false), ["quickstart", "research", "shortcuts"]);

  assert.equal(normalizeGuideTab("gm", true), "gm");
  assert.equal(normalizeGuideTab("gm", false), "quickstart");
  assert.equal(normalizeGuideTab("unknown", false), "quickstart");
});

test("guide cards, steps, and quick tips reference valid localization keys across EN and RU", () => {
  const en = JSON.parse(readFileSync(join(process.cwd(), "lang/en.json"), "utf8"));
  const ru = JSON.parse(readFileSync(join(process.cwd(), "lang/ru.json"), "utf8"));

  const lookup = (obj, path) => path.split(".").reduce((cur, key) => cur?.[key], obj);

  const items = [
    ...buildQuickTips({ isGM: true }),
    ...buildQuickTips({ isGM: false }),
    ...buildGuideSteps({ isGM: true }),
    ...buildGuideSteps({ isGM: false }),
    ...buildGmFeatures(),
    ...buildResearchGuideCards({ isGM: true }),
    ...buildResearchGuideCards({ isGM: false }),
    ...buildShortcutCards({ keyHint: "Shift + B", isGM: true }),
    ...buildShortcutCards({ keyHint: "Shift + B", isGM: false }),
  ];

  for (const item of items) {
    for (const keyField of ["titleKey", "bodyKey", "actionLabelKey"]) {
      const key = item[keyField];
      if (!key) continue;
      assert.equal(typeof lookup(en, key), "string", `Missing EN key: ${key}`);
      assert.equal(typeof lookup(ru, key), "string", `Missing RU key: ${key}`);
    }
  }
});

test("BestiaryGuideApp template preserves accessible tabs and live tier container", () => {
  const tpl = readFileSync(join(process.cwd(), "templates/guide.hbs"), "utf8");
  assert.match(tpl, /role="tablist"/);
  assert.match(tpl, /guide-ladder-list/);
  assert.match(tpl, /guide-hints-toggle/);
});
