import {
  BESTIARY_COMMANDS,
  getUserTier,
  isCreatureLocked,
  isSectionVisible,
  selectVisibleCreatureEntries,
  selectVisibleFamilies,
  selectVisibleSections
} from "./bestiary-domain.mjs";
import { getBestiaryData, getBestiaryKnowledge } from "./bestiary-store.mjs";
import { runCommand } from "./command-feedback.mjs";
import {
  getCollapsedFamilies,
  getLibraryViewMode,
  setLibraryViewMode,
  toggleCollapsedFamily
} from "./client-preferences.mjs";
import { buildCreatureCard } from "./creature-cards.mjs";
import { getCreatureDataMany } from "./creature-cache.mjs";
import { buildPartyBadge } from "./knowledge-ui.mjs";
import { GM_TIER } from "./research-model.mjs";
import { describeTier } from "./research.mjs";
import { getPlayerUsers, localize, resolveUuid } from "./foundry-runtime.mjs";
import { BestiaryTileEditor } from "./tile-editor.mjs";
import { BestiaryEntryEditor } from "./entry-editor.mjs";
import { BestiaryBulkImport } from "./bulk-import.mjs";
import { BestiaryBulkResearch } from "./bulk-research.mjs";
import { exportBestiary, exportCreatureEntry } from "./transfer.mjs";
import { playApplicationEntrance, showContextMenu } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const UNGROUPED_ID = "__ungrouped__";
const CARD_DRAG_TYPE = "application/x-bestiary-card";

export class BestiarySectionView extends HandlebarsApplicationMixin(ApplicationV2) {

  static _instances = new Set();

