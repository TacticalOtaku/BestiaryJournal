import { formatMod, formatCR, localizeDndLabel, formatDistanceUnit } from "./helpers.mjs";
import { getCreatureData } from "./creature-cache.mjs";
import {
  GM_TIER,
  MAX_RESEARCH_TIER,
  MIN_RESEARCH_TIER,
  isBlockVisible,
  isGmTier,
  isItemVisible,
  itemTierKey,
  requiredTierForItem
} from "./research-model.mjs";
import {
  BESTIARY_COMMANDS,
  canViewCreature,
  getCreatureCollections,
  getEntryContexts,
  getUserTier,
  isCreatureLocked,
  selectEntryContext
} from "./bestiary-domain.mjs";
import { getBestiaryData, getBestiaryKnowledge, getBestiarySocial } from "./bestiary-store.mjs";
import { reportCommandError, runCommand } from "./command-feedback.mjs";
import {
  buildTierMatrix,
  getEntryBlockTiers,
  localizedTierChoices
} from "./creature-display.mjs";
import { buildImageView, SILHOUETTE_PLACEHOLDER } from "./image-framing.mjs";
import { buildCommentThreads, editComment, postComment, removeComment, toggleCommentPin } from "./comments.mjs";
import {
  buildKnowledgeRoster,
  isSharingEnabled,
  openShareDialog,
  resetKnowledge,
  setKnowledgeTier
} from "./knowledge-ui.mjs";
import {
  describeTier,
  isResearchRollEnabled,
  researchActors,
  resolveResearchConfig,
  runResearchCheck,
  skillLabel
} from "./research.mjs";
import {
  getPreferredCommentChannel,
  getPreviewUserId,
  getFavoriteCreatureUuids,
  setPreferredCommentChannel,
  setPreviewUserId,
  toggleFavoriteCreature
} from "./client-preferences.mjs";
import {
  getDnd5eConfig,
  getPlayerUsers,
  localize,
  resolveUuid
} from "./foundry-runtime.mjs";
import { BestiaryEntryEditor } from "./entry-editor.mjs";
import { animateDisclosure, playApplicationEntrance } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

const CONTENT_SECTION_DEFS = [
  ["features", "BESTIARY.Features", "fa-wand-magic-sparkles"],
  ["actions", "BESTIARY.Actions", "fa-khanda"],
  ["bonusActions", "BESTIARY.BonusActions", "fa-bolt"],
  ["reactions", "BESTIARY.Reactions", "fa-shield"],
  ["legendaryActions", "BESTIARY.LegendaryActions", "fa-crown"],
  ["spells", "BESTIARY.Spellcasting", "fa-wand-sparkles"],
  ["inventory", "BESTIARY.Inventory", "fa-bag-shopping"]
];

export class BestiaryCreatureView extends HandlebarsApplicationMixin(ApplicationV2) {

  static _instances = new Set();

  static DEFAULT_OPTIONS = {
    id: "bestiary-creature-view-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-creature-view"],
    tag: "div",
    window: { title: "BESTIARY.Creature", icon: "fas fa-dragon", resizable: true, minimizable: true },
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
    this._expandedSections = new Set(["features", "actions"]);
    this._rail = "knowledge";
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

    const tier = effective.isGM
      ? GM_TIER
      : getUserTier(knowledge, effective.id, this.actorUuid);
    const blockTiers = getEntryBlockTiers(entry);
    const show = key => isBlockVisible(key, tier, blockTiers);

    const creature = this._decorateCreature(creatureData, show);
    const locked = isCreatureLocked(data, this.actorUuid);
    const stats = this._buildStatEntries(creature, tier, blockTiers);
    // While previewing as a player, hidden content has to disappear the way it
    // does for them — otherwise the preview is not a preview.
    const contentSections = this._buildContentSections(
      creature, tier, blockTiers, entry, real.isGM && !previewUser
    );
    const showBlock = this._buildBlockVisibility(creature, stats, show);
    const comments = await buildCommentThreads(social, this.actorUuid, real, { locked });

