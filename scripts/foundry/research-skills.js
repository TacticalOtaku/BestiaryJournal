import { RESEARCH_SKILLS, resolveAvailableResearchSkills } from "../core/research-model.js";
import { getDnd5eSkillIds, skillLabel } from "../integrations/dnd5e.js";

const MODULE_ID = "bestiary-journal";

/** Whether non-standard skills registered in dnd5e may be used for research checks. */
export function includeCustomSkillsEnabled() {
  return game.settings.get(MODULE_ID, "includeCustomSkills") === true;
}

/**
 * Active research skill IDs for this world: the built-in research skills, plus
 * sorted custom skills from `CONFIG.DND5E.skills` when enabled by the GM.
 */
export function allowedResearchSkills() {
  if (!includeCustomSkillsEnabled()) return [...RESEARCH_SKILLS];
  const base = new Set(RESEARCH_SKILLS);
  const custom = resolveAvailableResearchSkills(getDnd5eSkillIds())
    .filter((skill) => !base.has(skill))
    .sort((left, right) => skillLabel(left).localeCompare(skillLabel(right), game.i18n?.lang || undefined));
  return [...RESEARCH_SKILLS, ...custom];
}

export function researchSkillOptions(selected = []) {
  return allowedResearchSkills().map((skill) => ({
    value: skill,
    label: skillLabel(skill),
    selected: selected.includes(skill),
  }));
}
