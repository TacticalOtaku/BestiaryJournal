import {
  extractCreatureData, formatMod, formatCR, isGmOnlyDetailToggle,
  getCreatureDetailLevel, setCreatureDetailLevel,
  getCreatureCustomDisplay, setCreatureCustomDisplay, DISPLAY_BLOCKS,
  getBestiaryData, localizeDndLabel, formatDistanceUnit
} from "./helpers.mjs";
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
    id: "bestiary-creature-view",
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
    super(options);
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
    return this._title ?? game.i18n.localize("BESTIARY.Creature");
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
    const actor = await fromUuid(this.actorUuid);
    if (!actor) return { error: true };

    const creature = await extractCreatureData(actor, { enrich: true });
    this._title = creature.name;
    creature.crFormatted = formatCR(creature.cr);
    creature.typeLabel = [creature.size, creature.creatureType, creature.creatureSubtype ? `(${creature.creatureSubtype})` : ""].filter(Boolean).join(" · ");
    creature.hpPercent = creature.hp.max > 0 ? Math.max(0, Math.min(100, Math.round((creature.hp.value / creature.hp.max) * 100))) : 0;
    creature.lowHp = creature.hp.max > 0 && creature.hp.value / creature.hp.max <= 0.25;

    const currentLevel = this.detailLevel;
    const savedCustom = getCreatureCustomDisplay(this.actorUuid);
    if (!this._customDraft) this._customDraft = [...savedCustom];
    const customVisible = this._customDraft;
    const show = this._makeVisibilityChecker(currentLevel, customVisible);
    const isGM = game.user.isGM;
    const canToggleDetail = !isGmOnlyDetailToggle() || isGM;
    const favorites = new Set(game.settings.get("bestiary-journal", "favoriteCreatures") ?? []);

    const abilityEntries = Object.entries(creature.abilities).map(([key, ability]) => ({
      key,
      label: localizeDndLabel("AbilityAbbreviations", {}, key, CONFIG.DND5E.abilities?.[key]?.abbreviation ?? ability.label),
      fullLabel: ability.label,
      value: ability.value,
      mod: formatMod(ability.mod),
      save: formatMod(ability.save),
      visible: show(key)
    })).filter(ability => currentLevel !== "custom" || ability.visible);

    const skillEntries = Object.values(creature.skills).map(skill => ({ label: skill.label, total: formatMod(skill.total) }));
    const speedUnit = formatDistanceUnit(creature.speedUnits);
    const senseUnit = formatDistanceUnit(creature.senseUnits);
    const speedEntries = Object.entries(creature.speeds).map(([key, value]) => ({
      label: game.i18n.localize(`BESTIARY.Speed${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      value: `${value} ${speedUnit}`
    }));
    const senseEntries = Object.entries(creature.senses).map(([key, value]) => ({
      label: key === "special"
        ? game.i18n.localize("BESTIARY.SpecialSenses")
        : localizeDndLabel("Senses", CONFIG.DND5E.senses, key, key),
      value: typeof value === "number" ? `${value} ${senseUnit}` : value
    }));

    const markItems = (list, sectionKey) => list.map(item => {
      const itemKey = `${sectionKey}:${item.id ?? item.name}`;
      return {
        ...item,
        itemKey,
        expanded: this._expandedItems.has(itemKey),
        primaryActivity: item.activities?.[0] ?? null,
        hasActivity: (item.activities?.length ?? 0) > 0
      };
    });

    const sectionDefinitions = [
      ["features", "BESTIARY.Features", "fa-wand-magic-sparkles", creature.features],
      ["actions", "BESTIARY.Actions", "fa-khanda", creature.actions],
      ["bonusActions", "BESTIARY.BonusActions", "fa-bolt", creature.bonusActions],
      ["reactions", "BESTIARY.Reactions", "fa-shield", creature.reactions],
      ["legendaryActions", "BESTIARY.LegendaryActions", "fa-crown", creature.legendaryActions],
      ["spells", "BESTIARY.Spellcasting", "fa-wand-sparkles", creature.spells],
      ["inventory", "BESTIARY.Inventory", "fa-bag-shopping", creature.inventory]
    ];
    const contentSections = sectionDefinitions
      .filter(([key, , , items]) => show(key) && (items?.length ?? 0) > 0)
      .map(([key, label, icon, items]) => ({
        key,
        label: game.i18n.localize(label),
        icon,
        count: items.length,
        expanded: this._expandedSections.has(key),
        items: markItems(items, key),
        isSpells: key === "spells"
      }));
    if (show("biography") && creature.biography) {
      contentSections.push({
        key: "biography",
        label: game.i18n.localize("BESTIARY.Biography"),
        icon: "fa-feather-pointed",
        count: null,
        expanded: this._expandedSections.has("biography"),
        isBiography: true,
        biography: creature.biography
      });
    }

    const displayBlocksConfig = DISPLAY_BLOCKS.map(block => ({
      ...block,
      localizedLabel: game.i18n.localize(block.label) || block.label,
      visible: customVisible.includes(block.key),
      isChild: !!block.group
    }));
    const groupedDisplayBlocks = CUSTOM_DISPLAY_GROUPS.map(group => {
      const blocks = group.blocks.map(key => displayBlocksConfig.find(block => block.key === key)).filter(Boolean);
      const selectedCount = blocks.filter(block => block.visible).length;
      return {
        ...group,
        label: game.i18n.localize(group.label),
        description: game.i18n.localize(group.description),
        blocks,
        selectedCount,
        allSelected: selectedCount === blocks.length,
        partiallySelected: selectedCount > 0 && selectedCount < blocks.length
      };
    });

    const collections = getBestiaryData().sections
      .filter(section => section.creatures?.some(entry => entry.uuid === this.actorUuid))
      .map(section => section.name);
    const showBlock = {
      skills: show("skills") && skillEntries.length > 0,
      senses: show("senses") && senseEntries.length > 0,
      languages: show("languages") && creature.languages.length > 0,
      resistances: show("resistances") && creature.resistances.length > 0,
      immunities: show("immunities") && creature.immunities.length > 0,
      vulnerabilities: show("vulnerabilities") && creature.vulnerabilities.length > 0,
      conditionImmunities: show("conditionImmunities") && creature.conditionImmunities.length > 0
    };

    return {
      creature,
      abilityEntries,
      skillEntries,
      speedEntries,
      senseEntries,
      contentSections,
      standardFeatures: markItems(creature.features.slice(0, 4), "features"),
      showAbilities: show("abilities") && abilityEntries.length > 0,
      showBlock,
      showDefenses: showBlock.resistances || showBlock.immunities || showBlock.vulnerabilities || showBlock.conditionImmunities,
      collections,
      groupedDisplayBlocks,
      detailLevel: currentLevel,
      isMinimal: currentLevel === "minimal",
      isStandard: currentLevel === "standard",
      isExpanded: currentLevel === "expanded",
      isCustom: currentLevel === "custom",
      showStandardContent: currentLevel === "standard" || currentLevel === "expanded",
      showExpandedContent: currentLevel === "expanded",
      canToggleDetail,
      showDetailNav: canToggleDetail || isGM,
      isGM,
      isFavorite: favorites.has(this.actorUuid),
      customDirty: this._customDirty,
      error: false
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
    const actor = await fromUuid(this.actorUuid);
    actor?.sheet.render(true);
  }

  async _onToggleFavorite() {
    const favorites = new Set(game.settings.get("bestiary-journal", "favoriteCreatures") ?? []);
    favorites.has(this.actorUuid) ? favorites.delete(this.actorUuid) : favorites.add(this.actorUuid);
    await game.settings.set("bestiary-journal", "favoriteCreatures", [...favorites]);
    await this._refreshPreservingScroll();
  }

  async _onSendToChat() {
    const actor = await fromUuid(this.actorUuid);
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
    const actor = await fromUuid(this.actorUuid);
    const ability = target.dataset.ability;
    if (!actor || !ability) return;
    if (typeof actor.rollAbilityCheck === "function") await actor.rollAbilityCheck(ability, { event });
    else if (typeof actor.system?.abilities?.[ability]?.roll === "function") await actor.system.abilities[ability].roll({ event });
  }

  async _onUseActivity(event, target) {
    event.stopPropagation();
    const actor = await fromUuid(this.actorUuid);
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
