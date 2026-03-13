import {
  extractCreatureData, formatMod, formatCR, isGmOnlyDetailToggle,
  getCreatureDetailLevel, setCreatureDetailLevel,
  getCreatureCustomDisplay, setCreatureCustomDisplay, DISPLAY_BLOCKS
} from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiaryCreatureView extends HandlebarsApplicationMixin(ApplicationV2) {

  static _localDetailLevels = new Map();

  static DEFAULT_OPTIONS = {
    id: "bestiary-creature-view",
    classes: ["bestiary-journal", "bestiary-creature-view"],
    tag: "div",
    window: {
      title: "Creature",
      icon: "fas fa-dragon",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 740,
      height: 680
    },
    actions: {
      setDetailLevel: function (e, t) { this._onSetDetailLevel(e, t); },
      openSheet: function (e, t) { this._onOpenSheet(e, t); },
      expandItem: function (e, t) { this._onExpandItem(e, t); },
      toggleCustomBlock: function (e, t) { this._onToggleCustomBlock(e, t); }
    }
  };

  static PARTS = {
    creature: {
      template: "modules/bestiary-journal/templates/creature-view.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this.actorUuid = options.uuid;
    this._expandedItems = new Set();
  }

  get detailLevel() {
    return getCreatureDetailLevel(this.actorUuid, BestiaryCreatureView._localDetailLevels);
  }

  get title() {
    return this._title ?? "Creature";
  }

  /**
   * Determine which content blocks are visible for a given detail level.
   * @param {string} level - The detail level.
   * @param {string[]} customVisible - Custom visible block keys (for "custom" mode).
   * @returns {Function} A function (blockKey) => boolean
   */
  _makeVisibilityChecker(level, customVisible) {
    // Standard blocks — combat-focused info without lore
    const STANDARD_BLOCKS = new Set([
      "abilities", "str", "dex", "con", "int", "wis", "cha",
      "skills", "senses", "languages",
      "resistances", "immunities", "vulnerabilities", "conditionImmunities",
      "actions", "bonusActions", "reactions"
    ]);

    // Expanded adds features, legendary, spells, biography
    const EXPANDED_ADDITIONS = new Set([
      "features", "legendaryActions", "spells", "biography"
    ]);

    return (blockKey) => {
      switch (level) {
        case "minimal":
          return false;
        case "standard":
          return STANDARD_BLOCKS.has(blockKey);
        case "expanded":
          return STANDARD_BLOCKS.has(blockKey) || EXPANDED_ADDITIONS.has(blockKey);
        case "custom":
          return customVisible.includes(blockKey);
        default:
          return false;
      }
    };
  }

  async _prepareContext(options) {
    const actor = await fromUuid(this.actorUuid);
    if (!actor) return { error: true };

    const c = await extractCreatureData(actor, { enrich: true });
    this._title = c.name;

    c.crFormatted = formatCR(c.cr);
    c.typeLabel = [c.size, c.creatureType, c.creatureSubtype ? `(${c.creatureSubtype})` : ""]
      .filter(Boolean).join(" ");

    const abilityEntries = Object.entries(c.abilities).map(([key, abl]) => ({
      key, label: abl.label, value: abl.value,
      mod: formatMod(abl.mod), save: formatMod(abl.save),
      isHighlight: abl.value >= 16
    }));

    const skillEntries = Object.entries(c.skills).map(([key, s]) => ({
      label: s.label, total: formatMod(s.total)
    }));

    const speedEntries = Object.entries(c.speeds)
      .filter(([k]) => k !== "hover")
      .map(([key, val]) => ({ label: key === "walk" ? "" : key, value: `${val} ${c.speedUnits}` }));

    const senseEntries = Object.entries(c.senses)
      .filter(([k]) => k !== "special")
      .map(([key, val]) => ({ label: key, value: typeof val === "number" ? `${val} ${c.senseUnits}` : val }));
    if (c.senses.special) senseEntries.push({ label: "special", value: c.senses.special });

    const markExpanded = (list) => list.map((item, i) => ({
      ...item, _idx: i, _expanded: this._expandedItems.has(item.name)
    }));

    const currentLevel = this.detailLevel;
    const isGM = game.user.isGM;
    const gmOnlyToggle = isGmOnlyDetailToggle();
    const canToggleDetail = !gmOnlyToggle || isGM;

    // Custom display config
    const customVisible = getCreatureCustomDisplay(this.actorUuid);
    const show = this._makeVisibilityChecker(currentLevel, customVisible);

    // Not minimal — show extended content area
    const isNotMinimal = currentLevel !== "minimal";

    // Filter ability entries for custom mode (individual ability toggle)
    const filteredAbilityEntries = isNotMinimal
      ? abilityEntries.filter(a => show(a.key))
      : [];
    const showAbilitiesSection = show("abilities") && filteredAbilityEntries.length > 0;

    // Build display blocks config for custom mode UI
    const displayBlocksConfig = DISPLAY_BLOCKS.map(b => ({
      ...b,
      localizedLabel: game.i18n.localize(b.label) || b.label,
      visible: customVisible.includes(b.key),
      isChild: !!b.group
    }));

    const ctx = {
      creature: c,
      abilityEntries: filteredAbilityEntries,
      showAbilitiesSection,
      skillEntries, speedEntries, senseEntries,
      features: markExpanded(c.features),
      actions: markExpanded(c.actions),
      bonusActions: markExpanded(c.bonusActions),
      reactions: markExpanded(c.reactions),
      legendaryActions: markExpanded(c.legendaryActions),
      spells: c.spells,
      detailLevel: currentLevel,
      isMinimal: !isNotMinimal,
      isNotMinimal,
      isStandard: currentLevel === "standard",
      isExpanded: currentLevel === "expanded",
      isCustom: currentLevel === "custom",
      showBlock: {
        skills: show("skills") && skillEntries.length > 0,
        senses: show("senses") && senseEntries.length > 0,
        languages: show("languages") && c.languages.length > 0,
        resistances: show("resistances") && c.resistances.length > 0,
        immunities: show("immunities") && c.immunities.length > 0,
        vulnerabilities: show("vulnerabilities") && c.vulnerabilities.length > 0,
        conditionImmunities: show("conditionImmunities") && c.conditionImmunities.length > 0,
        features: show("features") && c.features.length > 0,
        actions: show("actions") && c.actions.length > 0,
        bonusActions: show("bonusActions") && c.bonusActions.length > 0,
        reactions: show("reactions") && c.reactions.length > 0,
        legendaryActions: show("legendaryActions") && c.legendaryActions.length > 0,
        spells: show("spells") && c.spells.length > 0,
        biography: show("biography") && !!c.biography
      },
      canToggleDetail,
      isGM,
      displayBlocksConfig,
      error: false
    };

    console.log(`Bestiary | Detail level for ${c.name}: "${currentLevel}", isNotMinimal=${isNotMinimal}`);
    return ctx;
  }

  // ── Register listeners after render for checkbox change events ──
  _onRender(context, options) {
    super._onRender(context, options);

    // Foundry actions system handles clicks, but checkboxes fire "change" events.
    // We need to manually bind change handlers for custom block toggles.
    const checkboxes = this.element.querySelectorAll('.custom-block-toggle input[type="checkbox"]');
    for (const cb of checkboxes) {
      cb.addEventListener("change", (event) => {
        this._onToggleCustomBlock(event, event.currentTarget);
      });
    }
  }

  async _onSetDetailLevel(event, target) {
    const level = target.dataset.level;
    if (!level) return;
    console.log(`Bestiary | Setting detail level to: "${level}" for ${this.actorUuid}`);
    await setCreatureDetailLevel(this.actorUuid, level, BestiaryCreatureView._localDetailLevels);
    this.render();
  }

  async _onOpenSheet(event, target) {
    const actor = await fromUuid(this.actorUuid);
    if (actor) actor.sheet.render(true);
  }

  _onExpandItem(event, target) {
    const name = target.closest("[data-item-name]")?.dataset.itemName;
    if (!name) return;
    if (this._expandedItems.has(name)) this._expandedItems.delete(name);
    else this._expandedItems.add(name);
    this.render();
  }

  async _onToggleCustomBlock(event, target) {
    if (!game.user.isGM) return;
    const blockKey = target.dataset?.blockKey ?? target.getAttribute("data-block-key");
    if (!blockKey) return;

    const current = getCreatureCustomDisplay(this.actorUuid);
    let updated;
    if (current.includes(blockKey)) {
      updated = current.filter(k => k !== blockKey);
      // Toggling off "abilities" parent also removes individual abilities
      if (blockKey === "abilities") {
        updated = updated.filter(k => !["str", "dex", "con", "int", "wis", "cha"].includes(k));
      }
    } else {
      updated = [...current, blockKey];
      // Toggling on "abilities" parent also adds individual abilities
      if (blockKey === "abilities") {
        for (const a of ["str", "dex", "con", "int", "wis", "cha"]) {
          if (!updated.includes(a)) updated.push(a);
        }
      }
    }

    await setCreatureCustomDisplay(this.actorUuid, updated);
    this.render();
  }
}
