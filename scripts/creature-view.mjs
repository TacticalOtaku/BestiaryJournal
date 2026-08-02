import {
  extractCreatureData, formatMod, formatCR,
  localizeDndLabel, formatDistanceUnit
} from "./helpers.mjs";
import {
  DISPLAY_BLOCKS,
  getCreatureCustomDisplay,
  getCreatureDetailLevel,
  isGmOnlyDetailToggle,
  setCreatureCustomDisplay,
  setCreatureDetailLevel
} from "./creature-display.mjs";
import { getCreatureCollections } from "./bestiary-domain.mjs";
import { getBestiaryData } from "./bestiary-store.mjs";
import {
  getFavoriteCreatureUuids,
  toggleFavoriteCreature
} from "./client-preferences.mjs";
import {
  getDnd5eConfig,
  localize,
  resolveUuid
} from "./foundry-runtime.mjs";
import { animateDisclosure, playApplicationEntrance } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ALL_BLOCK_KEYS = DISPLAY_BLOCKS.map(block => block.key);
const CUSTOM_DISPLAY_GROUPS = [
  { key: "core", label: "BESTIARY.CustomGroupCore", description: "BESTIARY.CustomGroupCoreHint", icon: "fa-id-card", blocks: ["abilities", ...ABILITY_KEYS, "skills"] },
  { key: "perception", label: "BESTIARY.CustomGroupPerception", description: "BESTIARY.CustomGroupPerceptionHint", icon: "fa-eye", blocks: ["senses", "languages"] },
  { key: "defense", label: "BESTIARY.CustomGroupDefense", description: "BESTIARY.CustomGroupDefenseHint", icon: "fa-shield-halved", blocks: ["resistances", "immunities", "vulnerabilities", "conditionImmunities"] },
  { key: "combat", label: "BESTIARY.CustomGroupCombat", description: "BESTIARY.CustomGroupCombatHint", icon: "fa-khanda", blocks: ["features", "actions", "bonusActions", "reactions", "legendaryActions"] },
  { key: "resources", label: "BESTIARY.CustomGroupResources", description: "BESTIARY.CustomGroupResourcesHint", icon: "fa-bag-shopping", blocks: ["spells", "inventory"] },
  { key: "lore", label: "BESTIARY.CustomGroupLore", description: "BESTIARY.CustomGroupLoreHint", icon: "fa-feather-pointed", blocks: ["biography"] }
];

const PRESETS = {
  minimal: [],
  combat: ["abilities", ...ABILITY_KEYS, "skills", "senses", "resistances", "immunities", "vulnerabilities", "conditionImmunities", "features", "actions", "bonusActions", "reactions", "legendaryActions"],
  full: [...ALL_BLOCK_KEYS]
};

export class BestiaryCreatureView extends HandlebarsApplicationMixin(ApplicationV2) {

  static _localDetailLevels = new Map();
  static _instances = new Set();

