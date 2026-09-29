import {
  BESTIARY_COMMANDS,
  canEditComment,
  selectComments
} from "../core/bestiary-domain.js";
import { dispatchBestiaryCommand } from "../foundry/bestiary-store.js";
import { enrichHtml, formatTimestamp, getUserById, localize } from "../foundry/foundry-runtime.js";
import { log } from "../core/logger.js";

export const COMMENT_CHANNEL_META = Object.freeze([
  { key: "gm", label: "BESTIARY.Comments.ChannelGm", hint: "BESTIARY.Comments.ChannelGmHint", icon: "fa-crown" },
  { key: "party", label: "BESTIARY.Comments.ChannelParty", hint: "BESTIARY.Comments.ChannelPartyHint", icon: "fa-users" },
  { key: "private", label: "BESTIARY.Comments.ChannelPrivate", hint: "BESTIARY.Comments.ChannelPrivateHint", icon: "fa-lock" }
]);

/**
 * Groups the comments a viewer may read into the three channels.
 * `locked` freezes every write control without hiding the content.
 */
export async function buildCommentThreads(social, uuid, viewer, { locked = false } = {}) {
  const visible = selectComments(social, uuid, viewer);
  const rendered = await Promise.all(visible.map(comment => decorateComment(comment, viewer, locked)));
  const channels = COMMENT_CHANNEL_META.map(meta => {
    const comments = rendered.filter(comment => comment.channel === meta.key);
    return {
      key: meta.key,
      label: localize(meta.label),
      hint: localize(meta.hint),
      icon: meta.icon,
      comments,
      count: comments.length,
      canPost: !locked && (meta.key !== "gm" || !!viewer.isGM)
    };
  }).filter(channel => channel.comments.length || channel.canPost);

  return {
    channels,
    total: rendered.length,
    locked,
    hasAny: rendered.length > 0
  };
}

async function decorateComment(comment, viewer, locked) {
  const author = getUserById(comment.authorId);
  return {
    ...comment,
    html: await renderCommentText(comment.text),
    authorName: author?.name ?? localize("BESTIARY.Comments.UnknownAuthor"),
    authorColor: author?.color?.css ?? author?.color ?? "#7a7a7a",
    authorAvatar: author?.avatar ?? "icons/svg/mystery-man.svg",
    isOwn: comment.authorId === viewer.id,
    createdLabel: formatTimestamp(comment.createdAt),
    editedLabel: comment.editedAt ? formatTimestamp(comment.editedAt) : "",
    canEdit: !locked && canEditComment(comment, viewer),
    canPin: !locked && !!viewer.isGM,
    canShare: !locked && !!viewer.isGM && comment.channel === "gm",
    shareLabel: localize(comment.shared
      ? "BESTIARY.Comments.SharedWithPlayers"
      : "BESTIARY.Comments.HiddenFromPlayers")
  };
}

/**
 * Comment bodies are plain text typed by users: escape first, then enrich, so
 * `@UUID[...]` style references still resolve without allowing raw HTML.
 */
async function renderCommentText(text) {
  const escaped = escapeHtml(String(text ?? ""));
  let enriched = escaped;
  try {
    enriched = await enrichHtml(escaped, {
      secrets: false, documents: true, links: true, rolls: true, embeds: false
    });
  } catch (error) {
    log.warn("Could not enrich a comment", error);
  }
  return enriched.replace(/\n/g, "<br />");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function postComment({ uuid, channel, text, shared = false }) {
  return dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.ADD_COMMENT,
    uuid,
    channel,
    text,
    shared
  });
}

export function editComment(commentId, patch) {
  return dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.UPDATE_COMMENT,
    commentId,
    patch
  });
}

export function removeComment(commentId) {
  return dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.DELETE_COMMENT,
    commentId
  });
}

export function toggleCommentPin(commentId) {
  return dispatchBestiaryCommand({
    type: BESTIARY_COMMANDS.TOGGLE_COMMENT_PIN,
    commentId
  });
}
