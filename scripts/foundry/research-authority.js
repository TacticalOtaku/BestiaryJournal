/**
 * Server-side half of a research roll, run only by the authoritative GM.
 *
 * A player never reports "I succeeded". They roll through the system, which
 * posts a chat message owned by the server, and send its id. The authority
 * checks that message — author, actor ownership, skill, freshness, single use
 * — then computes the DC and the outcome itself from world data.
 */

import { BestiaryCommandError, normalizeBestiaryData, normalizeKnowledge } from "../core/bestiary-domain.js";
import { judgeResearchRoll } from "../core/research-judge.js";
import { readCreatureTraits, readResearchRoll, skillLabel } from "../integrations/dnd5e.js";
import { knowledgeLensFor } from "./creature-display.js";
import { localize } from "./foundry-runtime.js";

const MODULE_ID = "bestiary-journal";
const MESSAGE_WAIT_MS = 3_000;

/**
 * Reads the roll and the world for the judge (core/research-judge.js), spends the roll before the result is
 * recorded, and posts the outcome once it is.
 */
export async function prepareResearchCommand(command, requester) {
  const uuid = String(command.uuid ?? "");
  const message = await waitForMessage(String(command.messageId ?? ""));
  const research = message?.getFlag(MODULE_ID, "research");
  const read = readResearchRoll(message);
  const actor = game.actors?.get(read?.actorId ?? "");
  const data = normalizeBestiaryData(game.settings.get(MODULE_ID, "bestiaryData"));
  const creature = await readCreatureDocument(uuid);

  const { command: recorded, config } = judgeResearchRoll({
    requester,
    uuid,
    roll: read && {
      ...read,
      creatureUuid: research?.uuid,
      consumed: !!research?.consumed,
      ownedByRequester: !!actor?.testUserPermission?.(requester, "OWNER")
    },
    data,
    knowledge: normalizeKnowledge(game.settings.get(MODULE_ID, "bestiaryKnowledge")),
    creature,
    settings: {
      enabled: game.settings.get(MODULE_ID, "researchRollEnabled") !== false,
      singleAttempt: game.settings.get(MODULE_ID, "researchSingleAttempt") === true
    },
    now: Date.now()
  });

  // Marked first: even if anything below fails, this roll is spent.
  await message.setFlag(MODULE_ID, "research", { ...research, consumed: true });

  return {
    command: recorded,
    finalize: async result => {
      if (!result?.changed) throw new BestiaryCommandError("BESTIARY.Errors.ResearchNotRecorded");
      await postOutcome({ message, actor, requester, uuid, data, creature, skill: recorded.skill, total: recorded.total, config, success: recorded.success });
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

async function readCreatureDocument(uuid) {
  try {
    return readCreatureTraits(await fromUuid(uuid));
  } catch {
    return readCreatureTraits(null);
  }
}

/**
 * The outcome follows the roll's own privacy: a whispered roll gets a
 * whispered result, a blind roll is reported to the GMs only. The creature is
 * named only when the roller now knows its name.
 */
async function postOutcome({ message, actor, requester, uuid, data, creature, skill, total, config, success }) {
  // Read after the roll was recorded, so the outcome names what the roller knows now.
  const knowledge = normalizeKnowledge(game.settings.get(MODULE_ID, "bestiaryKnowledge"));
  const lens = knowledgeLensFor({ data, knowledge }, { id: requester.id, isGM: false }, uuid);
  const knowsName = lens.knowsName && !!creature.name;
  const showsDc = lens.knowsDc(config);
  const { dc } = config;

  const card = document.createElement("div");
  card.className = `bestiary-research-card ${success ? "is-success" : "is-failure"}`;
  const title = document.createElement("strong");
  title.textContent = localize("BESTIARY.Research.ChatTitle");
  const body = document.createElement("p");
  body.textContent = game.i18n.format(showsDc ? "BESTIARY.Research.ChatBody" : "BESTIARY.Research.ChatBodyNoDc", {
    actor: actor.name,
    creature: knowsName ? creature.name : localize("BESTIARY.Tier.UnknownName"),
    skill: skillLabel(skill),
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
