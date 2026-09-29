import {
  MAX_RESEARCH_TIER,
  RESEARCH_SKILLS,
  getTierDefinition,
  resolveResearchConfig
} from "../core/research-model.js";
import { BESTIARY_COMMANDS } from "../core/bestiary-domain.js";
import { BestiaryCommandError, dispatchBestiaryCommand, hasActiveAuthority } from "./bestiary-store.js";
import { getDnd5eConfig, localize } from "./foundry-runtime.js";

const MODULE_ID = "bestiary-journal";

export { resolveResearchConfig };

export function skillLabel(skill) {
  const config = getDnd5eConfig().skills?.[skill];
  const moduleKey = `BESTIARY.Data.Skills.${skill}`;
  if (game.i18n.has?.(moduleKey)) return localize(moduleKey);
  return config?.label ?? skill;
}

export function researchSkillOptions(selected = []) {
  return RESEARCH_SKILLS.map(skill => ({
    value: skill,
    label: skillLabel(skill),
    selected: selected.includes(skill)
  }));
}

export function isSingleAttemptWorld() {
  return game.settings.get(MODULE_ID, "researchSingleAttempt") === true;
}

export function isResearchRollEnabled() {
  return game.settings.get(MODULE_ID, "researchRollEnabled") !== false;
}

/** Characters the current user may roll with. */
export function researchActors() {
  const owned = game.actors?.filter?.(actor =>
    actor.type === "character" && actor.testUserPermission(game.user, "OWNER")) ?? [];
  const assigned = game.user?.character;
  if (assigned && !owned.some(actor => actor.id === assigned.id)) owned.unshift(assigned);
  return owned;
}

/**
 * Rolls the identification check through the system and hands the resulting
 * chat message to the authoritative GM, who verifies it and decides the
 * outcome. The client never claims success on its own.
 *
 * @returns {Promise<boolean>} whether a roll was submitted
 */
export async function runResearchCheck({ uuid, sectionId, actor, skill, event }) {
  if (!actor) {
    ui.notifications.warn(localize("BESTIARY.Research.NoActor"));
    return false;
  }
  // Without a GM to verify it the roll would be wasted, so do not ask for one.
  if (!hasActiveAuthority()) throw new BestiaryCommandError("BESTIARY.NoActiveGm");

  const rolls = await actor.rollSkill({ skill, event }, {}, {
    data: { flags: { [MODULE_ID]: { research: { uuid, sectionId: sectionId ?? null } } } }
  });
  const message = rolls?.[0]?.parent;
  if (!rolls?.length) return false; // The player closed the roll dialog.
  if (!message?.id) {
    ui.notifications.warn(localize("BESTIARY.Research.RollFailed"));
    return false;
  }

  await dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.RECORD_RESEARCH,
    uuid,
    sectionId: sectionId ?? null,
    messageId: message.id
  });
  return true;
}

export function describeTier(tier) {
  const definition = getTierDefinition(tier);
  return { ...definition, label: localize(definition.label), hint: localize(definition.hint) };
}

export function nextTierLabel(tier) {
  return describeTier(Math.min(Number(tier) + 1, MAX_RESEARCH_TIER)).label;
}
