import {
  MAX_RESEARCH_TIER,
  MIN_RESEARCH_TIER,
  RESEARCH_TIERS,
  clampKnownTier
} from "./research-model.mjs";
import { BESTIARY_COMMANDS, getUserTier } from "./bestiary-domain.mjs";
import { dispatchBestiaryCommand } from "./bestiary-store.mjs";
import { formatTimestamp, getPlayerUsers, localize } from "./foundry-runtime.mjs";
import { describeTier } from "./research.mjs";

const SOURCE_LABELS = {
  gm: "BESTIARY.Knowledge.SourceGm",
  roll: "BESTIARY.Knowledge.SourceRoll",
  share: "BESTIARY.Knowledge.SourceShare"
};

/** One row per player for the GM assignment board. */
export function buildKnowledgeRoster(knowledge, uuid) {
  return getPlayerUsers().map(user => {
    const record = knowledge?.users?.[user.id]?.[uuid] ?? null;
    const tier = clampKnownTier(record?.tier, MIN_RESEARCH_TIER);
    const definition = describeTier(tier);
    return {
      ...user,
      tier,
      tierLabel: definition.label,
      tierKey: definition.key,
      tierIcon: definition.icon,
      sourceLabel: record?.source ? localize(SOURCE_LABELS[record.source] ?? SOURCE_LABELS.gm) : "",
      updatedLabel: record?.updatedAt ? formatTimestamp(record.updatedAt) : "",
      blocked: !!record?.blocked,
      attempts: record?.attempts ?? 0,
      lastRollLabel: record?.lastRoll
        ? game.i18n.format("BESTIARY.Knowledge.LastRoll", {
            total: record.lastRoll.total,
            dc: record.lastRoll.dc
          })
        : "",
      tierOptions: RESEARCH_TIERS.map(choice => ({
        value: choice.value,
        label: localize(choice.label),
        selected: choice.value === tier
      }))
    };
  });
}

export function setKnowledgeTier(uuid, userIds, tier) {
  return dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
    uuids: Array.isArray(uuid) ? uuid : [uuid],
    userIds: Array.isArray(userIds) ? userIds : [userIds],
    tier: clampKnownTier(tier, MIN_RESEARCH_TIER),
    source: "gm",
    grantedBy: game.user.id
  });
}

export function resetKnowledge(uuid, userIds = []) {
  return dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.RESET_KNOWLEDGE,
    uuids: Array.isArray(uuid) ? uuid : [uuid],
    userIds
  });
}

export function isSharingEnabled() {
  return game.settings.get("bestiary-journal", "allowPlayerSharing") !== false;
}

/**
 * Player-facing sharing: pick who receives the entry and at which tier.
 * The authoritative GM caps the result at the sender's own tier anyway, the
 * dialog just avoids offering impossible choices.
 */
export async function openShareDialog({ uuid, creatureName, knowledge }) {
  const senderTier = getUserTier(knowledge, game.user.id, uuid);
  if (senderTier <= MIN_RESEARCH_TIER) {
    ui.notifications.warn(localize("BESTIARY.Share.NothingToShare"));
    return false;
  }

  const recipients = getPlayerUsers().filter(user => user.id !== game.user.id);
  if (!recipients.length) {
    ui.notifications.info(localize("BESTIARY.Share.NoRecipients"));
    return false;
  }

  const tierOptions = RESEARCH_TIERS
    .filter(choice => choice.value > MIN_RESEARCH_TIER && choice.value <= senderTier)
    .map(choice => `<option value="${choice.value}"${choice.value === senderTier ? " selected" : ""}>${escapeHtml(localize(choice.label))}</option>`)
    .join("");

  const rows = recipients.map(user => `
    <label class="bestiary-share-row">
      <input type="checkbox" name="recipient" value="${escapeHtml(user.id)}" />
      <img src="${escapeHtml(user.avatar)}" alt="" />
      <span class="bestiary-share-name" style="--user-color:${escapeHtml(user.color)}">${escapeHtml(user.name)}</span>
      <em>${escapeHtml(describeTier(getUserTier(knowledge, user.id, uuid)).label)}</em>
    </label>`).join("");

  const content = `
    <section class="bestiary-share-dialog">
      <p class="bestiary-share-lead">${escapeHtml(game.i18n.format("BESTIARY.Share.Lead", { name: creatureName }))}</p>
      <div class="bestiary-share-list">${rows}</div>
      <label class="bestiary-share-tier">
        <span>${escapeHtml(localize("BESTIARY.Share.TierLabel"))}</span>
        <select name="tier">${tierOptions}</select>
      </label>
      <p class="bestiary-share-note">${escapeHtml(localize("BESTIARY.Share.CapNote"))}</p>
    </section>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("BESTIARY.Share.Title"), icon: "fas fa-share-nodes" },
    classes: ["bestiary-journal", "bestiary-app", "bestiary-dialog"],
    content,
    buttons: [
      {
        action: "share",
        icon: "fas fa-share-nodes",
        label: localize("BESTIARY.Share.Confirm"),
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element ?? button.form;
          return {
            userIds: [...root.querySelectorAll("input[name='recipient']:checked")].map(input => input.value),
            tier: Number(root.querySelector("select[name='tier']")?.value ?? senderTier)
          };
        }
      },
      { action: "cancel", icon: "fas fa-xmark", label: localize("BESTIARY.Cancel") }
    ],
    rejectClose: false
  });

  if (!result || result === "cancel" || !result.userIds?.length) return false;

  try {
    await dispatchBestiaryCommand({
      type: BESTIARY_COMMANDS.SHARE_KNOWLEDGE,
      uuid,
      toUserIds: result.userIds,
      tier: Math.min(result.tier, senderTier, MAX_RESEARCH_TIER)
    });
  } catch (error) {
    ui.notifications.error(error.message);
    return false;
  }
  ui.notifications.info(game.i18n.format("BESTIARY.Share.Done", { count: result.userIds.length }));
  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
