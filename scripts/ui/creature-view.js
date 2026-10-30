import { getCreatureData } from "../foundry/creature-cache.js";
import {
  MAX_RESEARCH_TIER,
  MIN_RESEARCH_TIER,
  isGmTier,
  itemTierKey
} from "../core/research-model.js";
import {
  BESTIARY_COMMANDS,
  canViewCreature,
  getCreatureCollections,
  getEntryContexts,
  getKnowledgeRecord,
  getUserTier,
  isCreatureLocked,
  selectEntryContext
} from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge, getBestiarySocial } from "../foundry/bestiary-store.js";
import { reportCommandError, runCommand } from "../foundry/command-feedback.js";
import {
  buildEntryTierMatrix,
  knowledgeLensFor,
  localizedTierChoices
} from "../foundry/creature-display.js";
import { postCreatureToChat } from "./creature-cards.js";
import { buildCommentThreads, editComment, postComment, removeComment, toggleCommentPin } from "./comments.js";
import {
  buildKnowledgeRoster,
  isSharingEnabled,
  openShareDialog,
  resetKnowledge,
  setKnowledgeTier
} from "./knowledge-ui.js";
import {
  describeTier,
  isResearchRollEnabled,
  researchActors,
  resolveResearchConfig,
  runResearchCheck,
  skillLabel
} from "../foundry/research.js";
import {
  getPreferredCommentChannel,
  getPreviewUserId,
  getFavoriteCreatureUuids,
  setPreferredCommentChannel,
  setPreviewUserId,
  toggleFavoriteCreature
} from "../foundry/client-preferences.js";
import {
  getPlayerUsers,
  localize,
  resolveUuid
} from "../foundry/foundry-runtime.js";
import { BestiaryEntryEditor } from "./entry-editor.js";
import { buildStatblock, buildTierSteps } from "./creature-statblock.js";
import { animateDisclosure, playApplicationEntrance } from "./ui-effects.js";
import { markSeen } from "../foundry/knowledge-watch.js";
import { log } from "../core/logger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiaryCreatureView extends HandlebarsApplicationMixin(ApplicationV2) {

  static _instances = new Set();

  static DEFAULT_OPTIONS = {
    id: "bestiary-creature-view-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-creature-view"],
    tag: "div",
    window: { title: "BESTIARY.Creature", icon: "fa-solid fa-dragon", resizable: true, minimizable: true },
    position: { width: 1180, height: 820 },
    actions: {
      openSheet: function () { this._onOpenSheet(); },
      expandItem: function (event, target) { this._onExpandItem(event, target); },
      toggleSection: function (event, target) { this._onToggleSection(event, target); },
      toggleFavorite: function () { this._onToggleFavorite(); },
      sendToChat: function () { this._onSendToChat(); },
      setRail: function (event, target) { this._onSetRail(event, target); },
      setCommentChannel: function (event, target) { this._onSetCommentChannel(event, target); },
      submitComment: function () { this._onSubmitComment(); },
      cancelEdit: function () { this._onCancelEdit(); },
      editComment: function (event, target) { this._onEditComment(event, target); },
      deleteComment: function (event, target) { this._onDeleteComment(event, target); },
      pinComment: function (event, target) { this._onPinComment(event, target); },
      toggleCommentShared: function (event, target) { this._onToggleCommentShared(event, target); },
      shareCreature: function () { this._onShareCreature(); },
      runResearch: function (event, target) { this._onRunResearch(event, target); },
      bumpTier: function (event, target) { this._onBumpTier(event, target); },
      setPartyTier: function (event, target) { this._onSetPartyTier(event, target); },
      resetTiers: function () { this._onResetTiers(); },
      toggleLock: function () { this._onToggleLock(); },
      openEntryEditor: function () { this._onOpenEntryEditor(); },
      resetBlockTiers: function () { this._onResetBlockTiers(); },
      clearPreview: function () { this._onSetPreview(""); }
    }
  };

  static PARTS = {
    creature: { template: "modules/bestiary-journal/templates/creature-view.hbs" }
  };

  constructor(options = {}) {
    const uniqueId = options.uniqueId ?? foundry.utils.randomID(16);
    super({ ...options, uniqueId });
    this.actorUuid = options.uuid;
    this.sectionId = options.sectionId ?? null;
    this._expandedItems = new Set();
    // A stat block reads open: what the creature does is shown, the long lists stay folded.
    this._expandedSections = new Set(["features", "actions", "bonusActions", "reactions", "legendaryActions"]);
    this._rail = ["knowledge", "comments", "config"].includes(options.rail) ? options.rail : "knowledge";
    this._commentChannel = null;
    this._commentDraft = "";
    this._editingCommentId = null;
  }

  get title() {
    return this._title ?? localize("BESTIARY.Creature");
  }

  /** The GM may read the card through a specific player's eyes. */
  _resolveViewer() {
    const real = { id: game.user.id, isGM: game.user.isGM };
    if (!game.user.isGM) return { real, effective: real, previewUser: null };
    const previewId = getPreviewUserId();
    if (!previewId) return { real, effective: real, previewUser: null };
    const user = game.users.get(previewId);
    return {
      real,
      effective: { id: previewId, isGM: false },
      previewUser: user ? { id: user.id, name: user.name } : null
    };
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const { real, effective, previewUser } = this._resolveViewer();
    // Hidden while a player had the card open: the card closes its content.
    if (!real.isGM && !canViewCreature(data, this.actorUuid, real)) {
      this._title = localize("BESTIARY.Creature");
      return { error: true, unavailable: true };
    }

    const creatureData = await getCreatureData(this.actorUuid, { enrich: true });
    if (!creatureData) return { error: true };

    const knowledge = getBestiaryKnowledge();
    const social = getBestiarySocial();

    const contexts = getEntryContexts(data, this.actorUuid);
    const context = selectEntryContext(data, this.actorUuid, effective, this.sectionId)
      ?? (real.isGM ? contexts.find(item => item.section.id === this.sectionId) ?? contexts[0] : null);
    this.sectionId = context?.section.id ?? this.sectionId ?? null;
    const entry = context?.entry ?? { image: {}, research: {}, blockTiers: {}, itemTiers: {} };

    const lens = knowledgeLensFor({ data, knowledge }, effective, this.actorUuid);
    const { tier } = lens;
    // A player opening the card has now seen what they know of it.
    if (!real.isGM) markSeen(this.actorUuid, tier).catch(error => log.warn("Could not mark a creature as seen", error));

    const statblock = buildStatblock(creatureData, lens, entry, {
      // While previewing as a player, hidden content has to disappear the way it
      // does for them — otherwise the preview is not a preview.
      isGM: real.isGM && !previewUser,
      expanded: { sections: this._expandedSections, items: this._expandedItems }
    });
    const { creature } = statblock;
    const locked = isCreatureLocked(data, this.actorUuid);
    const comments = await buildCommentThreads(social, this.actorUuid, real, { locked });

    this._title = creature.displayName;

    return {
      error: false,
      ...statblock,

      collections: getCreatureCollections(data, this.actorUuid, effective)
        .map(collection => (effective.isGM || creature.knowsName ? collection : { ...collection, familyName: "" })),
      locked,
      lockLabel: localize(locked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
      isGM: real.isGM,
      // A GM previewing as a player sees that player's knowledge panel instead of the party roster.
      showRoster: real.isGM && !previewUser,
      isPreviewing: !!previewUser,
      previewUserName: previewUser?.name ?? "",
      previewOptions: this._buildPreviewOptions(),

      tier,
      isGmTier: isGmTier(tier),
      tierBadge: isGmTier(tier)
        ? { label: localize("BESTIARY.Tier.GmView"), key: "gm", icon: "fa-user-shield" }
        : describeTier(tier),
      tierSteps: buildTierSteps(tier),

      research: this._buildResearchPanel(entry, creatureData, lens, locked, effective, !!previewUser),
      knowledgeRoster: real.isGM ? buildKnowledgeRoster(knowledge, this.actorUuid) : [],
      partyTierOptions: localizedTierChoices(null, { includeNever: false }),
      shareEnabled: !real.isGM && isSharingEnabled() && !locked && tier > MIN_RESEARCH_TIER,

      comments,
      commentChannel: this._activeCommentChannel(real, comments.channels),
      commentDraft: this._commentDraft,
      editingCommentId: this._editingCommentId,
      isEditingComment: !!this._editingCommentId,

      tierMatrix: real.isGM ? buildEntryTierMatrix(data, this.actorUuid, this.sectionId, entry) : [],
      hasEntry: contexts.length > 0,
      rail: this._rail,
      isRailKnowledge: this._rail === "knowledge",
      isRailComments: this._rail === "comments",
      isRailConfig: this._rail === "config",
      isFavorite: getFavoriteCreatureUuids().has(this.actorUuid)
    };
  }

  _buildPreviewOptions() {
    if (!game.user.isGM) return [];
    const current = getPreviewUserId();
    return [
      { id: "", name: localize("BESTIARY.Preview.AsGm"), selected: !current },
      ...getPlayerUsers().map(user => ({ ...user, selected: user.id === current }))
    ];
  }

  /** The research panel as `viewer` sees it; in a GM's preview it only shows, the player rolls themselves. */
  _buildResearchPanel(entry, creature, lens, locked, viewer, isPreview) {
    if (viewer.isGM) return null;
    const { tier } = lens;
    const config = resolveResearchConfig(entry, creature);
    const knowsDc = lens.knowsDc(config);
    const knowsSkill = lens.knowsSkill(config);
    // Kept off the page: the roll uses it when the player cannot pick the skill themselves.
    this._researchSkill = config.skills[0];
    const record = getKnowledgeRecord(getBestiaryKnowledge(), viewer.id, this.actorUuid);
    const actors = researchActors(game.users.get(viewer.id));
    const canRoll = !isPreview
      && isResearchRollEnabled()
      && !locked
      && tier < MAX_RESEARCH_TIER
      && !record?.blocked
      && actors.length > 0;
    return {
      enabled: isResearchRollEnabled(),
      canRoll,
      blocked: !!record?.blocked,
      attempts: record?.attempts ?? 0,
      dc: knowsDc ? config.dc : "?",
      isMaxed: tier >= MAX_RESEARCH_TIER,
      nextTierLabel: describeTier(Math.min(tier + 1, MAX_RESEARCH_TIER)).label,
      skills: knowsSkill ? config.skills.map(skill => ({ value: skill, label: skillLabel(skill) })) : [],
      skillHidden: !knowsSkill,
      actors: actors.map(actor => ({ id: actor.id, name: actor.name, img: actor.img })),
      noActors: actors.length === 0,
      isPreview,
      lastRoll: record?.lastRoll
        ? game.i18n.format(knowsDc ? "BESTIARY.Research.LastAttempt" : "BESTIARY.Research.LastAttemptNoDc", {
            total: record.lastRoll.total,
            dc: record.lastRoll.dc
          })
        : ""
    };
  }

  /** Falls back to the first available channel so the panel is never blank. */
  _activeCommentChannel(viewer, channels = null) {
    let preferred = this._commentChannel ?? getPreferredCommentChannel();
    if (preferred === "gm" && !viewer.isGM) preferred = "private";
    if (!channels?.length) return preferred;
    return channels.some(channel => channel.key === preferred)
      ? preferred
      : channels[0].key;
  }

  // ── Rendering hooks ──

  _onRender(context, options) {
    super._onRender(context, options);
    BestiaryCreatureView._instances.add(this);
    this._syncWindowTitle();
    if (context.error) return;
    this._activateCommentEditor();
    this._activateGmControls();
    this._activateItemKeyboard();
    playApplicationEntrance(this, ".creature-detail-view");
  }

  _onClose(options) {
    super._onClose(options);
    BestiaryCreatureView._instances.delete(this);
  }

  /** The frame is built once; keep its title in step with what is known. */
  _syncWindowTitle() {
    const title = this.window?.title;
    if (title instanceof HTMLElement) title.textContent = this.title;
  }

  _activateItemKeyboard() {
    for (const item of this.element.querySelectorAll(".creature-item[data-item-key]")) {
      item.addEventListener("keydown", event => {
        if (event.target !== item) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._onExpandItem(event, item);
        }
      });
    }
  }

  _activateCommentEditor() {
    const input = this.element.querySelector(".comment-composer-input");
    if (!input) return;
    input.value = this._commentDraft;
    input.addEventListener("input", event => { this._commentDraft = event.currentTarget.value; });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this._onSubmitComment();
      }
    });
  }

  _activateGmControls() {
    if (!game.user.isGM) return;

    for (const select of this.element.querySelectorAll("[data-item-tier]")) {
      select.addEventListener("change", event => this._onSetItemTier(event.currentTarget));
    }
    for (const select of this.element.querySelectorAll("[data-block-tier]")) {
      select.addEventListener("change", event => this._onSetBlockTier(event.currentTarget));
    }
    for (const select of this.element.querySelectorAll("[data-user-tier]")) {
      select.addEventListener("change", event => {
        setKnowledgeTier(this.actorUuid, event.currentTarget.dataset.userTier, Number(event.currentTarget.value));
      });
    }
    this.element.querySelector(".preview-as-select")?.addEventListener("change", event => {
      this._onSetPreview(event.currentTarget.value);
    });
  }

  // ── Actions ──

  async _onOpenSheet() {
    if (!game.user.isGM) return;
    const actor = await resolveUuid(this.actorUuid);
    actor?.sheet.render({ force: true });
  }

  async _onToggleFavorite() {
    await toggleFavoriteCreature(this.actorUuid);
    await this._refreshPreservingScroll();
  }

  _onSetRail(event, target) {
    const rail = target.dataset.rail;
    if (!["knowledge", "comments", "config"].includes(rail)) return;
    this._rail = rail;
    this.render();
  }

  /** "Preview as" is one client preference, so every open card follows it. */
  async _onSetPreview(userId) {
    await setPreviewUserId(userId ?? "");
    for (const app of BestiaryCreatureView._instances) {
      if (app.rendered) app._refreshPreservingScroll();
    }
  }

  // ── Comments ──

  async _onSetCommentChannel(event, target) {
    const channel = target.dataset.channel;
    if (!["gm", "private", "party"].includes(channel)) return;
    if (channel === "gm" && !game.user.isGM) return;
    // Switching channels abandons an edit instead of silently carrying it over.
    if (this._editingCommentId) this._onCancelEdit({ render: false });
    this._commentChannel = channel;
    await setPreferredCommentChannel(channel);
    this.render();
  }

  async _onSubmitComment() {
    const text = (this._commentDraft ?? "").trim();
    if (!text) return;
    const channel = this.element.querySelector(".comment-channel-tabs .is-active")?.dataset.channel
      ?? this._activeCommentChannel({ id: game.user.id, isGM: game.user.isGM });
    const shared = channel === "gm"
      && !!this.element.querySelector(".comment-share-toggle")?.checked;

    if (this._editingCommentId && text === this._editingOriginal) {
      this._onCancelEdit();
      return;
    }
    let result;
    try {
      result = this._editingCommentId
        ? await editComment(this._editingCommentId, { text })
        : await postComment({ uuid: this.actorUuid, channel, text, shared });
    } catch (error) {
      reportCommandError(error);
      return;
    }
    // Keep the draft when nothing was saved (a lock, a deleted comment).
    if (!result?.changed) {
      ui.notifications.warn(localize("BESTIARY.Comments.NotSaved"));
      return;
    }
    this._editingCommentId = null;
    this._commentDraft = "";
    await this._refreshPreservingScroll();
  }

  _onEditComment(event, target) {
    const row = target.closest("[data-comment-id]");
    if (!row) return;
    this._editingCommentId = row.dataset.commentId;
    this._commentDraft = row.querySelector(".comment-raw-text")?.textContent ?? "";
    this._editingOriginal = this._commentDraft.trim();
    if (row.dataset.channel) this._commentChannel = row.dataset.channel;
    this._rail = "comments";
    this.render();
  }

  _onCancelEdit({ render = true } = {}) {
    this._editingCommentId = null;
    this._commentDraft = "";
    if (render) this.render();
  }

  async _onDeleteComment(event, target) {
    const commentId = target.closest("[data-comment-id]")?.dataset.commentId;
    if (!commentId) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.Comments.Delete") },
      yes: { label: localize("BESTIARY.Comments.Delete") },
      no: { label: localize("BESTIARY.Cancel") },
      content: `<p>${localize("BESTIARY.Comments.ConfirmDelete")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    if (this._editingCommentId === commentId) this._onCancelEdit({ render: false });
    await removeComment(commentId).catch(reportCommandError);
  }

  async _onPinComment(event, target) {
    const commentId = target.closest("[data-comment-id]")?.dataset.commentId;
    if (!commentId) return;
    await toggleCommentPin(commentId).catch(reportCommandError);
  }

  async _onToggleCommentShared(event, target) {
    const row = target.closest("[data-comment-id]");
    if (!row) return;
    await editComment(row.dataset.commentId, { shared: row.dataset.shared !== "true" }).catch(reportCommandError);
  }

  // ── Knowledge ──

  async _onShareCreature() {
    await openShareDialog({
      uuid: this.actorUuid,
      creatureName: this._title,
      knowledge: getBestiaryKnowledge()
    });
  }

  async _onRunResearch(event, target) {
    if (this._researchPending) return;
    const actorId = this.element.querySelector(".research-actor-select")?.value
      ?? target.dataset.actorId;
    const skill = this.element.querySelector(".research-skill-select")?.value || this._researchSkill;
    const actor = game.actors?.get(actorId) ?? researchActors()[0];

    this._researchPending = true;
    target.disabled = true;
    try {
      await runResearchCheck({ uuid: this.actorUuid, sectionId: this.sectionId, actor, skill, event });
    } catch (error) {
      reportCommandError(error);
    } finally {
      this._researchPending = false;
      if (target.isConnected) target.disabled = false;
    }
  }

  async _onBumpTier(event, target) {
    if (!game.user.isGM) return;
    const userId = target.dataset.userId;
    const delta = Number(target.dataset.delta ?? 1);
    const current = getUserTier(getBestiaryKnowledge(), userId, this.actorUuid);
    await setKnowledgeTier(this.actorUuid, userId, current + delta);
  }

  async _onSetPartyTier(event, target) {
    if (!game.user.isGM) return;
    const tier = Number(target.dataset.tier);
    const userIds = getPlayerUsers().map(user => user.id);
    if (!userIds.length) return;
    await setKnowledgeTier(this.actorUuid, userIds, tier);
  }

  async _onResetTiers() {
    if (!game.user.isGM) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.Knowledge.Reset") },
      yes: { label: localize("BESTIARY.Knowledge.Reset") },
      no: { label: localize("BESTIARY.Cancel") },
      content: `<p>${localize("BESTIARY.Knowledge.ConfirmReset")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await resetKnowledge(this.actorUuid);
  }

  // ── GM configuration ──

  async _onSetItemTier(select) {
    const patch = {
      itemTiers: {
        [itemTierKey(select.dataset.blockKey, select.dataset.itemId)]:
          select.value === "" ? null : Number(select.value)
      }
    };
    await runCommand({
      type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
      sectionId: this.sectionId,
      uuid: this.actorUuid,
      patch
    }, { unchanged: "BESTIARY.Lock.Blocked" });
  }

  async _onSetBlockTier(select) {
    await runCommand({
      type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
      sectionId: this.sectionId,
      uuid: this.actorUuid,
      patch: { blockTiers: { [select.dataset.blockTier]: Number(select.value) } }
    }, { unchanged: "BESTIARY.Lock.Blocked" });
  }

  async _onResetBlockTiers() {
    const result = await runCommand({
      type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
      sectionId: this.sectionId,
      uuid: this.actorUuid,
      patch: { blockTiers: {}, replaceBlockTiers: true, itemTiers: {}, replaceItemTiers: true }
    }, { unchanged: "BESTIARY.Lock.Blocked" });
    if (result?.changed) ui.notifications.info(localize("BESTIARY.Tier.ResetDone"));
  }

  async _onToggleLock() {
    if (!game.user.isGM || !this.sectionId) return;
    const entry = getEntryContexts(getBestiaryData(), this.actorUuid)
      .find(item => item.section.id === this.sectionId)?.entry;
    await runCommand({
      type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
      sectionId: this.sectionId,
      uuid: this.actorUuid,
      locked: !entry?.locked
    });
  }

  _onOpenEntryEditor() {
    if (!game.user.isGM || !this.sectionId) return;
    new BestiaryEntryEditor({ sectionId: this.sectionId, uuid: this.actorUuid }).render({ force: true });
  }

  // ── Chat ──

  async _onSendToChat() {
    const { effective } = this._resolveViewer();
    await postCreatureToChat({ uuid: this.actorUuid, sectionId: this.sectionId, viewer: effective });
  }

  // ── Disclosure ──

  _onExpandItem(event, target) {
    if (event.target.closest("select, .item-tier-control")) return;
    const itemElement = target.closest("[data-item-key]");
    const itemKey = itemElement?.dataset.itemKey;
    if (!itemKey) return;
    this._expandedItems.has(itemKey)
      ? this._expandedItems.delete(itemKey)
      : this._expandedItems.add(itemKey);
    this._toggleItemElement(itemElement, this._expandedItems.has(itemKey));
  }

  _onToggleSection(event, target) {
    const sectionKey = target.dataset.sectionKey;
    if (!sectionKey) return;
    this._expandedSections.has(sectionKey)
      ? this._expandedSections.delete(sectionKey)
      : this._expandedSections.add(sectionKey);
    this._toggleSectionElement(sectionKey, this._expandedSections.has(sectionKey));
  }

  _toggleItemElement(itemElement, expanded) {
    const body = itemElement?.querySelector(".creature-item-body");
    const icon = itemElement?.querySelector(".creature-item-chevron");
    itemElement?.classList.toggle("is-expanded", expanded);
    animateDisclosure(body, expanded);
    icon?.classList.toggle("fa-chevron-up", expanded);
    icon?.classList.toggle("fa-chevron-down", !expanded);
  }

  _toggleSectionElement(sectionKey, expanded) {
    const section = this.element?.querySelector(`[data-content-section="${sectionKey}"]`);
    section?.classList.toggle("is-expanded", expanded);
    animateDisclosure(section?.querySelector(".accordion-section-body"), expanded);
    const icon = section?.querySelector(".section-chevron");
    icon?.classList.toggle("fa-chevron-up", expanded);
    icon?.classList.toggle("fa-chevron-down", !expanded);
  }

  /** Re-renders without throwing the reader back to the top of any pane. */
  async _refreshPreservingScroll() {
    const selectors = [".creature-detail-wrapper", ".rail-body"];
    const offsets = selectors.map(selector => this.element?.querySelector(selector)?.scrollTop ?? 0);
    await this.render();
    selectors.forEach((selector, index) => {
      const next = this.element?.querySelector(selector);
      if (next) next.scrollTop = offsets[index];
    });
  }

  /**
   * Structure changes (visibility, locks, tier ladders) can affect any card;
   * knowledge and notes only matter to the creature they were about.
   */
  async refreshFromExternalUpdate(payload = {}) {
    const changed = payload.changed ?? {};
    const concernsThis = !Array.isArray(payload.uuids) || payload.uuids.includes(this.actorUuid);
    // `settings`: a world option changed which actions the card may offer; `creatures`: the actor itself changed.
    if (changed.data || changed.settings || ((changed.knowledge || changed.social || changed.creatures) && concernsThis)) {
      await this._refreshPreservingScroll();
    }
  }
}
