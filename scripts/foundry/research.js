import {
  MAX_RESEARCH_TIER,
  RESEARCH_SKILLS,
  getTierDefinition
} from "../core/research-model.js";
import { BESTIARY_COMMANDS } from "../core/bestiary-domain.js";
import { BestiaryCommandError, dispatchBestiaryCommand, hasActiveAuthority } from "./bestiary-store.js";
import { localize } from "./foundry-runtime.js";
import { skillLabel } from "../integrations/dnd5e.js";

const MODULE_ID = "bestiary-journal";

export { skillLabel };

export function researchSkillOptions(selected = []) {
  return RESEARCH_SKILLS.map(skill => ({
    value: skill,
    label: skillLabel(skill),
    selected: selected.includes(skill)
  }));
}

export function isResearchRollEnabled() {
  return game.settings.get(MODULE_ID, "researchRollEnabled") !== false;
}

/** Characters `user` may roll with. */
export function researchActors(user = game.user) {
  const owned = game.actors?.filter?.(actor =>
    actor.type === "character" && actor.testUserPermission(user, "OWNER")) ?? [];
  const assigned = user?.character;
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
export async function runResearchCheck({ uuid, actor, skill, event }) {
  if (!actor) {
    ui.notifications.warn(localize("BESTIARY.Research.NoActor"));
    return false;
  }
  // Without a GM to verify it the roll would be wasted, so do not ask for one.
  if (!hasActiveAuthority()) throw new BestiaryCommandError("BESTIARY.NoActiveGm");

  const rolls = await actor.rollSkill({ skill, event }, {}, {
    data: { flags: { [MODULE_ID]: { research: { uuid } } } }
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
