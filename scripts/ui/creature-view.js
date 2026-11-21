import { getCreatureData } from "../foundry/creature-cache.js";
import { MIN_RESEARCH_TIER, isGmTier, itemTierKey, resolveCreatureResearch } from "../core/research-model.js";
import { playerEntryContexts } from "../core/knowledge-lens.js";
import {
  BESTIARY_COMMANDS,
  canViewCreature,
  getCreatureCollections,
  getEntryContexts,
  getKnowledgeRecord,
  getUserTier,
  isCreatureLocked,
  selectEntryContext,
} from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge, getBestiarySocial } from "../foundry/bestiary-store.js";
import { reportCommandError, runCommand } from "../foundry/command-feedback.js";
import {
  buildEntryTierMatrix,
  getWorldMaxResearchTier,
  knowledgeLensFor,
  localizedTierChoices,
} from "../foundry/creature-display.js";
import { postCreatureToChat } from "./creature-cards.js";
import {
  buildCommentThreads,
  editComment,
  postComment,
  removeComment,
  toggleCommentPin,
} from "./comments.js";
import {
  buildKnowledgeRoster,
  isSharingEnabled,
  openShareDialog,
  resetKnowledge,
  setKnowledgeTier,
} from "./knowledge-ui.js";
import {
  describeTier,
  isResearchRollEnabled,
  researchActors,
  runResearchCheck,
  skillLabel,
} from "../foundry/research.js";
import { allowedResearchSkills } from "../foundry/research-skills.js";
import {
  getPreferredCommentChannel,
  getPreviewUserId,
  getFavoriteCreatureUuids,
  getShowOnboardingHints,
  setPreferredCommentChannel,
  setPreviewUserId,
  toggleFavoriteCreature,
} from "../foundry/client-preferences.js";
import { confirmDialog, getPlayerUsers, localize, resolveUuid } from "../foundry/foundry-runtime.js";
import { BestiaryEntryEditor } from "./entry-editor.js";
import { BestiaryGuideApp } from "./guide-app.js";
import { buildStatblock, buildTierSteps } from "./creature-statblock.js";
import { activateTablistKeyboard, animateDisclosure, playApplicationEntrance } from "./ui-effects.js";
import { bindArtwork } from "./artwork.js";
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
      openSheet: function () {
        this._onOpenSheet();
      },
      expandItem: function (event, target) {
        this._onExpandItem(event, target);
      },
      toggleSection: function (event, target) {
        this._onToggleSection(event, target);
      },
      toggleFavorite: function () {
        this._onToggleFavorite();
      },
      sendToChat: function () {
        this._onSendToChat();
      },
      setRail: function (event, target) {
        this._onSetRail(event, target);
      },
      setCommentChannel: function (event, target) {
        this._onSetCommentChannel(event, target);
      },
      submitComment: function () {
        return this._onSubmitComment();
      },
      cancelEdit: function () {
        this._onCancelEdit();
      },
      editComment: function (event, target) {
        this._onEditComment(event, target);
      },
      deleteComment: function (event, target) {
        this._onDeleteComment(event, target);
      },
      pinComment: function (event, target) {
        this._onPinComment(event, target);
      },
      toggleCommentShared: function (event, target) {
        this._onToggleCommentShared(event, target);
      },
      shareCreature: function () {
        this._onShareCreature();
      },
      runResearch: function (event, target) {
        this._onRunResearch(event, target);
      },
      bumpTier: function (event, target) {
        this._onBumpTier(event, target);
      },
      setPartyTier: function (event, target) {
        this._onSetPartyTier(event, target);
      },
      resetTiers: function () {
        this._onResetTiers();
      },
      toggleLock: function () {
        this._onToggleLock();
      },
      openEntryEditor: function () {
        this._onOpenEntryEditor();
      },
      resetBlockTiers: function () {
        this._onResetBlockTiers();
      },
      clearPreview: function () {
        this._onSetPreview("");
      },
      openGuide: function (event, target) {
        BestiaryGuideApp.open({ tab: target?.dataset?.tab || "research" });
      },
    },
  };

  static PARTS = {
    creature: {
      template: "modules/bestiary-journal/templates/creature-view.hbs",
      scrollable: ["", ".rail-body"],
    },
  };

  constructor(options = {}) {
    const uniqueId = options.uniqueId ?? foundry.utils.randomID(16);
    super({ ...options, uniqueId });
    this.actorUuid = options.uuid;
    this.sectionId = options.sectionId ?? null;
    this._expandedItems = new Set();
    // A stat block reads open: what the creature does is shown, the long lists stay folded.
    this._expandedSections = new Set([
      "features",
      "actions",
      "bonusActions",
      "reactions",
      "legendaryActions",
    ]);
    this._rail = ["knowledge", "comments", "config"].includes(options.rail) ? options.rail : "knowledge";
    this._commentChannel = null;
    this._commentDraft = "";
    this._commentDraftRevision = 0;
    this._commentPending = false;
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
      previewUser: user ? { id: user.id, name: user.name } : null,
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
    const context =
      selectEntryContext(data, this.actorUuid, effective, this.sectionId) ??
      (real.isGM ? (contexts.find((item) => item.section.id === this.sectionId) ?? contexts[0]) : null);
    this.sectionId = context?.section.id ?? this.sectionId ?? null;
    const entry = context?.entry ?? { image: {}, research: {}, blockTiers: {}, itemTiers: {} };

    const lens = knowledgeLensFor({ data, knowledge }, effective, this.actorUuid);
    const { tier } = lens;
    // A player opening the card has now seen what they know of it.
    if (!real.isGM)
      markSeen(this.actorUuid, tier).catch((error) => log.warn("Could not mark a creature as seen", error));

    const statblock = buildStatblock(creatureData, lens, entry, {
      // While previewing as a player, hidden content has to disappear the way it
      // does for them — otherwise the preview is not a preview.
      isGM: real.isGM && !previewUser,
      expanded: { sections: this._expandedSections, items: this._expandedItems },
    });
    const { creature } = statblock;
    const locked = isCreatureLocked(data, this.actorUuid);
    const entryLocked = !!entry.locked;
    const lockDisabled = !context || (!!context.section.locked && !entryLocked);
    const lockReason = context?.section.locked
      ? localize("BESTIARY.Lock.CollectionLocked")
      : contexts.some((item) => item.section.locked || (item.entry !== entry && item.entry.locked))
        ? localize("BESTIARY.Lock.InheritedLock")
        : "";
    const entryLockLabel = localize(entryLocked ? "BESTIARY.Lock.UnlockEntry" : "BESTIARY.Lock.LockEntry");
    const comments = await buildCommentThreads(social, this.actorUuid, real, { locked });

    this._title = creature.displayName;

    return {
      error: false,
      ...statblock,

      collections: getCreatureCollections(data, this.actorUuid, effective).map((collection) =>
        effective.isGM || creature.knowsName ? collection : { ...collection, familyName: "" },
      ),
      locked,
      entryLocked,
      lockDisabled,
      lockReason,
      lockLabel: lockReason ? `${entryLockLabel} — ${lockReason}` : entryLockLabel,
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

      research: this._buildResearchPanel(data, creatureData, lens, locked, effective, !!previewUser),
      knowledgeRoster: real.isGM ? buildKnowledgeRoster(knowledge, this.actorUuid) : [],
      partyTierOptions: localizedTierChoices(null, { includeNever: false }),
      shareEnabled: !real.isGM && isSharingEnabled() && !locked && tier > MIN_RESEARCH_TIER,

      comments,
      commentChannel: this._activeCommentChannel(real, comments.channels),
      activeChannelHint:
        comments.channels.find(
          (channel) => channel.key === this._activeCommentChannel(real, comments.channels),
        )?.hint ?? "",
      commentDraft: this._commentDraft,
      commentPending: this._commentPending,
      editingCommentId: this._editingCommentId,
      isEditingComment: !!this._editingCommentId,

      tierMatrix: real.isGM ? buildEntryTierMatrix(data, this.actorUuid, this.sectionId, entry) : [],
      hasEntry: contexts.length > 0,
      rail: this._rail,
      isRailKnowledge: this._rail === "knowledge",
      isRailComments: this._rail === "comments",
      isRailConfig: this._rail === "config",
      isFavorite: getFavoriteCreatureUuids().has(this.actorUuid),
      showHints: getShowOnboardingHints(),
    };
  }

  _buildPreviewOptions() {
    if (!game.user.isGM) return [];
    const current = getPreviewUserId();
    return [
      { id: "", name: localize("BESTIARY.Preview.AsGm"), selected: !current },
      ...getPlayerUsers().map((user) => ({ ...user, selected: user.id === current })),
    ];
  }

  /** The research panel as `viewer` sees it; in a GM's preview it only shows, the player rolls themselves. */
  _buildResearchPanel(data, creature, lens, locked, viewer, isPreview) {
    if (viewer.isGM) return null;
    const { tier } = lens;
    // The same check the GM judges the roll by, whichever collection the card was opened from.
    const config = resolveCreatureResearch(
      playerEntryContexts(data, this.actorUuid).map((context) => context.entry),
      creature,
      { allowedSkills: allowedResearchSkills() },
    );
    const knowsDc = lens.knowsDc(config);
    const knowsSkill = lens.knowsSkill(config);
    // Kept off the page: the roll uses it when the player cannot pick the skill themselves.
    this._researchSkill = config.skills[0];
    const record = getKnowledgeRecord(getBestiaryKnowledge(), viewer.id, this.actorUuid);
    const actors = researchActors(game.users.get(viewer.id));
    const maxTier = getWorldMaxResearchTier();
    const canRoll =
      !isPreview &&
      isResearchRollEnabled() &&
      !locked &&
      tier < maxTier &&
      !record?.blocked &&
      actors.length > 0;
    return {
      enabled: isResearchRollEnabled(),
      canRoll,
      blocked: !!record?.blocked,
      attempts: record?.attempts ?? 0,
      dc: knowsDc ? config.dc : "?",
      isMaxed: tier >= maxTier,
      nextTierLabel: describeTier(Math.min(tier + 1, maxTier)).label,
      skills: knowsSkill ? config.skills.map((skill) => ({ value: skill, label: skillLabel(skill) })) : [],
      skillHidden: !knowsSkill,
      actors: actors.map((actor) => ({ id: actor.id, name: actor.name, img: actor.img })),
      noActors: actors.length === 0,
      isPreview,
      lastRoll: record?.lastRoll
        ? game.i18n.format(knowsDc ? "BESTIARY.Research.LastAttempt" : "BESTIARY.Research.LastAttemptNoDc", {
            total: record.lastRoll.total,
            dc: record.lastRoll.dc,
          })
        : "",
    };
  }

  /** Falls back to the first available channel so the panel is never blank. */
  _activeCommentChannel(viewer, channels = null) {
    let preferred = this._commentChannel ?? getPreferredCommentChannel();
    if (preferred === "gm" && !viewer.isGM) preferred = "private";
    if (!channels?.length) return preferred;
    return channels.some((channel) => channel.key === preferred) ? preferred : channels[0].key;
  }

  // ── Rendering hooks ──

  _onRender(context, options) {
    super._onRender(context, options);
    this._disposeArtwork?.();
    BestiaryCreatureView._instances.add(this);
    this._syncWindowTitle();
    if (context.error) return;
    this._activateCommentEditor();
    this._syncCommentSubmitState();
    this._activateGmControls();
    activateTablistKeyboard(this.element);
    playApplicationEntrance(this, ".creature-detail-view");
    this._disposeArtwork = bindArtwork(this.element);
  }

  _onClose(options) {
    this._disposeArtwork?.();
    super._onClose(options);
    BestiaryCreatureView._instances.delete(this);
  }

  /** The frame is built once; keep its title in step with what is known. */
  _syncWindowTitle() {
    const title = this.window?.title;
    if (title instanceof HTMLElement) title.textContent = this.title;
  }

  _activateCommentEditor() {
    const input = this.element.querySelector(".comment-composer-input");
    if (!input) return;
    input.value = this._commentDraft;
    input.addEventListener("input", (event) => {
      this._commentDraft = event.currentTarget.value;
      this._commentDraftRevision++;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this._onSubmitComment();
      }
    });
  }

  _activateGmControls() {
    if (!game.user.isGM) return;

    for (const select of this.element.querySelectorAll("[data-item-tier]")) {
      select.addEventListener("change", (event) => this._onSetItemTier(event.currentTarget));
    }
    for (const select of this.element.querySelectorAll("[data-block-tier]")) {
      select.addEventListener("change", (event) => this._onSetBlockTier(event.currentTarget));
    }
    for (const select of this.element.querySelectorAll("[data-user-tier]")) {
      select.addEventListener("change", (event) => {
        setKnowledgeTier(
          this.actorUuid,
          event.currentTarget.dataset.userTier,
          Number(event.currentTarget.value),
        );
      });
    }
    this.element.querySelector(".preview-as-select")?.addEventListener("change", (event) => {
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

  async _onSetRail(event, target) {
    const rail = target.dataset.rail;
    if (!["knowledge", "comments", "config"].includes(rail)) return;
    const isKeyboard = event?.detail === 0;
    this._rail = rail;
    await this.render();
    if (isKeyboard) this.element?.querySelector(`.rail-tabs [data-rail="${rail}"]`)?.focus();
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
    const isKeyboard = event?.detail === 0;
    // Switching channels abandons an edit instead of silently carrying it over.
    if (this._editingCommentId) this._onCancelEdit({ render: false });
    this._commentChannel = channel;
    await setPreferredCommentChannel(channel);
    await this.render();
    if (isKeyboard) this.element?.querySelector(`.comment-channel-tabs [data-channel="${channel}"]`)?.focus();
  }

  async _onSubmitComment() {
    if (this._commentPending) return;
    const text = (this._commentDraft ?? "").trim();
    if (!text) return;
    const channel =
      this.element.querySelector(".comment-channel-tabs .is-active")?.dataset.channel ??
      this._activeCommentChannel({ id: game.user.id, isGM: game.user.isGM });
    const shared = channel === "gm" && !!this.element.querySelector(".comment-share-toggle")?.checked;

    if (this._editingCommentId && text === this._editingOriginal) {
      this._onCancelEdit();
      return;
    }
    const draft = this._commentDraft;
    const revision = this._commentDraftRevision;
    const editingId = this._editingCommentId;
    const draftChannel = this._commentChannel;
    this._commentPending = true;
    this._syncCommentSubmitState();
    try {
      const result = editingId
        ? await editComment(editingId, { text })
        : await postComment({ uuid: this.actorUuid, channel, text, shared });
      // Keep the draft when nothing was saved (a lock, a deleted comment).
      if (!result?.changed) {
        ui.notifications.warn(localize("BESTIARY.Comments.NotSaved"));
        return;
      }
      // Acknowledgement belongs to the submitted draft, not whatever the user
      // has typed, selected for editing, or moved to another channel since.
      if (
        revision === this._commentDraftRevision &&
        draft === this._commentDraft &&
        editingId === this._editingCommentId &&
        draftChannel === this._commentChannel
      ) {
        this._editingCommentId = null;
        this._commentDraft = "";
      }
      await this._refreshPreservingScroll();
    } catch (error) {
      reportCommandError(error);
    } finally {
      this._commentPending = false;
      this._syncCommentSubmitState();
    }
  }

  _syncCommentSubmitState() {
    const button = this.element?.querySelector('[data-action="submitComment"]');
    if (!button) return;
    button.disabled = this._commentPending;
    button.setAttribute("aria-busy", String(this._commentPending));
  }

  _onEditComment(event, target) {
    const row = target.closest("[data-comment-id]");
    if (!row) return;
    this._editingCommentId = row.dataset.commentId;
    this._commentDraftRevision++;
    this._commentDraft = row.querySelector(".comment-raw-text")?.textContent ?? "";
    this._editingOriginal = this._commentDraft.trim();
    if (row.dataset.channel) this._commentChannel = row.dataset.channel;
    this._rail = "comments";
    this.render();
  }

  _onCancelEdit({ render = true } = {}) {
    this._commentDraftRevision++;
    this._editingCommentId = null;
    this._commentDraft = "";
    if (render) this.render();
  }

  async _onDeleteComment(event, target) {
    const commentId = target.closest("[data-comment-id]")?.dataset.commentId;
    if (!commentId) return;
    const confirmed = await confirmDialog({
      title: localize("BESTIARY.Comments.Delete"),
      yesLabel: localize("BESTIARY.Comments.Delete"),
      content: `<p>${localize("BESTIARY.Comments.ConfirmDelete")}</p>`,
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
    await editComment(row.dataset.commentId, { shared: row.dataset.shared !== "true" }).catch(
      reportCommandError,
    );
  }

  // ── Knowledge ──

  async _onShareCreature() {
    await openShareDialog({
      uuid: this.actorUuid,
      creatureName: this._title,
      knowledge: getBestiaryKnowledge(),
    });
  }

  async _onRunResearch(event, target) {
    if (this._researchPending) return;
    const actorId = this.element.querySelector(".research-actor-select")?.value ?? target.dataset.actorId;
    const skill = this.element.querySelector(".research-skill-select")?.value || this._researchSkill;
    const actor = game.actors?.get(actorId) ?? researchActors()[0];

    this._researchPending = true;
    target.disabled = true;
    try {
      await runResearchCheck({ uuid: this.actorUuid, actor, skill, event });
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
    const current = getUserTier(getBestiaryKnowledge(), userId, this.actorUuid, getWorldMaxResearchTier());
    await setKnowledgeTier(this.actorUuid, userId, current + delta);
  }

  async _onSetPartyTier(event, target) {
    if (!game.user.isGM) return;
    const tier = Number(target.dataset.tier);
    const userIds = getPlayerUsers().map((user) => user.id);
    if (!userIds.length) return;
    await setKnowledgeTier(this.actorUuid, userIds, tier);
  }

  async _onResetTiers() {
    if (!game.user.isGM) return;
    const confirmed = await confirmDialog({
      title: localize("BESTIARY.Knowledge.Reset"),
      yesLabel: localize("BESTIARY.Knowledge.Reset"),
      content: `<p>${localize("BESTIARY.Knowledge.ConfirmReset")}</p>`,
    });
    if (!confirmed) return;
    await resetKnowledge(this.actorUuid);
  }

  // ── GM configuration ──

  async _onSetItemTier(select) {
    const patch = {
      itemTiers: {
        [itemTierKey(select.dataset.blockKey, select.dataset.itemId)]:
          select.value === "" ? null : Number(select.value),
      },
    };
    await runCommand(
      {
        type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
        sectionId: this.sectionId,
        uuid: this.actorUuid,
        patch,
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
  }

  async _onSetBlockTier(select) {
    await runCommand(
      {
        type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
        sectionId: this.sectionId,
        uuid: this.actorUuid,
        patch: { blockTiers: { [select.dataset.blockTier]: Number(select.value) } },
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
  }

  async _onResetBlockTiers() {
    const result = await runCommand(
      {
        type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
        sectionId: this.sectionId,
        uuid: this.actorUuid,
        patch: { blockTiers: {}, replaceBlockTiers: true, itemTiers: {}, replaceItemTiers: true },
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
    if (result?.changed) ui.notifications.info(localize("BESTIARY.Tier.ResetDone"));
  }

  async _onToggleLock() {
    if (!game.user.isGM || !this.sectionId) return;
    const context = getEntryContexts(getBestiaryData(), this.actorUuid).find(
      (item) => item.section.id === this.sectionId,
    );
    const entry = context?.entry;
    if (!entry || (context.section.locked && !entry.locked)) return;
    await runCommand({
      type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
      sectionId: this.sectionId,
      uuid: this.actorUuid,
      locked: !entry?.locked,
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
    this._expandedItems.has(itemKey) ? this._expandedItems.delete(itemKey) : this._expandedItems.add(itemKey);
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
    const toggle = itemElement?.querySelector(".creature-item-toggle");
    const icon = itemElement?.querySelector(".creature-item-chevron");
    itemElement?.classList.toggle("is-expanded", expanded);
    toggle?.setAttribute("aria-expanded", String(expanded));
    animateDisclosure(body, expanded);
    icon?.classList.toggle("fa-chevron-up", expanded);
    icon?.classList.toggle("fa-chevron-down", !expanded);
  }

  _toggleSectionElement(sectionKey, expanded) {
    const section = this.element?.querySelector(`[data-content-section="${sectionKey}"]`);
    section?.classList.toggle("is-expanded", expanded);
    section?.querySelector(".section-toggle")?.setAttribute("aria-expanded", String(expanded));
    animateDisclosure(section?.querySelector(".accordion-section-body"), expanded);
    const icon = section?.querySelector(".section-chevron");
    icon?.classList.toggle("fa-chevron-up", expanded);
    icon?.classList.toggle("fa-chevron-down", !expanded);
  }

  /** Scroll offsets survive render via `PARTS.creature.scrollable`. */
  _refreshPreservingScroll() {
    return this.render();
  }

  /**
   * Structure changes (visibility, locks, tier ladders) can affect any card;
   * knowledge and notes only matter to the creature they were about.
   */
  async refreshFromExternalUpdate(payload = {}) {
    const changed = payload.changed ?? {};
    const concernsThis = !Array.isArray(payload.uuids) || payload.uuids.includes(this.actorUuid);
    // `settings`: a world option changed which actions the card may offer; `creatures`: the actor itself changed.
    if (
      changed.data ||
      changed.settings ||
      ((changed.knowledge || changed.social || changed.creatures) && concernsThis)
    ) {
      await this._refreshPreservingScroll();
    }
  }
}
