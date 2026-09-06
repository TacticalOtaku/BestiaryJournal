import {
  MAX_RESEARCH_TIER,
  RESEARCH_SKILLS,
  getTierDefinition,
  suggestResearchDc,
  suggestResearchSkill
} from "./research-model.mjs";
import { BESTIARY_COMMANDS } from "./bestiary-domain.mjs";
import { dispatchBestiaryCommand } from "./bestiary-store.mjs";
import { getDnd5eConfig, localize, usesLegacyDnd5eRollApi } from "./foundry-runtime.mjs";

const MODULE_ID = "bestiary-journal";

/** Falls back to a CR-scaled DC and a type-appropriate skill when unset. */
export function resolveResearchConfig(entry, creature) {
  const configured = entry?.research ?? {};
  const skills = configured.skills?.length
    ? configured.skills
    : [suggestResearchSkill(creature?.creatureTypeKey)];
  return {
    dc: Number.isFinite(Number(configured.dc)) && configured.dc !== null
      ? Number(configured.dc)
      : suggestResearchDc(creature?.cr),
    skills: skills.filter(skill => RESEARCH_SKILLS.includes(skill)),
    isDcExplicit: configured.dc !== null && configured.dc !== undefined
  };
}

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
 * Rolls the identification check and hands the outcome to the authoritative
 * GM. The roll itself is posted to chat so the table can see it.
 */
export async function runResearchCheck({ uuid, entry, creature, actor, skill, event }) {
  const config = resolveResearchConfig(entry, creature);
  const chosenSkill = skill ?? config.skills[0] ?? "nat";
  if (!actor) {
    ui.notifications.warn(localize("BESTIARY.Research.NoActor"));
    return null;
  }

  const roll = await rollSkill(actor, chosenSkill, event);
  if (roll === undefined) return null; // The player closed the roll dialog.
  if (!roll) {
    ui.notifications.warn(localize("BESTIARY.Research.RollFailed"));
    return null;
  }

  const total = Number(roll.total ?? 0);
  const success = total >= config.dc;
  try {
    await dispatchBestiaryCommand({
      type: BESTIARY_COMMANDS.RECORD_RESEARCH,
      uuid,
      total,
      dc: config.dc,
      success,
      skill: chosenSkill,
      singleAttempt: isSingleAttemptWorld()
    });
  } catch (error) {
    // The roll still happened, so report it rather than swallowing the result.
    console.warn("Bestiary | The research result could not be recorded", error);
    ui.notifications.error(error.message);
  }

  await postResearchMessage({ actor, creature, skill: chosenSkill, total, dc: config.dc, success });
  return { success, total, dc: config.dc, skill: chosenSkill };
}

/**
 * @returns a roll, `undefined` when the player cancelled the dialog, or `null`
 *          when no roll could be made at all.
 */
async function rollSkill(actor, skill, event) {
  if (typeof actor.rollSkill === "function") {
    try {
      // dnd5e 3.x and older take the skill id positionally; 4.0+ takes a config
      // object, and wrappers like midi-qol write onto that first argument.
      const result = usesLegacyDnd5eRollApi()
        ? await actor.rollSkill(skill, { event })
        : await actor.rollSkill({ skill, event });
      const roll = Array.isArray(result) ? result[0] : result;
      return roll?.total === undefined ? undefined : roll;
    } catch (error) {
      console.warn("Bestiary | Skill roll failed, falling back to a plain d20", error);
    }
  }
  try {
    const modifier = Number(actor.system?.skills?.[skill]?.total ?? 0);
    return await new Roll(`1d20 + ${modifier}`).evaluate();
  } catch (error) {
    console.error("Bestiary | Could not evaluate the research roll", error);
    return null;
  }
}

async function postResearchMessage({ actor, creature, skill, total, dc, success }) {
  const card = document.createElement("div");
  card.className = `bestiary-research-card ${success ? "is-success" : "is-failure"}`;

  const title = document.createElement("strong");
  title.textContent = localize("BESTIARY.Research.ChatTitle");

  const body = document.createElement("p");
  body.textContent = game.i18n.format("BESTIARY.Research.ChatBody", {
    actor: actor.name,
    creature: creature?.name ?? localize("BESTIARY.Creature"),
    skill: skillLabel(skill),
    total,
    dc
  });

  const outcome = document.createElement("p");
  outcome.className = "bestiary-research-outcome";
  outcome.textContent = localize(success
    ? "BESTIARY.Research.ChatSuccess"
    : "BESTIARY.Research.ChatFailure");

  card.append(title, body, outcome);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: card.outerHTML,
    flags: { [MODULE_ID]: { research: true, creatureUuid: creature?.uuid } }
  });
}

export function describeTier(tier) {
  const definition = getTierDefinition(tier);
  return { ...definition, label: localize(definition.label), hint: localize(definition.hint) };
}

export function nextTierLabel(tier) {
  return describeTier(Math.min(Number(tier) + 1, MAX_RESEARCH_TIER)).label;
}