  static DEFAULT_OPTIONS = {
    id: "bestiary-section-view-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-section-view"],
    tag: "div",
    window: { title: "BESTIARY.Title", icon: "fas fa-book-open", resizable: true, minimizable: true },
    position: { width: 1280, height: 820 },
    actions: {
      goBack: function () { this._onGoBack(); },
      switchSection: function (event, target) { this._onSwitchSection(event, target); },
      toggleView: function (event, target) { this._onToggleView(event, target); },
      selectCreature: function (event, target) { this._onSelectCreature(event, target); },
      openCreature: function (event, target) { this._onOpenCreature(event, target); },
      removeCreature: function (event, target) { this._onRemoveCreature(event, target); },
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      toggleCreatureVisibility: function (event, target) { this._onToggleCreatureVisibility(event, target); },
      toggleCreatureLock: function (event, target) { this._onToggleCreatureLock(event, target); },
      openEntryEditor: function (event, target) { this._onOpenEntryEditor(event, target); },
      toggleFilters: function () { this._toggleFilters(); },
      closePreview: function () { this._closePreview(); },
      resetFilters: function () { this._resetFilters(); },
      createFamily: function () { this._onCreateFamily(); },
      editFamily: function (event, target) { this._onEditFamily(event, target); },
      deleteFamily: function (event, target) { this._onDeleteFamily(event, target); },
      toggleFamily: function (event, target) { this._onToggleFamily(event, target); },
      openBulkImport: function (event, target) { this._onOpenBulkImport(event, target); },
      openBulkResearch: function (event, target) {
        if (!game.user.isGM) return;
        const familyId = target.dataset.familyId;
        new BestiaryBulkResearch({ sectionId: this.sectionId, familyId: familyId === UNGROUPED_ID ? null : familyId }).render({ force: true });
      },
      exportSection: function () { this._onExportSection(); },
      exportEntry: function (event, target) { this._onExportEntry(event, target); }
    }
  };

  static PARTS = {
    section: { template: "modules/bestiary-journal/templates/section-view.hbs" }
  };

  constructor(options = {}) {
    const uniqueId = options.uniqueId ?? foundry.utils.randomID(16);
    super({ ...options, uniqueId });
    this.sectionId = options.sectionId;
    this._viewMode = getLibraryViewMode();
    this._sortMode = "name-asc";
    this._searchQuery = "";
    this._filtersOpen = false;
    this._selectedUuid = null;
    this._typeFilters = new Set();
    this._sizeFilters = new Set();
    this._familyFilters = new Set();
    this._crMin = "";
    this._crMax = "";
    BestiarySectionView._instances.add(this);
  }

  get title() {
    const section = getBestiaryData().sections.find(item => item.id === this.sectionId);
    return (section && isSectionVisible(section, game.user.isGM) && section.name) || localize("BESTIARY.Title");
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const found = data.sections.find(item => item.id === this.sectionId);
    const isGM = game.user.isGM;
    // A collection hidden while a player had it open disappears for them too.
    const section = found && isSectionVisible(found, isGM) ? found : null;
    const allSections = this._buildSectionNavigation(data, isGM);

    if (!section) return { creatures: [], groups: [], allSections, isGM, isEmpty: true, missing: true };

    const creatures = await this._resolveSectionCreatures(section, knowledge, isGM);
    const families = selectVisibleFamilies(section, isGM);
    const groups = this._buildGroups(section, families, creatures, isGM);
    const { typeOptions, sizeOptions } = this._buildFilterOptions(creatures);

    return {
      creatures,
      groups,
      families,
      familyOptions: families.map(family => ({ value: family.id, label: family.name })),
      allSections,
      typeOptions,
      sizeOptions,
      isGM,
      isEmpty: creatures.length === 0,
      sectionName: section.name,
      sectionId: section.id,
      sectionImage: section.image,
      sectionLocked: !!section.locked,
      resultCount: creatures.length,
      viewMode: this._viewMode,
      isGrid: this._viewMode === "grid",
      filtersOpen: this._filtersOpen,
      hasFamilies: families.length > 0
    };
  }

  _buildSectionNavigation(data, isGM) {
    return selectVisibleSections(data, isGM).map(section => ({
      ...section,
      creatureCount: selectVisibleCreatureEntries(section, isGM).length,
      isActive: section.id === this.sectionId
    }));
  }

  async _resolveSectionCreatures(section, knowledge, isGM) {
    const players = isGM ? getPlayerUsers() : [];
    const entries = selectVisibleCreatureEntries(section, isGM);
    const resolved = await getCreatureDataMany(entries.map(entry => entry.uuid));

    const creatures = entries.map(entry => {
      const viewerTier = isGM ? GM_TIER : getUserTier(knowledge, game.user.id, entry.uuid);
      return {
        ...buildCreatureCard({
          uuid: entry.uuid,
          entry,
          creature: resolved.get(entry.uuid),
          viewerTier,
          searchExtra: [section.name]
        }),
        entry,
        familyId: entry.familyId ?? UNGROUPED_ID,
        isHidden: !!entry.hidden,
        isLocked: !!entry.locked || !!section.locked,
        viewerTier,
        tierBadge: isGM ? buildPartyBadge(knowledge, entry.uuid, players) : describeTier(viewerTier)
      };
    });
    // Known names alphabetically, creatures the viewer cannot name last.
    creatures.sort((a, b) => (!a.sortName - !b.sortName) || a.sortName.localeCompare(b.sortName));
    return creatures;
  }

  _buildGroups(section, families, creatures, isGM) {
    const collapsed = getCollapsedFamilies();
    const groups = families.map(family => ({
      id: family.id,
      name: family.name,
      image: family.image,
      hidden: !!family.hidden,
      isUngrouped: false,
      collapsed: collapsed.has(`${section.id}:${family.id}`),
      creatures: creatures.filter(creature => creature.familyId === family.id)
    }));

    const ungrouped = creatures.filter(creature => creature.familyId === UNGROUPED_ID);
    if (ungrouped.length || !families.length) {
      groups.push({
        id: UNGROUPED_ID,
        name: localize(families.length ? "BESTIARY.Families.Ungrouped" : "BESTIARY.Families.AllCreatures"),
        image: "",
        hidden: false,
        isUngrouped: true,
        collapsed: collapsed.has(`${section.id}:${UNGROUPED_ID}`),
        creatures: ungrouped
      });
    }
    return groups
      .filter(group => isGM || group.creatures.length)
      .map(group => ({
        ...group,
        count: group.creatures.length,
        isEmpty: group.creatures.length === 0
      }));
  }

  _buildFilterOptions(creatures) {
    return {
      typeOptions: this._uniqueSortedOptions(
        creatures.filter(creature => creature.typeKey)
          .map(creature => [creature.typeKey, creature.typeName || creature.typeKey])
      ),
      sizeOptions: this._uniqueSortedOptions(
        creatures.filter(creature => creature.size).map(creature => [creature.size, creature.size])
      )
    };
  }

  _uniqueSortedOptions(entries) {
    return [...new Map(entries).entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  // ── Rendering ──

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // The outer element survives re-renders, so element-level listeners are
    // bound once and always look up the current controls.
    this.element.addEventListener("keydown", event => this._onShellKeydown(event));
    this.element.addEventListener("drop", () => this._clearDragState(), true);
    this.element.addEventListener("dragend", () => this._clearDragState(), true);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._syncWindowTitle();
    if (context.missing) return;
    this._dragDepth = new WeakMap();
    this._activateSearchAndFilters();
    this._activateDragDrop();
    this._activateCards();
    this._activateContextMenus();
    this._restoreFilterControls();
    this._applyClientState();
    this._restoreSelection();
    playApplicationEntrance(this, ".section-shell");
  }

  /** The frame is built once; keep its title in step with the collection. */
  _syncWindowTitle() {
    const title = this.window?.title;
    if (title instanceof HTMLElement) title.textContent = this.title;
  }

  _restoreSelection() {
    if (!this._selectedUuid) return;
    const exists = this.element.querySelector(`.creature-preview-content[data-uuid="${CSS.escape(this._selectedUuid)}"]`);
    if (exists) this._selectCreatureByUuid(this._selectedUuid);
    else this._closePreview();
  }

  _restoreFilterControls() {
    const search = this.element.querySelector(".collection-search-input");
    if (search) search.value = this._searchQuery;

    const sort = this.element.querySelector(".collection-sort-select");
    if (sort) sort.value = this._sortMode;

    for (const checkbox of this.element.querySelectorAll("[data-filter-type]")) {
      const selected = this._filterSetFor(checkbox.dataset.filterType);
      checkbox.checked = selected.has(checkbox.value);
    }
    const min = this.element.querySelector('[data-cr-bound="min"]');
    const max = this.element.querySelector('[data-cr-bound="max"]');
    if (min) min.value = this._crMin;
    if (max) max.value = this._crMax;
  }

  _filterSetFor(kind) {
    if (kind === "type") return this._typeFilters;
    if (kind === "size") return this._sizeFilters;
    return this._familyFilters;
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
        const set = this._filterSetFor(event.currentTarget.dataset.filterType);
        event.currentTarget.checked
          ? set.add(event.currentTarget.value)
          : set.delete(event.currentTarget.value);
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
  }

  _onShellKeydown(event) {
    const search = this.element.querySelector(".collection-search-input");
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      search?.focus();
    } else if (event.key === "Escape" && (search?.value || this._filtersOpen)) {
      event.preventDefault();
      event.stopPropagation();
      if (search?.value) {
        search.value = "";
        this._searchQuery = "";
        this._applyClientState();
      } else this._toggleFilters(false);
    }
  }

  _activateCards() {
    for (const card of this.element.querySelectorAll("[data-creature-entry][data-uuid]")) {
      card.addEventListener("dblclick", event => {
        if (game.user.isGM) this._onOpenSheet(event, card);
        else this._onOpenCreature(event, card);
      });
      card.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", JSON.stringify({
          type: "Actor",
          uuid: card.dataset.uuid,
          bestiarySource: this.sectionId
        }));
        event.dataTransfer.setData(CARD_DRAG_TYPE, card.dataset.uuid);
      });
      card.addEventListener("keydown", event => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._onSelectCreature(event, card);
        }
      });
    }
  }

  _activateContextMenus() {
    if (!game.user.isGM) return;
    for (const card of this.element.querySelectorAll("[data-creature-entry][data-uuid]")) {
      card.addEventListener("contextmenu", event => {
        event.preventDefault();
        this._showCreatureMenu(event, card);
      });
    }
  }

  _showCreatureMenu(event, card) {
    const uuid = card.dataset.uuid;
    const isHidden = card.dataset.hidden === "true";
    const isLocked = card.dataset.locked === "true";
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    const families = selectVisibleFamilies(section, true);

    const items = [
      { name: localize("BESTIARY.ViewCreature"), icon: "fa-eye", callback: () => this._openCreatureByUuid(uuid) },
      { name: localize("BESTIARY.OpenSheet"), icon: "fa-arrow-up-right-from-square", callback: () => this._openSheetByUuid(uuid) },
      { name: localize("BESTIARY.Entry.Title"), icon: "fa-sliders", callback: () => this._openEntryEditorByUuid(uuid) },
      {
        name: localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
        icon: isHidden ? "fa-eye" : "fa-eye-slash",
        callback: () => this._toggleVisibilityByUuid(uuid)
      },
      {
        name: localize(isLocked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
        icon: isLocked ? "fa-lock-open" : "fa-lock",
        callback: () => this._toggleLockByUuid(uuid, !isLocked)
      }
    ];

    if (families.length) {
      items.push({ separator: true });
      for (const family of families) {
        items.push({
          name: game.i18n.format("BESTIARY.Families.MoveTo", { name: family.name }),
          icon: "fa-folder-tree",
          callback: () => this._moveToFamily(uuid, family.id)
        });
      }
      items.push({
        name: localize("BESTIARY.Families.MoveToNone"),
        icon: "fa-folder-minus",
        callback: () => this._moveToFamily(uuid, null)
      });
    }

    items.push({ separator: true });
    items.push({ name: localize("BESTIARY.Transfer.ExportEntry"), icon: "fa-file-export", callback: () => exportCreatureEntry(this.sectionId, uuid) });
    items.push({ name: localize("BESTIARY.RemoveCreature"), icon: "fa-trash", danger: true, callback: () => this._removeByUuid(uuid) });
    showContextMenu(event, items);
  }

  _activateDragDrop() {
    if (!game.user.isGM) return;

    // The workspace only accepts new creatures; regrouping happens by dropping
    // a card on a family header, so a stray drop cannot silently ungroup it.
    const workspace = this.element.querySelector(".collection-workspace");
    if (workspace) this._bindDropZone(workspace, () => null, { acceptMove: false });

    for (const header of this.element.querySelectorAll("[data-family-drop]")) {
      this._bindDropZone(header, () => {
        const id = header.dataset.familyDrop;
        return id === UNGROUPED_ID ? null : id;
      }, { acceptMove: true });
    }
  }

  /**
   * The collection-wide overlay only reacts to things dragged in from outside;
   * family headers also accept cards moved within the collection.
   */
  _bindDropZone(element, resolveFamilyId, { acceptMove = true } = {}) {
    const accepts = event => acceptMove || !event.dataTransfer?.types?.includes(CARD_DRAG_TYPE);
    element.addEventListener("dragenter", event => {
      event.preventDefault();
      if (!accepts(event)) return;
      this._dragDepth.set(element, (this._dragDepth.get(element) ?? 0) + 1);
      element.classList.add("is-dragging-actor");
    });
    element.addEventListener("dragover", event => event.preventDefault());
    element.addEventListener("dragleave", event => {
      if (!accepts(event)) return;
      const depth = Math.max(0, (this._dragDepth.get(element) ?? 0) - 1);
      this._dragDepth.set(element, depth);
      if (!depth) element.classList.remove("is-dragging-actor");
    });
    element.addEventListener("drop", async event => {
      event.preventDefault();
      event.stopPropagation();
      this._clearDragState();
      await this._onDrop(event, resolveFamilyId(), acceptMove);
    });
  }

  /** A drop anywhere, handled or not, ends every highlight at once. */
  _clearDragState() {
    this._dragDepth = new WeakMap();
    for (const zone of this.element?.querySelectorAll(".is-dragging-actor") ?? []) {
      zone.classList.remove("is-dragging-actor");
    }
  }

  _applyClientState() {
    if (!this.element) return;
    const min = this._crMin === "" ? -Infinity : Number(this._crMin);
    const max = this._crMax === "" ? Infinity : Number(this._crMax);

    const hasCrBound = this._crMin !== "" || this._crMax !== "";
    const matches = element => {
      // A creature whose CR the viewer has not learned never matches a CR range.
      const knownCr = element.dataset.cr !== "";
      const cr = Number(element.dataset.cr);
      return (!this._searchQuery || element.dataset.searchText.includes(this._searchQuery))
        && (!this._typeFilters.size || this._typeFilters.has(element.dataset.type))
        && (!this._sizeFilters.size || this._sizeFilters.has(element.dataset.size))
        && (!this._familyFilters.size || this._familyFilters.has(element.dataset.familyId))
        && (!hasCrBound || (knownCr && cr >= min && cr <= max));
    };

    let visible = 0;
    for (const element of this.element.querySelectorAll("[data-creature-entry]")) {
      const show = matches(element);
      element.classList.toggle("is-filtered-out", !show);
      if (show && element.closest(".collection-grid-view")) visible += 1;
    }

    // Unnamed and unrated creatures always sort after the ones the viewer knows.
    const byName = (a, b, direction) => (!a.dataset.name - !b.dataset.name)
      || direction * a.dataset.name.localeCompare(b.dataset.name);
    const byCr = (a, b, direction) => ((a.dataset.cr === "") - (b.dataset.cr === ""))
      || direction * (Number(a.dataset.cr) - Number(b.dataset.cr))
      || byName(a, b, 1);
    const compare = (a, b) => {
      if (this._sortMode === "name-desc") return byName(a, b, -1);
      if (this._sortMode === "cr-asc") return byCr(a, b, 1);
      if (this._sortMode === "cr-desc") return byCr(a, b, -1);
      return byName(a, b, 1);
    };
    for (const container of this.element.querySelectorAll(".family-grid, .collection-list-body")) {
      [...container.children]
        .filter(child => child.matches("[data-creature-entry]"))
        .sort(compare)
        .forEach(child => container.appendChild(child));
    }

    const activeFilters = this._typeFilters.size + this._sizeFilters.size
      + this._familyFilters.size + Number(this._crMin !== "") + Number(this._crMax !== "");
    const isNarrowing = activeFilters > 0 || !!this._searchQuery;

    for (const group of this.element.querySelectorAll("[data-family-group]")) {
      const shown = [...group.querySelectorAll("[data-creature-entry]")]
        .filter(card => !card.classList.contains("is-filtered-out")).length;
      // An empty family is only hidden while a filter is narrowing the list.
      // Otherwise it has to stay on screen: it is the GM's drop target, and
      // the only way to rename or delete it.
      group.classList.toggle("is-empty-after-filter", shown === 0 && isNarrowing);
      const counter = group.querySelector(".family-count");
      if (counter) counter.textContent = String(shown);
    }
    for (const count of this.element.querySelectorAll(".collection-result-count")) {
      count.textContent = String(visible);
    }
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
      chip.innerHTML = `<span></span><i class="fas fa-xmark"></i>`;
      chip.querySelector("span").textContent =
        input.closest("label")?.querySelector("span")?.textContent ?? input.value;
      chip.addEventListener("click", () => {
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      container.appendChild(chip);
    }

    for (const [value, label, bound] of [
      [this._crMin, localize("BESTIARY.From"), "min"],
      [this._crMax, localize("BESTIARY.To"), "max"]
    ]) {
      if (value === "") continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.innerHTML = `<span></span><i class="fas fa-xmark"></i>`;
      chip.querySelector("span").textContent = `${localize("BESTIARY.CRShort")} ${label} ${value}`;
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
      clear.textContent = localize("BESTIARY.ClearAll");
      clear.addEventListener("click", () => this._resetFilters());
      container.appendChild(clear);
    }
  }

  // ── Actions ──

  async _onToggleView(event, target) {
    const mode = target.dataset.viewMode;
    if (!["grid", "list"].includes(mode)) return;
    this._viewMode = mode;
    await setLibraryViewMode(mode);
    this.element.querySelector(".collection-grid-view")?.classList.toggle("is-hidden", mode !== "grid");
    this.element.querySelector(".collection-list-view")?.classList.toggle("is-hidden", mode !== "list");
    for (const button of this.element.querySelectorAll("[data-view-mode]")) {
      button.classList.toggle("is-active", button.dataset.viewMode === mode);
    }
  }

  _toggleFilters(force) {
    this._filtersOpen = typeof force === "boolean" ? force : !this._filtersOpen;
    this.element?.querySelector(".collection-filter-panel")?.classList.toggle("is-open", this._filtersOpen);
    this.element?.querySelector(".filter-backdrop")?.classList.toggle("is-open", this._filtersOpen);
  }

  _resetFilters() {
    this._typeFilters.clear();
    this._sizeFilters.clear();
    this._familyFilters.clear();
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
    if (uuid) this._selectCreatureByUuid(uuid);
  }

  _selectCreatureByUuid(uuid) {
    this._selectedUuid = uuid;
    for (const card of this.element.querySelectorAll("[data-creature-entry]")) {
      card.classList.toggle("is-selected", card.dataset.uuid === uuid);
    }
    for (const preview of this.element.querySelectorAll(".creature-preview-content")) {
      preview.classList.toggle("is-active", preview.dataset.uuid === uuid);
    }
    this.element.querySelector(".collection-preview-panel")?.classList.add("has-selection");
    this.element.querySelector(".collection-layout")?.classList.add("has-preview");
  }

  _closePreview() {
    this._selectedUuid = null;
    this.element.querySelector(".collection-preview-panel")?.classList.remove("has-selection");
    this.element.querySelector(".collection-layout")?.classList.remove("has-preview");
    this.element.querySelectorAll("[data-creature-entry]")
      .forEach(card => card.classList.remove("is-selected"));
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
    this._familyFilters.clear();
    this.render();
  }

  _onOpenCreature(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this._selectedUuid;
    if (uuid) this._openCreatureByUuid(uuid);
  }

  _openCreatureByUuid(uuid) {
    game.bestiaryJournal?.openCreature(uuid, { sectionId: this.sectionId });
  }

  async _onOpenSheet(event, target) {
    event.stopPropagation();
    const uuid = target.closest?.("[data-uuid]")?.dataset.uuid ?? target.dataset?.uuid ?? this._selectedUuid;
    await this._openSheetByUuid(uuid);
  }

  async _openSheetByUuid(uuid) {
    if (!game.user.isGM || !uuid) return;
    const actor = await resolveUuid(uuid);
    actor?.sheet.render({ force: true });
  }

  _onOpenEntryEditor(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this._selectedUuid;
    if (uuid) this._openEntryEditorByUuid(uuid);
  }

  _openEntryEditorByUuid(uuid) {
    new BestiaryEntryEditor({ sectionId: this.sectionId, uuid }).render({ force: true });
  }

  // ── Families ──

  _onCreateFamily() {
    new BestiaryTileEditor({ mode: "family", sectionId: this.sectionId }).render({ force: true });
  }

  _onEditFamily(event, target) {
    event.stopPropagation();
    const familyId = target.closest("[data-family-id]")?.dataset.familyId;
    const section = getBestiaryData().sections.find(item => item.id === this.sectionId);
    const family = section?.families.find(item => item.id === familyId);
    if (!family) return;
    new BestiaryTileEditor({ mode: "family", sectionId: this.sectionId, tileData: family }).render({ force: true });
  }

  async _onDeleteFamily(event, target) {
    event.stopPropagation();
    const familyId = target.closest("[data-family-id]")?.dataset.familyId;
    if (!familyId) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.Families.Delete") },
      content: `<p>${localize("BESTIARY.Families.ConfirmDelete")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await runCommand({
      type: BESTIARY_COMMANDS.DELETE_FAMILY,
      sectionId: this.sectionId,
      familyId
    }, { unchanged: "BESTIARY.Lock.Blocked" });
  }

  async _onToggleFamily(event, target) {
    event.stopPropagation();
    const group = target.closest("[data-family-group]");
    const familyId = group?.dataset.familyGroup;
    if (!familyId) return;
    const collapsed = (await toggleCollapsedFamily(`${this.sectionId}:${familyId}`))
      .has(`${this.sectionId}:${familyId}`);
    // The same family appears in both the grid and the list; keep them in step.
    for (const element of this.element.querySelectorAll(`[data-family-group="${CSS.escape(familyId)}"]`)) {
      element.classList.toggle("is-collapsed", collapsed);
      const icon = element.querySelector(".family-chevron");
      icon?.classList.toggle("fa-chevron-down", !collapsed);
      icon?.classList.toggle("fa-chevron-right", collapsed);
    }
  }

  async _moveToFamily(uuid, familyId) {
    await runCommand({
      type: BESTIARY_COMMANDS.MOVE_CREATURE,
      sectionId: this.sectionId,
      uuid,
      targetFamilyId: familyId
    });
  }

  // ── Import / export ──

  _onOpenBulkImport(event, target) {
    if (!game.user.isGM) return;
    const familyId = target?.dataset.familyId ?? "";
    new BestiaryBulkImport({
      sectionId: this.sectionId,
      familyId: familyId === UNGROUPED_ID ? "" : familyId
    }).render({ force: true });
  }

  _onExportSection() {
    exportBestiary({ sectionIds: [this.sectionId] });
  }

  _onExportEntry(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this._selectedUuid;
    if (uuid) exportCreatureEntry(this.sectionId, uuid);
  }

  // ── Drops ──

  async _onDrop(event, familyId, acceptMove = true) {
    let dropData;
    try {
      dropData = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    if (dropData.type === "Folder") return this._onDropFolder(dropData, familyId);
    if (dropData.type !== "Actor") return;

    // Dragging a card between families inside this collection moves it.
    if (dropData.bestiarySource === this.sectionId) {
      if (acceptMove) await this._moveToFamily(dropData.uuid, familyId);
      return;
    }

    const actor = await resolveUuid(dropData.uuid);
    if (!actor || actor.type !== "npc") {
      ui.notifications.warn(localize("BESTIARY.OnlyNpcActors"));
      return;
    }
    const section = getBestiaryData().sections.find(item => item.id === this.sectionId);
    if (!section) return;
    if (section.creatures?.some(entry => entry.uuid === actor.uuid)) {
      ui.notifications.info(game.i18n.format("BESTIARY.AlreadyInCollection", { name: actor.name }));
      return;
    }

    const result = await runCommand({
      type: BESTIARY_COMMANDS.ADD_CREATURE,
      sectionId: this.sectionId,
      familyId,
      uuid: actor.uuid,
      label: actor.name,
      thumb: actor.img
    }, { unchanged: "BESTIARY.Lock.Blocked" });
    if (!result?.changed) return;
    ui.notifications.info(game.i18n.format("BESTIARY.AddedToCollection", {
      name: actor.name,
      collection: section.name
    }));
  }

  /** Dropping an actor folder adds every NPC inside it at once. */
  async _onDropFolder(dropData, familyId) {
    const folder = dropData.uuid
      ? await resolveUuid(dropData.uuid)
      : game.folders?.get(dropData.id);
    if (!folder || folder.type !== "Actor") return;
    const actors = folder.contents.filter(actor => actor.type === "npc");
    if (!actors.length) {
      ui.notifications.warn(localize("BESTIARY.Import.FolderEmpty"));
      return;
    }
    const present = new Set(getBestiaryData().sections
      .find(item => item.id === this.sectionId)?.creatures.map(entry => entry.uuid) ?? []);
    const fresh = actors.filter(actor => !present.has(actor.uuid));
    if (!fresh.length) {
      ui.notifications.info(localize("BESTIARY.Import.NothingNew"));
      return;
    }
    const result = await runCommand({
      type: BESTIARY_COMMANDS.ADD_CREATURES,
      sectionId: this.sectionId,
      familyId,
      entries: fresh.map(actor => ({ uuid: actor.uuid, label: actor.name, thumb: actor.img }))
    }, { unchanged: "BESTIARY.Lock.Blocked" });
    if (result?.changed) ui.notifications.info(game.i18n.format("BESTIARY.Import.Done", { count: fresh.length }));
  }

  // ── Entry mutations ──

  async _onRemoveCreature(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this._selectedUuid;
    if (uuid) await this._removeByUuid(uuid);
  }

  async _removeByUuid(uuid) {
    if (isCreatureLocked(getBestiaryData(), uuid)) {
      ui.notifications.warn(localize("BESTIARY.Lock.Blocked"));
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.RemoveCreature") },
      content: `<p>${localize("BESTIARY.ConfirmRemoveCreature")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await runCommand({
      type: BESTIARY_COMMANDS.REMOVE_CREATURE,
      sectionId: this.sectionId,
      uuid
    }, { unchanged: "BESTIARY.Lock.Blocked" });
  }

  async _onToggleCreatureVisibility(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this._selectedUuid;
    if (uuid) await this._toggleVisibilityByUuid(uuid);
  }

  async _toggleVisibilityByUuid(uuid) {
    await runCommand({
      type: BESTIARY_COMMANDS.TOGGLE_CREATURE_VISIBILITY,
      sectionId: this.sectionId,
      uuid
    });
  }

  async _onToggleCreatureLock(event, target) {
    event.stopPropagation();
    const card = target.closest("[data-uuid]");
    if (!card) return;
    await this._toggleLockByUuid(card.dataset.uuid, card.dataset.locked !== "true");
  }

  async _toggleLockByUuid(uuid, locked) {
    await runCommand({
      type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
      sectionId: this.sectionId,
      uuid,
      locked
    });
  }

  async refreshFromExternalUpdate(payload = {}) {
    const changed = payload.changed ?? {};
    if (!changed.data && !changed.knowledge) return;
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
