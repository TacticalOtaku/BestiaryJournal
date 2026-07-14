import { getBestiaryData, setBestiaryData, extractCreatureData, formatCR, formatDistanceUnit } from "./helpers.mjs";
import { BestiaryCreatureView } from "./creature-view.mjs";
import { playApplicationEntrance } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiarySectionView extends HandlebarsApplicationMixin(ApplicationV2) {

  static _instances = new Set();

  static DEFAULT_OPTIONS = {
    id: "bestiary-section-view",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-section-view"],
    tag: "div",
    window: { title: "BESTIARY.Title", icon: "fas fa-book-open", resizable: true, minimizable: true },
    position: { width: 1240, height: 780 },
    actions: {
      goBack: function () { this._onGoBack(); },
      switchSection: function (event, target) { this._onSwitchSection(event, target); },
      toggleView: function (event, target) { this._onToggleView(event, target); },
      selectCreature: function (event, target) { this._onSelectCreature(event, target); },
      openCreature: function (event, target) { this._onOpenCreature(event, target); },
      removeCreature: function (event, target) { this._onRemoveCreature(event, target); },
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      toggleCreatureVisibility: function (event, target) { this._onToggleCreatureVisibility(event, target); },
      toggleFilters: function () { this._toggleFilters(); },
      closePreview: function () { this._closePreview(); },
      resetFilters: function () { this._resetFilters(); },
      showAddHint: function () { ui.notifications.info(game.i18n.localize("BESTIARY.AddCreatureHint")); }
    }
  };

  static PARTS = {
    section: { template: "modules/bestiary-journal/templates/section-view.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.sectionId = options.sectionId;
    this._viewMode = game.settings.get("bestiary-journal", "libraryViewMode") || "grid";
    this._sortMode = "name-asc";
    this._searchQuery = "";
    this._filtersOpen = false;
    this._selectedUuid = null;
    this._typeFilters = new Set();
    this._sizeFilters = new Set();
    this._crMin = "";
    this._crMax = "";
    BestiarySectionView._instances.add(this);
  }

  get title() {
    return getBestiaryData().sections.find(section => section.id === this.sectionId)?.name
      || game.i18n.localize("BESTIARY.Title");
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    const isGM = game.user.isGM;
    const favoriteUuids = new Set(game.settings.get("bestiary-journal", "favoriteCreatures") ?? []);
    const allSections = data.sections
      .filter(item => isGM || !item.hidden)
      .map(item => ({ ...item, creatureCount: (item.creatures ?? []).filter(entry => isGM || !entry.hidden).length }));

    if (!section) return { creatures: [], allSections, isGM, isEmpty: true };

    const creatures = [];
    for (const entry of section.creatures ?? []) {
      if (!isGM && entry.hidden) continue;
      try {
        const actor = await fromUuid(entry.uuid);
        if (!actor) continue;
        const creature = await extractCreatureData(actor);
        const typeLabel = [creature.size, creature.creatureType].filter(Boolean).join(" · ");
        creatures.push({
          ...creature,
          crFormatted: formatCR(creature.cr),
          typeLabel,
          isHidden: !!entry.hidden,
          isFavorite: favoriteUuids.has(entry.uuid),
          searchText: [creature.name, creature.creatureType, creature.size, section.name].join(" ").toLocaleLowerCase(),
          speedLabel: this._formatSpeed(creature),
          hpPercent: creature.hp.max > 0 ? Math.max(0, Math.min(100, Math.round((creature.hp.value / creature.hp.max) * 100))) : 0
        });
      } catch (error) {
        console.warn(`Bestiary | Could not resolve actor UUID ${entry.uuid}`, error);
      }
    }

    creatures.sort((a, b) => a.name.localeCompare(b.name));
    const typeOptions = [...new Map(creatures.filter(c => c.creatureTypeKey).map(c => [c.creatureTypeKey, c.creatureType])).entries()]
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    const sizeOptions = [...new Map(creatures.filter(c => c.size).map(c => [c.size, c.size])).entries()]
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));

    return {
      creatures,
      allSections,
      typeOptions,
      sizeOptions,
      isGM,
      isEmpty: creatures.length === 0,
      sectionName: section.name,
      sectionId: section.id,
      sectionImage: section.image,
      resultCount: creatures.length,
      viewMode: this._viewMode,
      isGrid: this._viewMode === "grid",
      filtersOpen: this._filtersOpen
    };
  }

  _formatSpeed(creature) {
    const unit = formatDistanceUnit(creature.speedUnits);
    return Object.entries(creature.speeds ?? {}).map(([key, value]) => {
      const labelKey = key === "walk" ? "Walk" : key.charAt(0).toUpperCase() + key.slice(1);
      const localized = game.i18n.localize(`BESTIARY.Speed${labelKey}`);
      return `${localized}: ${value} ${unit}`;
    }).join(" · ");
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateSearchAndFilters();
    this._activateDragDrop();
    this._activateCards();
    this._applyClientState();
    playApplicationEntrance(this, ".section-shell");
  }

  _activateSearchAndFilters() {
    const search = this.element.querySelector(".collection-search-input");
    search?.addEventListener("input", event => {
      this._searchQuery = event.currentTarget.value.trim().toLocaleLowerCase();
      this._applyClientState();
    });
    this.element.querySelector(".collection-sort-select")?.addEventListener("change", event => {
      this._sortMode = event.currentTarget.value;
      this._applyClientState();
    });
    for (const checkbox of this.element.querySelectorAll("[data-filter-type]")) {
      checkbox.addEventListener("change", event => {
        const set = event.currentTarget.dataset.filterType === "type" ? this._typeFilters : this._sizeFilters;
        event.currentTarget.checked ? set.add(event.currentTarget.value) : set.delete(event.currentTarget.value);
        this._applyClientState();
      });
    }
    for (const input of this.element.querySelectorAll("[data-cr-bound]")) {
      input.addEventListener("input", event => {
        if (event.currentTarget.dataset.crBound === "min") this._crMin = event.currentTarget.value;
        else this._crMax = event.currentTarget.value;
        this._applyClientState();
      });
    }
    this.element.addEventListener("keydown", event => {
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        search?.focus();
      } else if (event.key === "Escape") {
        if (search?.value) {
          search.value = "";
          this._searchQuery = "";
          this._applyClientState();
        } else if (this._filtersOpen) this._toggleFilters(false);
      }
    });
  }

  _activateCards() {
    for (const card of this.element.querySelectorAll("[data-creature-entry][data-uuid]")) {
      card.addEventListener("dblclick", event => {
        if (game.user.isGM) this._onOpenSheet(event, card);
        else this._onOpenCreature(event, card);
      });
      card.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: card.dataset.uuid }));
      });
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._onSelectCreature(event, card);
        }
      });
    }
  }

  _activateDragDrop() {
    if (!game.user.isGM) return;
    const workspace = this.element.querySelector(".collection-workspace");
    if (!workspace) return;
    let dragDepth = 0;
    workspace.addEventListener("dragenter", event => {
      event.preventDefault();
      dragDepth += 1;
      workspace.classList.add("is-dragging-actor");
    });
    workspace.addEventListener("dragover", event => event.preventDefault());
    workspace.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) workspace.classList.remove("is-dragging-actor");
    });
    workspace.addEventListener("drop", async event => {
      event.preventDefault();
      dragDepth = 0;
      workspace.classList.remove("is-dragging-actor");
      await this._onDrop(event);
    });
  }

  _applyClientState() {
    if (!this.element) return;
    const min = this._crMin === "" ? -Infinity : Number(this._crMin);
    const max = this._crMax === "" ? Infinity : Number(this._crMax);
    let visible = 0;
    const matches = element => {
      const cr = Number(element.dataset.cr);
      return (!this._searchQuery || element.dataset.searchText.includes(this._searchQuery))
        && (!this._typeFilters.size || this._typeFilters.has(element.dataset.type))
        && (!this._sizeFilters.size || this._sizeFilters.has(element.dataset.size))
        && cr >= min && cr <= max;
    };
    for (const element of this.element.querySelectorAll("[data-creature-entry]")) {
      const show = matches(element);
      element.classList.toggle("is-filtered-out", !show);
      if (show && element.closest(".collection-grid-view")) visible += 1;
    }

    const compare = (a, b) => {
      if (this._sortMode === "name-desc") return b.dataset.name.localeCompare(a.dataset.name);
      if (this._sortMode === "cr-asc") return Number(a.dataset.cr) - Number(b.dataset.cr);
      if (this._sortMode === "cr-desc") return Number(b.dataset.cr) - Number(a.dataset.cr);
      return a.dataset.name.localeCompare(b.dataset.name);
    };
    for (const container of this.element.querySelectorAll(".collection-grid-view, .collection-list-body")) {
      [...container.children].filter(child => child.matches("[data-creature-entry]")).sort(compare).forEach(child => container.appendChild(child));
    }

    const activeFilters = this._typeFilters.size + this._sizeFilters.size + Number(this._crMin !== "") + Number(this._crMax !== "");
    for (const count of this.element.querySelectorAll(".collection-result-count")) count.textContent = String(visible);
    const badge = this.element.querySelector(".filter-count-badge");
    if (badge) {
      badge.textContent = String(activeFilters);
      badge.hidden = activeFilters === 0;
    }
    this._renderFilterChips();
  }

  _renderFilterChips() {
    const container = this.element.querySelector(".active-filter-chips");
    if (!container) return;
    container.replaceChildren();
    for (const input of this.element.querySelectorAll(".collection-filter-panel input[type='checkbox']:checked")) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.innerHTML = `<span>${input.closest("label")?.querySelector("span")?.textContent ?? input.value}</span><i class="fas fa-xmark"></i>`;
      chip.addEventListener("click", () => {
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      container.appendChild(chip);
    }
    for (const [value, label, bound] of [[this._crMin, game.i18n.localize("BESTIARY.From"), "min"], [this._crMax, game.i18n.localize("BESTIARY.To"), "max"]]) {
      if (value === "") continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.innerHTML = `<span>${game.i18n.localize("BESTIARY.CRShort")} ${label} ${value}</span><i class="fas fa-xmark"></i>`;
      chip.addEventListener("click", () => {
        const input = this.element.querySelector(`[data-cr-bound="${bound}"]`);
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      container.appendChild(chip);
    }
    if (container.children.length) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "clear-filter-chips";
      clear.textContent = game.i18n.localize("BESTIARY.ClearAll");
      clear.addEventListener("click", () => this._resetFilters());
      container.appendChild(clear);
    }
  }

  _onToggleView(event, target) {
    const mode = target.dataset.viewMode;
    if (!["grid", "list"].includes(mode)) return;
    this._viewMode = mode;
    game.settings.set("bestiary-journal", "libraryViewMode", mode);
    this.element.querySelector(".collection-grid-view")?.classList.toggle("is-hidden", mode !== "grid");
    this.element.querySelector(".collection-list-view")?.classList.toggle("is-hidden", mode !== "list");
    for (const button of this.element.querySelectorAll("[data-view-mode]")) button.classList.toggle("is-active", button.dataset.viewMode === mode);
  }

  _toggleFilters(force) {
    this._filtersOpen = typeof force === "boolean" ? force : !this._filtersOpen;
    this.element?.querySelector(".collection-filter-panel")?.classList.toggle("is-open", this._filtersOpen);
    this.element?.querySelector(".filter-backdrop")?.classList.toggle("is-open", this._filtersOpen);
  }

  _resetFilters() {
    this._typeFilters.clear();
    this._sizeFilters.clear();
    this._crMin = "";
    this._crMax = "";
    for (const input of this.element.querySelectorAll(".collection-filter-panel input")) {
      if (input.type === "checkbox") input.checked = false;
      else input.value = "";
    }
    this._applyClientState();
  }

  _onSelectCreature(event, target) {
    if (event.target.closest("button")) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    this._selectedUuid = uuid;
    for (const card of this.element.querySelectorAll("[data-creature-entry]")) card.classList.toggle("is-selected", card.dataset.uuid === uuid);
    for (const preview of this.element.querySelectorAll(".creature-preview-content")) preview.classList.toggle("is-active", preview.dataset.uuid === uuid);
    this.element.querySelector(".collection-preview-panel")?.classList.add("has-selection");
    this.element.querySelector(".collection-layout")?.classList.add("has-preview");
  }

  _closePreview() {
    this._selectedUuid = null;
    this.element.querySelector(".collection-preview-panel")?.classList.remove("has-selection");
    this.element.querySelector(".collection-layout")?.classList.remove("has-preview");
    this.element.querySelectorAll("[data-creature-entry]").forEach(card => card.classList.remove("is-selected"));
  }

  _onGoBack() {
    this.close();
    game.bestiaryJournal?.open();
  }

  _onSwitchSection(event, target) {
    const sectionId = target.dataset.sectionId;
    if (!sectionId || sectionId === this.sectionId) return;
    this.sectionId = sectionId;
    this._selectedUuid = null;
    this.render();
  }

  _onOpenCreature(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this._selectedUuid;
    if (uuid) new BestiaryCreatureView({ uuid }).render(true);
  }

  async _onOpenSheet(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;
    const uuid = target.closest?.("[data-uuid]")?.dataset.uuid ?? target.dataset?.uuid ?? this._selectedUuid;
    const actor = uuid ? await fromUuid(uuid) : null;
    actor?.sheet.render(true);
  }

  async _onDrop(event) {
    let dropData;
    try { dropData = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (dropData.type !== "Actor") return;
    const actor = await fromUuid(dropData.uuid);
    if (!actor || actor.type !== "npc") {
      ui.notifications.warn(game.i18n.localize("BESTIARY.OnlyNpcActors"));
      return;
    }
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    if (!section) return;
    if (section.creatures?.some(entry => entry.uuid === actor.uuid)) {
      ui.notifications.info(game.i18n.format("BESTIARY.AlreadyInCollection", { name: actor.name }));
      return;
    }
    section.creatures ??= [];
    section.creatures.push({ uuid: actor.uuid, addedAt: Date.now(), hidden: false });
    section.updatedAt = Date.now();
    await setBestiaryData(data);
    ui.notifications.info(game.i18n.format("BESTIARY.AddedToCollection", { name: actor.name, collection: section.name }));
    this.render();
  }

  async _onRemoveCreature(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BESTIARY.RemoveCreature") },
      content: `<p>${game.i18n.localize("BESTIARY.ConfirmRemoveCreature")}</p>`
    });
    if (!confirmed) return;
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    if (!section) return;
    section.creatures = (section.creatures ?? []).filter(entry => entry.uuid !== uuid);
    section.updatedAt = Date.now();
    await setBestiaryData(data);
    this.render();
  }

  async _onToggleCreatureVisibility(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    const creature = section?.creatures?.find(entry => entry.uuid === uuid);
    if (!creature) return;
    creature.hidden = !creature.hidden;
    section.updatedAt = Date.now();
    await setBestiaryData(data);
    this.render();
  }

  async refreshFromExternalUpdate() {
    const scrollTop = this.element?.querySelector(".collection-results-scroll")?.scrollTop ?? 0;
    await this.render();
    const scroller = this.element?.querySelector(".collection-results-scroll");
    if (scroller) scroller.scrollTop = scrollTop;
  }

  async close(options) {
    BestiarySectionView._instances.delete(this);
    return super.close(options);
  }
}