  static DEFAULT_OPTIONS = {
    id: "bestiary-creature-view-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-creature-view"],
    tag: "div",
    window: { title: "Creature", icon: "fas fa-dragon", resizable: true, minimizable: true },
    position: { width: 1100, height: 780 },
    actions: {
      setDetailLevel: function (event, target) { this._onSetDetailLevel(event, target); },
      openSheet: function () { this._onOpenSheet(); },
      expandItem: function (event, target) { this._onExpandItem(event, target); },
      toggleSection: function (event, target) { this._onToggleSection(event, target); },
      toggleCustomBlock: function (event, target) { this._onToggleCustomBlock(event, target); },
      setCustomPreset: function (event, target) { this._onSetCustomPreset(event, target); },
      selectAllBlocks: function () { this._setAllCustomBlocks(true); },
      clearAllBlocks: function () { this._setAllCustomBlocks(false); },
      resetCustomBlocks: function () { this._resetCustomBlocks(); },
      saveCustomBlocks: function () { this._saveCustomBlocks(); },
      cancelCustomBlocks: function () { this._cancelCustomBlocks(); },
      toggleFavorite: function () { this._onToggleFavorite(); },
      sendToChat: function () { this._onSendToChat(); },
      rollAbility: function (event, target) { this._onRollAbility(event, target); },
      useActivity: function (event, target) { this._onUseActivity(event, target); },
      scrollToSection: function (event, target) { this._onScrollToSection(event, target); }
    }
  };

  static PARTS = {
    creature: { template: "modules/bestiary-journal/templates/creature-view.hbs" }
  };

  constructor(options = {}) {
    const uniqueId = options.uniqueId
      ?? foundry.utils.randomID(16);
    super({ ...options, uniqueId });
    this.actorUuid = options.uuid;
    this._expandedItems = new Set();
    this._expandedSections = new Set(["features", "actions"]);
    this._customDraft = null;
    this._customDirty = false;
    BestiaryCreatureView._instances.add(this);
  }

  get detailLevel() {
    return getCreatureDetailLevel(this.actorUuid, BestiaryCreatureView._localDetailLevels);
  }

  get title() {
    return this._title ?? localize("BESTIARY.Creature");
  }

  _makeVisibilityChecker(level, customVisible) {
    const standard = new Set(["abilities", ...ABILITY_KEYS, "skills", "senses", "languages", "resistances", "immunities", "vulnerabilities", "conditionImmunities", "features"]);
    const expanded = new Set(ALL_BLOCK_KEYS);
    return blockKey => {
      if (level === "standard") return standard.has(blockKey);
      if (level === "expanded") return expanded.has(blockKey);
      if (level === "custom") return customVisible.includes(blockKey);
      return false;
    };
  }

  async _prepareContext() {
    const actor = await resolveUuid(this.actorUuid);
    if (!actor) return { error: true };

    const creature = this._decorateCreature(
      await extractCreatureData(actor, { enrich: true })
    );
    const display = this._prepareDisplayState();
    const stats = this._buildStatEntries(creature, display);
    const contentSections = this._buildContentSections(creature, display.show);
    const groupedDisplayBlocks = this._buildDisplayGroups(display.customVisible);
    const collections = getCreatureCollections(
      getBestiaryData(),
      this.actorUuid,
      display.isGM
    );
    const showBlock = this._buildBlockVisibility(creature, stats, display.show);

    return {
      creature,
      ...stats,
      contentSections,
      standardFeatures: this._markItems(creature.features.slice(0, 4), "features"),
      showAbilities: display.show("abilities") && stats.abilityEntries.length > 0,
      showBlock,
      showDefenses: showBlock.resistances || showBlock.immunities || showBlock.vulnerabilities || showBlock.conditionImmunities,
      collections,
      groupedDisplayBlocks,
      detailLevel: display.currentLevel,
      isMinimal: display.currentLevel === "minimal",
      isStandard: display.currentLevel === "standard",
      isExpanded: display.currentLevel === "expanded",
      isCustom: display.currentLevel === "custom",
      showStandardContent: ["standard", "expanded"].includes(display.currentLevel),
      showExpandedContent: display.currentLevel === "expanded",
      canToggleDetail: display.canToggleDetail,
      showDetailNav: display.canToggleDetail || display.isGM,
      isGM: display.isGM,
      isFavorite: display.favorites.has(this.actorUuid),
      customDirty: this._customDirty,
      error: false
    };
  }

  _decorateCreature(creature) {
    this._title = creature.name;
    const hpRatio = creature.hp.max > 0
      ? creature.hp.value / creature.hp.max
      : 0;
    return {
      ...creature,
      crFormatted: formatCR(creature.cr),
      typeLabel: [
        creature.size,
        creature.creatureType,
        creature.creatureSubtype ? `(${creature.creatureSubtype})` : ""
      ].filter(Boolean).join(" · "),
      hpPercent: Math.max(0, Math.min(100, Math.round(hpRatio * 100))),
      lowHp: creature.hp.max > 0 && hpRatio <= 0.25
    };
  }

  _prepareDisplayState() {
    const currentLevel = this.detailLevel;
    if (!this._customDraft) {
      this._customDraft = [...getCreatureCustomDisplay(this.actorUuid)];
    }
    const customVisible = this._customDraft;
    const isGM = game.user.isGM;
    return {
      currentLevel,
      customVisible,
      isGM,
      show: this._makeVisibilityChecker(currentLevel, customVisible),
      canToggleDetail: !isGmOnlyDetailToggle() || isGM,
      favorites: getFavoriteCreatureUuids()
    };
  }

  _buildStatEntries(creature, display) {
    const dnd5e = getDnd5eConfig();
    const abilityEntries = Object.entries(creature.abilities)
      .map(([key, ability]) => ({
        key,
        label: localizeDndLabel("AbilityAbbreviations", {}, key, dnd5e.abilities?.[key]?.abbreviation ?? ability.label),
        fullLabel: ability.label,
        value: ability.value,
        mod: formatMod(ability.mod),
        save: formatMod(ability.save),
        visible: display.show(key)
      }))
      .filter(ability => display.currentLevel !== "custom" || ability.visible);
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

  _markItems(list, sectionKey) {
    return list.map(item => {
      const itemKey = `${sectionKey}:${item.id ?? item.name}`;
      return {
        ...item,
        itemKey,
        expanded: this._expandedItems.has(itemKey),
        primaryActivity: item.activities?.[0] ?? null,
        hasActivity: (item.activities?.length ?? 0) > 0
      };
    });
  }

  _buildContentSections(creature, show) {
    const definitions = [
      ["features", "BESTIARY.Features", "fa-wand-magic-sparkles"],
      ["actions", "BESTIARY.Actions", "fa-khanda"],
      ["bonusActions", "BESTIARY.BonusActions", "fa-bolt"],
      ["reactions", "BESTIARY.Reactions", "fa-shield"],
      ["legendaryActions", "BESTIARY.LegendaryActions", "fa-crown"],
      ["spells", "BESTIARY.Spellcasting", "fa-wand-sparkles"],
      ["inventory", "BESTIARY.Inventory", "fa-bag-shopping"]
    ];
    const sections = definitions
      .filter(([key]) => show(key) && creature[key]?.length)
      .map(([key, label, icon]) => ({
        key,
        label: localize(label),
        icon,
        count: creature[key].length,
        expanded: this._expandedSections.has(key),
        items: this._markItems(creature[key], key),
        isSpells: key === "spells"
      }));
    if (show("biography") && creature.biography) {
      sections.push(this._buildBiographySection(creature.biography));
    }
    return sections;
  }

  _buildBiographySection(biography) {
    return {
      key: "biography",
      label: localize("BESTIARY.Biography"),
      icon: "fa-feather-pointed",
      count: null,
      expanded: this._expandedSections.has("biography"),
      isBiography: true,
      biography
    };
  }

  _buildDisplayGroups(customVisible) {
    const blocksByKey = new Map(DISPLAY_BLOCKS.map(block => [
      block.key,
      {
        ...block,
        localizedLabel: localize(block.label) || block.label,
        visible: customVisible.includes(block.key),
        isChild: !!block.group
      }
    ]));
    return CUSTOM_DISPLAY_GROUPS.map(group => {
      const blocks = group.blocks.map(key => blocksByKey.get(key)).filter(Boolean);
      const selectedCount = blocks.filter(block => block.visible).length;
      return {
        ...group,
        label: localize(group.label),
        description: localize(group.description),
        blocks,
        selectedCount,
        allSelected: selectedCount === blocks.length,
        partiallySelected: selectedCount > 0 && selectedCount < blocks.length
      };
    });
  }

  _buildBlockVisibility(creature, stats, show) {
    return {
      skills: show("skills") && stats.skillEntries.length > 0,
      senses: show("senses") && stats.senseEntries.length > 0,
      languages: show("languages") && creature.languages.length > 0,
      resistances: show("resistances") && creature.resistances.length > 0,
      immunities: show("immunities") && creature.immunities.length > 0,
      vulnerabilities: show("vulnerabilities") && creature.vulnerabilities.length > 0,
      conditionImmunities: show("conditionImmunities") && creature.conditionImmunities.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const checkbox of this.element.querySelectorAll(".custom-block-row input[data-block-key]")) {
      checkbox.addEventListener("change", event => this._onToggleCustomBlock(event, event.currentTarget));
    }
    playApplicationEntrance(this, ".creature-detail-view");
  }

  async _onSetDetailLevel(event, target) {
    const level = target.dataset.level;
    if (!level) return;
    await setCreatureDetailLevel(this.actorUuid, level, BestiaryCreatureView._localDetailLevels);
    if (level === "custom") {
      this._customDraft = [...getCreatureCustomDisplay(this.actorUuid)];
      this._customDirty = false;
    }
    await this._refreshPreservingScroll();
  }

  async _onOpenSheet() {
    if (!game.user.isGM) return;
    const actor = await resolveUuid(this.actorUuid);
    actor?.sheet.render(true);
  }

  async _onToggleFavorite() {
    await toggleFavoriteCreature(this.actorUuid);
    await this._refreshPreservingScroll();
  }

  async _onSendToChat() {
    const actor = await resolveUuid(this.actorUuid);
    if (!actor) return;

    const card = document.createElement("div");
    card.className = "bestiary-chat-card";

    const portrait = document.createElement("img");
    portrait.src = actor.img;
    portrait.alt = actor.name;

    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = actor.name;

    const action = document.createElement("p");
    const link = document.createElement("a");
    link.href = "#";
    link.className = "bestiary-creature-link";
    link.dataset.bestiaryCreatureUuid = actor.uuid;
    const icon = document.createElement("i");
    icon.className = "fas fa-book-skull";
    link.append(icon, document.createTextNode(game.i18n.localize("BESTIARY.OpenBestiaryCard")));

    action.appendChild(link);
    copy.append(name, action);
    card.append(portrait, copy);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: card.outerHTML,
      flags: { "bestiary-journal": { creatureUuid: actor.uuid } }
    });
  }

  async _onRollAbility(event, target) {
    const actor = await resolveUuid(this.actorUuid);
    const ability = target.dataset.ability;
    if (!actor || !ability) return;
    if (typeof actor.rollAbilityCheck === "function") await actor.rollAbilityCheck(ability, { event });
    else if (typeof actor.system?.abilities?.[ability]?.roll === "function") await actor.system.abilities[ability].roll({ event });
  }

  async _onUseActivity(event, target) {
    event.stopPropagation();
    const actor = await resolveUuid(this.actorUuid);
    const item = actor?.items.get(target.dataset.itemId);
    if (!item) return;
    const activities = item.system?.activities;
    const activity = activities?.get?.(target.dataset.activityId) ?? activities?.[target.dataset.activityId];
    if (typeof activity?.use === "function") await activity.use({ event });
    else if (typeof item.use === "function") await item.use({ event });
  }

  _onExpandItem(event, target) {
    if (event.target.closest("[data-action='useActivity']")) return;
    const itemElement = target.closest("[data-item-key]");
    const itemKey = itemElement?.dataset.itemKey;
    if (!itemKey) return;
    this._expandedItems.has(itemKey) ? this._expandedItems.delete(itemKey) : this._expandedItems.add(itemKey);
    this._toggleItemElement(itemElement, this._expandedItems.has(itemKey));
  }

  _onToggleSection(event, target) {
    const sectionKey = target.dataset.sectionKey;
    if (!sectionKey) return;
    this._expandedSections.has(sectionKey) ? this._expandedSections.delete(sectionKey) : this._expandedSections.add(sectionKey);
    this._toggleSectionElement(sectionKey, this._expandedSections.has(sectionKey));
  }

  _onScrollToSection(event, target) {
    const section = this.element.querySelector(`[data-content-section="${target.dataset.sectionKey}"]`);
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  _onToggleCustomBlock(event, target) {
    if (!game.user.isGM) return;
    const blockKey = target.dataset.blockKey;
    if (!blockKey) return;
    const draft = new Set(this._customDraft ?? []);
    target.checked ? draft.add(blockKey) : draft.delete(blockKey);
    if (blockKey === "abilities") {
      for (const key of ABILITY_KEYS) target.checked ? draft.add(key) : draft.delete(key);
    } else if (ABILITY_KEYS.includes(blockKey) && target.checked) draft.add("abilities");
    this._customDraft = [...draft];
    this._customDirty = true;
    this._syncCustomDraftUI();
  }

  _syncCustomDraftUI() {
    const draft = new Set(this._customDraft ?? []);
    for (const checkbox of this.element.querySelectorAll("input[data-block-key]")) {
      checkbox.checked = draft.has(checkbox.dataset.blockKey);
    }
    for (const group of this.element.querySelectorAll(".custom-block-group[data-group-key]")) {
      const selected = [...group.querySelectorAll("input[data-block-key]")].filter(input => input.checked).length;
      const count = group.querySelector(".custom-group-count");
      if (count) count.textContent = `${selected} / ${group.querySelectorAll("input[data-block-key]").length}`;
      const preview = this.element.querySelector(`[data-preview-group="${group.dataset.groupKey}"]`);
      preview?.classList.toggle("is-empty", selected === 0);
      const previewCount = preview?.querySelector("strong");
      if (previewCount) previewCount.textContent = String(selected);
    }
    this.element.classList.toggle("has-unsaved-changes", this._customDirty);
    this.element.querySelector(".custom-config-footer")?.classList.toggle("is-visible", this._customDirty);
  }

  _onSetCustomPreset(event, target) {
    const preset = PRESETS[target.dataset.preset];
    if (!preset) return;
    this._customDraft = [...preset];
    this._customDirty = true;
    this._refreshPreservingScroll();
  }

  _setAllCustomBlocks(selected) {
    this._customDraft = selected ? [...ALL_BLOCK_KEYS] : [];
    this._customDirty = true;
    this._refreshPreservingScroll();
  }

  _resetCustomBlocks() {
    this._customDraft = [...getCreatureCustomDisplay(this.actorUuid)];
    this._customDirty = false;
    this._refreshPreservingScroll();
  }

  async _saveCustomBlocks() {
    if (!game.user.isGM) return;
    await setCreatureCustomDisplay(this.actorUuid, this._customDraft ?? []);
    this._customDirty = false;
    ui.notifications.info(game.i18n.localize("BESTIARY.ViewSaved"));
    await this._refreshPreservingScroll();
  }

  _cancelCustomBlocks() {
    this._customDraft = [...getCreatureCustomDisplay(this.actorUuid)];
    this._customDirty = false;
    this._refreshPreservingScroll();
  }

  async _refreshPreservingScroll() {
    const scrollContainer = this.element?.querySelector(".creature-detail-wrapper");
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    await this.render();
    const next = this.element?.querySelector(".creature-detail-wrapper");
    if (next) next.scrollTop = scrollTop;
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

  async refreshFromExternalUpdate() {
    if (!this._customDirty) this._customDraft = null;
    await this._refreshPreservingScroll();
  }

  async close(options) {
    if (this._customDirty && !options?.force) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("BESTIARY.UnsavedChanges") },
        content: `<p>${game.i18n.localize("BESTIARY.ConfirmDiscardChanges")}</p>`,
        yes: { default: false }
      });
      if (!confirmed) return this;
    }
    BestiaryCreatureView._instances.delete(this);
    return super.close(options);
  }
}
