import {
  MAX_CUSTOM_TIERS,
  RESEARCH_TIERS,
  TIER_COLORS,
  TIER_ICONS,
  defaultBlockTiers,
  defaultResearchTiers,
  maxResearchTier,
  normalizeResearchTiers,
  planTierRemapping,
  remapTierMap,
  remapTierValue,
  resolveBlockTiers,
} from "../core/research-model.js";
import { saveResearchTierConfig } from "../foundry/bestiary-store.js";
import {
  buildTierMatrix,
  getWorldBlockTiers,
  getWorldResearchTiers,
  translateTierText,
} from "../foundry/creature-display.js";
import { localize } from "../foundry/foundry-runtime.js";
import { activateTablistKeyboard, playApplicationEntrance } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "bestiary-journal";
const DEFAULT_BY_ID = new Map(RESEARCH_TIERS.map((tier) => [tier.id, tier]));

/**
 * World research configuration: manage the ordered tier ladder (names, hints,
 * icons, theme colors, insert/reorder/delete) and the block reveal thresholds.
 */
export class BestiaryTierSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bestiary-tier-settings",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-tier-settings"],
    tag: "form",
    window: { title: "BESTIARY.Tier.WorldTitle", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 820, height: 740 },
    form: {
      handler: function (event, form, formData) {
        return this._onFormSubmit(event, form, formData);
      },
      submitOnChange: false,
      closeOnSubmit: true,
    },
    actions: {
      setTab: function (event, target) {
        this._onSetTab(event, target);
      },
      restoreDefaults: function () {
        this._onRestoreDefaults();
      },
      addTier: function () {
        this._onInsertTier(this._tiersDraft.length - 1);
      },
      insertTier: function (event, target) {
        this._onInsertTier(Number(target.dataset.index));
      },
      moveTierUp: function (event, target) {
        const index = Number(target.dataset.index);
        this._onMoveTier(index, index - 1);
      },
      moveTierDown: function (event, target) {
        const index = Number(target.dataset.index);
        this._onMoveTier(index, index + 1);
      },
      removeTier: function (event, target) {
        this._onRemoveTier(Number(target.dataset.index));
      },
    },
  };

  static PARTS = {
    form: {
      template: "modules/bestiary-journal/templates/tier-settings.hbs",
      scrollable: [".tier-settings-body"],
    },
  };

  constructor(options = {}) {
    super(options);
    this._tab = "tiers";
    this._tiersDraft = null;
    this._blockDraft = null;
    this._encounterRevealTier = null;
  }

  _ensureDrafts() {
    if (!this._tiersDraft) this._tiersDraft = getWorldResearchTiers();
    const maxTier = maxResearchTier(this._tiersDraft);
    if (!this._blockDraft) this._blockDraft = resolveBlockTiers(getWorldBlockTiers(), null, maxTier);
    if (this._encounterRevealTier === null) {
      const configured = Number(game.settings.get(MODULE_ID, "encounterRevealTier") ?? 1);
      this._encounterRevealTier = Math.max(
        1,
        Math.min(maxTier, Number.isFinite(configured) ? configured : 1),
      );
    }
  }

  async _prepareContext() {
    this._ensureDrafts();
    const tiers = normalizeResearchTiers(this._tiersDraft);
    const maxTier = maxResearchTier(tiers);
    const canAdd = tiers.length < MAX_CUSTOM_TIERS;
    const canRemove = tiers.length > 2;

    return {
      tab: this._tab,
      isTiersTab: this._tab === "tiers",
      isBlocksTab: this._tab === "blocks",
      tierCount: tiers.length,
      canAdd,
      tierRows: tiers.map((tier, index) => ({
        ...tier,
        index,
        isBase: index === 0,
        displayLabel: translateTierText(tier.label),
        displayHint: translateTierText(tier.hint),
        canMoveUp: index > 1,
        canMoveDown: index >= 1 && index < tiers.length - 1,
        canRemove: index >= 1 && canRemove,
        canInsertBelow: canAdd,
        iconOptions: TIER_ICONS.map((icon) => ({
          value: icon,
          label: localize(`BESTIARY.Tier.Icon.${icon}`),
          selected: tier.icon === icon,
        })),
        colorOptions: TIER_COLORS.map((color) => ({
          value: color,
          label: localize(`BESTIARY.Tier.Color.${color}`),
          selected: tier.color === color,
        })),
      })),
      encounterOptions: tiers
        .filter((tier) => tier.value > 0)
        .map((tier) => ({
          value: tier.value,
          label: `${tier.value}. ${translateTierText(tier.label)}`,
          selected: tier.value === this._encounterRevealTier,
        })),
      // Highlight what this world changed against the built-in block defaults.
      groups: buildTierMatrix(
        this._blockDraft,
        this._blockDraft,
        defaultBlockTiers(maxTier),
        () => "",
        tiers,
      ),
      hint: localize("BESTIARY.Tier.WorldHint"),
      levelsHint: localize("BESTIARY.Tier.LevelsHint"),
      maxLevelsNotice: canAdd
        ? ""
        : game.i18n.format("BESTIARY.Tier.MaxLevelsReached", { count: MAX_CUSTOM_TIERS }),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    activateTablistKeyboard(this.element);

    for (const input of this.element.querySelectorAll("[data-tier-index][data-tier-field]")) {
      const eventName = input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(eventName, (event) => {
        const index = Number(event.currentTarget.dataset.tierIndex);
        const field = event.currentTarget.dataset.tierField;
        this._updateTierField(index, field, event.currentTarget.value);
      });
    }

    this.element.querySelector(".tier-encounter-select")?.addEventListener("change", (event) => {
      this._encounterRevealTier = Number(event.currentTarget.value);
    });

    for (const select of this.element.querySelectorAll("[data-block-tier]")) {
      select.addEventListener("change", (event) => {
        this._blockDraft[event.currentTarget.dataset.blockTier] = Number(event.currentTarget.value);
      });
    }
    playApplicationEntrance(this, ".tier-settings-shell");
  }

  _updateTierField(index, field, value) {
    const tier = this._tiersDraft?.[index];
    if (!tier) return;
    if (field === "label" || field === "hint") {
      const defaults = DEFAULT_BY_ID.get(tier.id);
      const defaultText = defaults ? translateTierText(defaults[field]) : null;
      if (defaults && value.trim() === defaultText) {
        tier[field] = defaults[field];
      } else {
        tier[field] = value;
      }
      if (field === "label") this._syncEncounterOptionLabel(index);
      return;
    }
    if (field === "icon" || field === "color") {
      tier[field] = value;
      if (field === "color") tier.key = DEFAULT_BY_ID.has(tier.id) ? tier.id : value;
      this._syncTierPreview(index, tier);
    }
  }

  _syncTierPreview(index, tier) {
    const row = this.element?.querySelector(`.tier-def-row[data-tier-row="${index}"]`);
    if (!row) return;
    row.dataset.tierColor = tier.color;
    const icon = row.querySelector(".tier-def-badge i");
    if (icon) icon.className = `fa-solid ${tier.icon}`;
  }

  _syncEncounterOptionLabel(index) {
    const option = this.element?.querySelector(`.tier-encounter-select option[value="${index}"]`);
    const tier = this._tiersDraft?.[index];
    if (option && tier) option.textContent = `${index}. ${translateTierText(tier.label) || tier.label}`;
  }

  _applyTierDraftChange(nextRaw) {
    const prev = normalizeResearchTiers(this._tiersDraft);
    const next = normalizeResearchTiers(nextRaw);
    const { valueMap, maxNewTier } = planTierRemapping(prev, next);
    this._tiersDraft = next;
    this._blockDraft = remapTierMap(this._blockDraft, valueMap, maxNewTier);
    this._encounterRevealTier = Math.max(
      1,
      Math.min(maxNewTier, remapTierValue(this._encounterRevealTier ?? 1, valueMap, maxNewTier) || 1),
    );
    this.render();
  }

  async _onSetTab(event, target) {
    const tab = target.dataset.tab;
    if (!["tiers", "blocks"].includes(tab) || tab === this._tab) return;
    const isKeyboard = event?.detail === 0;
    this._tab = tab;
    await this.render();
    if (isKeyboard) this.element?.querySelector(`.tier-settings-tabs [data-tab="${tab}"]`)?.focus();
  }

  _onInsertTier(afterIndex) {
    this._ensureDrafts();
    if (this._tiersDraft.length >= MAX_CUSTOM_TIERS) return;
    const index = Math.max(0, Math.min(this._tiersDraft.length - 1, afterIndex));
    const colorIndex = this._tiersDraft.length % TIER_COLORS.length;
    const color = TIER_COLORS[colorIndex];
    const icon = TIER_ICONS[(this._tiersDraft.length + 3) % TIER_ICONS.length];
    const created = {
      id: `custom_${foundry.utils.randomID(8)}`,
      key: color,
      label: localize("BESTIARY.Tier.CustomNewName"),
      hint: "",
      icon,
      color,
    };
    const next = [...this._tiersDraft];
    next.splice(index + 1, 0, created);
    this._applyTierDraftChange(next);
  }

  _onMoveTier(fromIndex, toIndex) {
    this._ensureDrafts();
    if (fromIndex < 1 || toIndex < 1 || toIndex >= this._tiersDraft.length) return;
    const next = [...this._tiersDraft];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    this._applyTierDraftChange(next);
  }

  _onRemoveTier(index) {
    this._ensureDrafts();
    if (index < 1 || this._tiersDraft.length <= 2) return;
    const next = this._tiersDraft.filter((_, idx) => idx !== index);
    this._applyTierDraftChange(next);
  }

  _onRestoreDefaults() {
    this._tiersDraft = defaultResearchTiers();
    this._blockDraft = defaultBlockTiers();
    this._encounterRevealTier = 1;
    this.render();
  }

  async _onFormSubmit() {
    this._ensureDrafts();
    await saveResearchTierConfig({
      tiers: this._tiersDraft,
      blockTiers: this._blockDraft,
      encounterRevealTier: this._encounterRevealTier,
    });
    ui.notifications.info(localize("BESTIARY.Tier.WorldSaved"));
  }
}