    this._title = creature.displayName;

    return {
      error: false,
      creature,
      image: buildImageView(entry, creature, { silhouette: !show("portrait") }),
      ...stats,
      contentSections,
      showBlock,
      showAbilities: show("abilities") && stats.abilityEntries.length > 0,
      showDefenses: showBlock.resistances || showBlock.immunities
        || showBlock.vulnerabilities || showBlock.conditionImmunities,
      showVitals: showBlock.ac || showBlock.hp || showBlock.cr || showBlock.xp,
      hasContent: contentSections.length > 0,
      isBlank: !showBlock.ac && !showBlock.hp && !show("abilities") && contentSections.length === 0,

      collections: getCreatureCollections(data, this.actorUuid, real),
      locked,
      lockLabel: localize(locked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
      isGM: real.isGM,
      isPreviewing: !!previewUser,
      previewUserName: previewUser?.name ?? "",
      previewOptions: this._buildPreviewOptions(),

      tier,
      isGmTier: isGmTier(tier),
      tierBadge: isGmTier(tier)
        ? { label: localize("BESTIARY.Tier.GmView"), key: "gm", icon: "fa-user-shield" }
        : describeTier(tier),
      tierSteps: this._buildTierSteps(tier),

      research: this._buildResearchPanel(entry, creatureData, tier, locked),
      knowledgeRoster: real.isGM ? buildKnowledgeRoster(knowledge, this.actorUuid) : [],
      partyTierOptions: localizedTierChoices(null, { includeNever: false }),
      shareEnabled: !real.isGM && isSharingEnabled() && !locked && tier > MIN_RESEARCH_TIER,

      comments,
      commentChannel: this._activeCommentChannel(real, comments.channels),
      commentDraft: this._commentDraft,
      editingCommentId: this._editingCommentId,
      isEditingComment: !!this._editingCommentId,

      tierMatrix: real.isGM ? buildTierMatrix(blockTiers, entry.blockTiers) : [],
      hasEntry: contexts.length > 0,
      rail: this._rail,
      isRailKnowledge: this._rail === "knowledge",
      isRailComments: this._rail === "comments",
      isRailConfig: this._rail === "config",
      isFavorite: getFavoriteCreatureUuids().has(this.actorUuid)
    };
  }

