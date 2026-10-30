import { BESTIARY_COMMANDS, BestiaryCommandError, getUserTier } from "./bestiary-domain.js";
import { playerEntryContexts } from "./knowledge-lens.js";
import { MAX_RESEARCH_TIER, resolveCreatureResearch } from "./research-model.js";

export const RESEARCH_ROLL_MAX_AGE_MS = 10 * 60_000;

/**
 * The GM's verdict on a research roll. A player never reports "I succeeded": they roll through the system and
 * name the chat message; the authority reads it into `roll` (integrations/dnd5e.js, plus the module's own flag:
 * `creatureUuid`, `consumed`, and whether the requester owns the character) and this decides. Returns the command
 * to record, or throws a BestiaryCommandError the player sees.
 */
export function judgeResearchRoll({ requester, uuid, roll, data, knowledge, creature, settings, now }) {
  if (!settings.enabled) throw new BestiaryCommandError("BESTIARY.Errors.ResearchDisabled");
  const entries = playerEntryContexts(data, uuid).map(context => context.entry);
  if (!entries.length) throw new BestiaryCommandError("BESTIARY.CreatureUnavailable");
  if (getUserTier(knowledge, requester.id, uuid) >= MAX_RESEARCH_TIER) {
    throw new BestiaryCommandError("BESTIARY.Research.Complete");
  }

  const verified = !!roll
    && roll.authorId === requester.id
    && roll.creatureUuid === uuid
    && !roll.consumed
    && roll.isSkillCheck
    && now - roll.at < RESEARCH_ROLL_MAX_AGE_MS
    && roll.ownedByRequester
    && Number.isFinite(roll.total);
  if (!verified) throw new BestiaryCommandError("BESTIARY.Errors.ResearchUnverified");

  const config = resolveCreatureResearch(entries, creature);
  if (!config.skills.includes(roll.skill)) throw new BestiaryCommandError("BESTIARY.Errors.ResearchSkill");

  const total = Math.trunc(roll.total);
  return {
    config,
    command: {
      type: BESTIARY_COMMANDS.RECORD_RESEARCH,
      uuid,
      userId: requester.id,
      isGM: false,
      total,
      dc: config.dc,
      success: total >= config.dc,
      skill: roll.skill,
      singleAttempt: !!settings.singleAttempt
    }
  };
}
