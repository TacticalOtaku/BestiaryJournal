/**
 * Server-side half of a research roll, run only by the authoritative GM.
 *
 * A player never reports "I succeeded". They roll through the system, which
 * posts a chat message owned by the server, and send its id. The authority
 * checks that message — author, actor ownership, skill, freshness, single use
 * — then computes the DC and the outcome itself from world data.
 */

import {
  BESTIARY_COMMANDS,
  getUserTier,
  normalizeBestiaryData,
  normalizeKnowledge,
  selectEntryContext
} from "../core/bestiary-domain.js";
import { MAX_RESEARCH_TIER, isBlockVisible, resolveResearchConfig } from "../core/research-model.js";
import { getEntryBlockTiers } from "./creature-display.js";
import { localize } from "./foundry-runtime.js";

const MODULE_ID = "bestiary-journal";
const MESSAGE_MAX_AGE_MS = 10 * 60_000;
const MESSAGE_WAIT_MS = 3_000;

class ResearchRejection extends Error {
  constructor(key, data = {}) {
    super(key);
    this.key = key;
    this.data = data;
  }
}

export async function prepareResearchCommand(command, requester) {
  if (game.settings.get(MODULE_ID, "researchRollEnabled") === false) {
    throw new ResearchRejection("BESTIARY.Errors.ResearchDisabled");
  }
  const uuid = String(command.uuid ?? "");
  const data = normalizeBestiaryData(game.settings.get(MODULE_ID, "bestiaryData"));
  const context = selectEntryContext(data, uuid, { id: requester.id, isGM: false }, command.sectionId ?? null);
  if (!context) throw new ResearchRejection("BESTIARY.CreatureUnavailable");

  const knowledge = normalizeKnowledge(game.settings.get(MODULE_ID, "bestiaryKnowledge"));
  if (getUserTier(knowledge, requester.id, uuid) >= MAX_RESEARCH_TIER) {
    throw new ResearchRejection("BESTIARY.Research.Complete");
  }

  const message = await waitForMessage(String(command.messageId ?? ""));
  const research = message?.getFlag(MODULE_ID, "research");
  const rollFlags = message?.getFlag("dnd5e", "roll");
  const roll = message?.rolls?.[0];
  const authorId = message?.author?.id ?? message?.user?.id ?? message?.author;
  const actor = game.actors?.get(message?.speaker?.actor ?? "");

  const valid = message
    && authorId === requester.id
    && research?.uuid === uuid
    && !research.consumed
    && rollFlags?.type === "skill"
    && Date.now() - Number(message.timestamp ?? 0) < MESSAGE_MAX_AGE_MS
    && actor?.testUserPermission?.(requester, "OWNER")
    && Number.isFinite(Number(roll?.total));
  if (!valid) throw new ResearchRejection("BESTIARY.Errors.ResearchUnverified");

  const creature = await readCreatureTraits(uuid);
  const config = resolveResearchConfig(context.entry, creature);
  const skill = String(rollFlags.skillId ?? "");
  if (!config.skills.includes(skill)) throw new ResearchRejection("BESTIARY.Errors.ResearchSkill");

  const total = Math.trunc(Number(roll.total));
  const success = total >= config.dc;
  // Marked first: even if anything below fails, this roll is spent.
  await message.setFlag(MODULE_ID, "research", { ...research, consumed: true });

  return {
    command: {
      type: BESTIARY_COMMANDS.RECORD_RESEARCH,
      uuid,
      userId: requester.id,
      isGM: false,
      total,
      dc: config.dc,
      success,
      skill,
      singleAttempt: game.settings.get(MODULE_ID, "researchSingleAttempt") === true
    },
    finalize: async result => {
      if (!result?.changed) throw new ResearchRejection("BESTIARY.Errors.ResearchNotRecorded");
      await postOutcome({ message, actor, requester, uuid, entry: context.entry, creature, skill, total, dc: config.dc, success });
    }
  };
}

/** The roll message is created before the request is sent; allow for lag. */
async function waitForMessage(messageId) {
  if (!messageId) return null;
  const deadline = Date.now() + MESSAGE_WAIT_MS;
  let message = game.messages?.get(messageId);
  while (!message && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 150));
    message = game.messages?.get(messageId);
  }
  return message ?? null;
}

async function readCreatureTraits(uuid) {
  try {
    const actor = await fromUuid(uuid);
    return {
      name: actor?.name ?? "",
      cr: actor?.system?.details?.cr ?? 0,
      creatureTypeKey: actor?.system?.details?.type?.value ?? ""
    };
  } catch {
    return { name: "", cr: 0, creatureTypeKey: "" };
  }
}

/**
 * The outcome follows the roll's own privacy: a whispered roll gets a
 * whispered result, a blind roll is reported to the GMs only. The creature is
 * named only when the roller now knows its name.
 */
async function postOutcome({ message, actor, requester, uuid, entry, creature, skill, total, dc, success }) {
  const knowledge = normalizeKnowledge(game.settings.get(MODULE_ID, "bestiaryKnowledge"));
  const tier = getUserTier(knowledge, requester.id, uuid);
  const knowsName = isBlockVisible("name", tier, getEntryBlockTiers(entry)) && !!creature.name;

  const card = document.createElement("div");
  card.className = `bestiary-research-card ${success ? "is-success" : "is-failure"}`;
  const title = document.createElement("strong");
  title.textContent = localize("BESTIARY.Research.ChatTitle");
  const body = document.createElement("p");
  body.textContent = game.i18n.format("BESTIARY.Research.ChatBody", {
    actor: actor.name,
    creature: knowsName ? creature.name : localize("BESTIARY.Tier.UnknownName"),
    skill: CONFIG.DND5E?.skills?.[skill]?.label ?? skill,
    total,
    dc
  });
  const outcome = document.createElement("p");
  outcome.className = "bestiary-research-outcome";
  outcome.textContent = localize(success ? "BESTIARY.Research.ChatSuccess" : "BESTIARY.Research.ChatFailure");
  card.append(title, body, outcome);

  const gmIds = game.users.filter(user => user.isGM).map(user => user.id);
  let whisper = [];
  if (message.blind) whisper = gmIds;
  else if (message.whisper?.length) whisper = [...new Set([...message.whisper, requester.id, ...gmIds])];

  await ChatMessage.create({
    speaker: message.speaker,
    content: card.outerHTML,
    whisper,
    flags: { [MODULE_ID]: { researchOutcome: true } }
  });
}