  _decorateCreature(creature, show) {
    const hpRatio = creature.hp.max > 0 ? creature.hp.value / creature.hp.max : 0;
    const knowsName = show("name");
    const typeLabel = [
      creature.size,
      creature.creatureType,
      creature.creatureSubtype ? `(${creature.creatureSubtype})` : ""
    ].filter(Boolean).join(" · ");
    return {
      ...creature,
      displayName: knowsName ? creature.name : localize("BESTIARY.Tier.UnknownName"),
      knowsName,
      crFormatted: formatCR(creature.cr),
      typeLabel: show("type") ? typeLabel : localize("BESTIARY.Tier.UnknownType"),
      showAlignment: show("alignment") && !!creature.alignment,
      hpPercent: Math.max(0, Math.min(100, Math.round(hpRatio * 100))),
      lowHp: creature.hp.max > 0 && hpRatio <= 0.25
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

  _buildTierSteps(tier) {
    const current = isGmTier(tier) ? MAX_RESEARCH_TIER : tier;
    return [0, 1, 2, 3].map(value => {
      const definition = describeTier(value);
      return {
        value,
        label: definition.label,
        icon: definition.icon,
        reached: value <= current,
        isCurrent: value === current
      };
    });
  }

  _buildResearchPanel(entry, creature, tier, locked) {
    if (game.user.isGM) return null;
    const config = resolveResearchConfig(entry, creature);
    const record = getBestiaryKnowledge().users?.[game.user.id]?.[this.actorUuid] ?? null;
    const actors = researchActors();
    const canRoll = isResearchRollEnabled()
      && !locked
      && tier < MAX_RESEARCH_TIER
      && !record?.blocked
      && actors.length > 0;
    return {
      enabled: isResearchRollEnabled(),
      canRoll,
      blocked: !!record?.blocked,
      attempts: record?.attempts ?? 0,
      dc: config.dc,
      isMaxed: tier >= MAX_RESEARCH_TIER,
      nextTierLabel: describeTier(Math.min(tier + 1, MAX_RESEARCH_TIER)).label,
      skills: config.skills.map(skill => ({ value: skill, label: skillLabel(skill) })),
      actors: actors.map(actor => ({ id: actor.id, name: actor.name, img: actor.img })),
      noActors: actors.length === 0,
      lastRoll: record?.lastRoll
        ? game.i18n.format("BESTIARY.Research.LastAttempt", {
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

  _buildStatEntries(creature, tier, blockTiers) {
    const dnd5e = getDnd5eConfig();
    const abilityEntries = Object.entries(creature.abilities)
      .filter(([key]) => isBlockVisible(key, tier, blockTiers))
      .map(([key, ability]) => ({
        key,
        label: localizeDndLabel("AbilityAbbreviations", {}, key, dnd5e.abilities?.[key]?.abbreviation ?? ability.label),
        fullLabel: ability.label,
        value: ability.value,
        mod: formatMod(ability.mod),
        save: formatMod(ability.save)
      }));

    return {
      abilityEntries,
      skillEntries: Object.values(creature.skills)
        .map(skill => ({ label: skill.label, total: formatMod(skill.total) })),
      speedEntries: this._buildSpeedEntries(creature),
      senseEntries: this._buildSenseEntries(creature, dnd5e)
    };
  }

  _buildSpeedEntries(creature) {
    const unit = formatDistanceUnit(creature.speedUnits);
    return Object.entries(creature.speeds).map(([key, value]) => ({
      label: localize(`BESTIARY.Speed${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      value: `${value} ${unit}`
    }));
  }

  _buildSenseEntries(creature, dnd5e) {
    const unit = formatDistanceUnit(creature.senseUnits);
    return Object.entries(creature.senses).map(([key, value]) => ({
      label: key === "special"
        ? localize("BESTIARY.SpecialSenses")
        : localizeDndLabel("Senses", dnd5e.senses, key, key),
      value: typeof value === "number" ? `${value} ${unit}` : value
    }));
  }

  /**
   * Builds one accordion per content block. Items the viewer may not see are
   * dropped entirely; the GM instead keeps them with a tier control so the
   * hidden ones stay obvious.
   */
  _buildContentSections(creature, tier, blockTiers, entry, isGM) {
    const sections = [];
    for (const [key, label, icon] of CONTENT_SECTION_DEFS) {
      const source = creature[key] ?? [];
      if (!source.length) continue;
      const blockVisible = isBlockVisible(key, tier, blockTiers);
      if (!blockVisible && !isGM) continue;

      const items = source
        .filter(item => isGM || isItemVisible(key, item.id ?? item.name, tier, blockTiers, entry.itemTiers))
        .map(item => this._decorateItem(item, key, tier, blockTiers, entry, isGM));
      if (!items.length) continue;

      sections.push({
        key,
        label: localize(label),
        icon,
        count: items.length,
        expanded: this._expandedSections.has(key),
        items,
        isSpells: key === "spells",
        blockHiddenForPlayers: !blockVisible,
        hiddenItemCount: items.filter(item => item.hiddenForPlayers).length
      });
    }

    if (creature.biography && (isBlockVisible("biography", tier, blockTiers) || isGM)) {
      sections.push({
        key: "biography",
        label: localize("BESTIARY.Biography"),
        icon: "fa-feather-pointed",
        count: null,
        expanded: this._expandedSections.has("biography"),
        isBiography: true,
        biography: creature.biography,
        blockHiddenForPlayers: !isBlockVisible("biography", tier, blockTiers),
        items: []
      });
    }
    return sections;
  }

  _decorateItem(item, blockKey, tier, blockTiers, entry, isGM) {
    const itemId = item.id ?? item.name;
    const itemKey = `${blockKey}:${itemId}`;
    const override = entry.itemTiers?.[itemTierKey(blockKey, itemId)];
    const required = requiredTierForItem(blockKey, itemId, blockTiers, entry.itemTiers);
    return {
      ...item,
      itemKey,
      blockKey,
      itemId,
      expanded: this._expandedItems.has(itemKey),
      primaryActivity: item.activities?.[0] ?? null,
      hasActivity: (item.activities?.length ?? 0) > 0,
      hiddenForPlayers: !isItemVisible(blockKey, itemId, MAX_RESEARCH_TIER, blockTiers, entry.itemTiers),
      requiredTier: required,
      requiredTierLabel: describeTier(required).label,
      tierChoices: isGM
        ? localizedTierChoices(override === undefined ? "" : override, { includeInherit: true })
        : []
    };
  }

  _buildBlockVisibility(creature, stats, show) {
    return {
      portrait: show("portrait"),
      name: show("name"),
      type: show("type"),
      ac: show("ac"),
      hp: show("hp"),
      cr: show("cr"),
      xp: show("xp"),
      speed: show("speed") && stats.speedEntries.length > 0,
      skills: show("skills") && stats.skillEntries.length > 0,
      senses: show("senses") && stats.senseEntries.length > 0,
      languages: show("languages") && creature.languages.length > 0,
      resistances: show("resistances") && creature.resistances.length > 0,
      immunities: show("immunities") && creature.immunities.length > 0,
      vulnerabilities: show("vulnerabilities") && creature.vulnerabilities.length > 0,
      conditionImmunities: show("conditionImmunities") && creature.conditionImmunities.length > 0
    };
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
    const skill = this.element.querySelector(".research-skill-select")?.value || undefined;
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

  /**
   * Posts what the sender knows, never more: an unknown creature goes out as
   * a silhouette without a name. A GM previewing as a player posts that view.
   */
  async _onSendToChat() {
    const actor = await resolveUuid(this.actorUuid);
    if (!actor) return;
    const data = getBestiaryData();
    const { effective } = this._resolveViewer();
    const context = selectEntryContext(data, this.actorUuid, effective, this.sectionId);
    const tier = effective.isGM ? GM_TIER : getUserTier(getBestiaryKnowledge(), effective.id, this.actorUuid);
    const blockTiers = getEntryBlockTiers(context?.entry);
    const knowsName = isBlockVisible("name", tier, blockTiers);
    const knowsPortrait = isBlockVisible("portrait", tier, blockTiers);
    const displayName = knowsName ? actor.name : localize("BESTIARY.Tier.UnknownName");

    const card = document.createElement("div");
    card.className = "bestiary-chat-card";

    const portrait = document.createElement("img");
    portrait.src = knowsPortrait ? actor.img : SILHOUETTE_PLACEHOLDER;
    portrait.alt = displayName;
    if (!knowsPortrait) portrait.className = "is-silhouette";

    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = displayName;

    const action = document.createElement("p");
    const link = document.createElement("a");
    link.href = "#";
    link.className = "bestiary-creature-link";
    link.dataset.bestiaryCreatureUuid = actor.uuid;
    const icon = document.createElement("i");
    icon.className = "fas fa-book-skull";
    link.append(icon, document.createTextNode(localize("BESTIARY.OpenBestiaryCard")));

    action.appendChild(link);
    copy.append(name, action);
    card.append(portrait, copy);

    await ChatMessage.create({
      speaker: knowsName ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({ user: game.user }),
      content: card.outerHTML,
      flags: { "bestiary-journal": { creatureUuid: actor.uuid } }
    });
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
    if (changed.data || ((changed.knowledge || changed.social) && concernsThis)) {
      await this._refreshPreservingScroll();
    }
  }
}
