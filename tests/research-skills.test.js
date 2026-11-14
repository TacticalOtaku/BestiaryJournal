import test from "node:test";
import assert from "node:assert/strict";

import { RESEARCH_SKILLS } from "../scripts/core/research-model.js";
import { allowedResearchSkills, researchSkillOptions } from "../scripts/foundry/research-skills.js";

function setupSkills({ includeCustomSkills = false, skills = {} } = {}) {
  globalThis.game = {
    settings: { get: (scope, key) => (key === "includeCustomSkills" ? includeCustomSkills : undefined) },
    i18n: { lang: "ru", localize: (key) => key, has: () => false },
  };
  globalThis.CONFIG = { DND5E: { skills } };
}

test("custom skills stay excluded when includeCustomSkills is disabled", () => {
  setupSkills({
    includeCustomSkills: false,
    skills: {
      nat: { label: "Nature" },
      ste: { label: "Stealth" },
      mec: { label: "Механика" },
      sci: { label: "Наука" },
    },
  });
  assert.deepEqual(allowedResearchSkills(), [...RESEARCH_SKILLS]);
  assert.equal(
    researchSkillOptions().some((option) => option.value === "mec" || option.value === "sci"),
    false,
  );
});

test("when includeCustomSkills is enabled, non-standard skills are added and sorted by label", () => {
  setupSkills({
    includeCustomSkills: true,
    skills: {
      nat: { label: "Nature" },
      ste: { label: "Stealth" },
      sci: { label: "Наука" },
      mec: { label: "Механика" },
    },
  });
  assert.deepEqual(allowedResearchSkills(), [...RESEARCH_SKILLS, "mec", "sci"]);
  const options = researchSkillOptions(["sci"]);
  assert.deepEqual(options.slice(-2), [
    { value: "mec", label: "Механика", selected: false },
    { value: "sci", label: "Наука", selected: true },
  ]);
});
