import {
  BESTIARY_COMMANDS,
  isSectionVisible,
  selectVisibleFamilies,
  selectVisibleSections,
} from "../core/bestiary-domain.js";
import {
  activeFilterCount,
  compareCollectionCards,
  matchesCollectionFilter,
} from "../core/collection-filter.js";
import { PARTY_VIEWER } from "../core/knowledge-lens.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { localizedTierChoices } from "../foundry/creature-display.js";
import {
  getLibraryViewMode,
  getShowOnboardingHints,
  setLibraryViewMode,
  toggleCollapsedFamily,
} from "../foundry/client-preferences.js";
import { runCommand } from "../foundry/command-feedback.js";
import {
  confirmDialog,
  formatCount,
  getPlayerUsers,
  localize,
  resolveUuid,
} from "../foundry/foundry-runtime.js";
import { exportBestiary, exportCreatureEntry } from "../foundry/transfer.js";
import { BestiaryBulkImport } from "./bulk-import.js";
import { BestiaryBulkResearch } from "./bulk-research.js";
import { postCreatureToChat } from "./creature-cards.js";
import { UNGROUPED_ID, buildCreatureRows, rowInputs, summarizeRows } from "./creature-rows.js";
import { BestiaryEntryEditor } from "./entry-editor.js";
import { BestiaryKnowledgeBoard } from "./knowledge-board.js";
import { buildFamilyGroups, buildFilterOptions } from "./section-model.js";
import { BestiaryTileEditor } from "./tile-editor.js";
import { showContextMenu } from "./ui-effects.js";

const CARD_DRAG_TYPE = "application/x-bestiary-card";

/** Prepares template context for a collection workspace inside BestiaryApp or BestiarySectionView. */
export async function prepareCollectionContext({ sectionId, state, inputs: sharedInputs = null }) {
  const data = sharedInputs?.data ?? getBestiaryData();
  const knowledge = sharedInputs?.knowledge ?? getBestiaryKnowledge();
  const found = data.sections.find((item) => item.id === sectionId);
  const isGM = game.user.isGM;
  const section = found && isSectionVisible(found, game.user) ? found : null;
  if (!section) return { missing: true, creatures: [], groups: [], isEmpty: true };

  const visibleSections = selectVisibleSections(data, game.user);
  const inputs = sharedInputs ?? (await rowInputs(visibleSections, { data, knowledge }));
  const creatures = buildCreatureRows([section], inputs);
  const families = selectVisibleFamilies(section, game.user);
  const groups = buildFamilyGroups(section, families, creatures, isGM);
  const showcaseFamilies = groups.filter((group) => !group.isSystemGroup || group.creatures.length > 0);
  const { typeOptions, sizeOptions } = buildFilterOptions(creatures);
  const { progress } = summarizeRows(creatures);
  const viewMode = state.viewMode === "families" && !families.length && !isGM ? "grid" : state.viewMode;
  state.viewMode = viewMode;

  return {
    missing: false,
    creatures,
    groups,
    showcaseFamilies,
    families,
    familyOptions: families.map((family) => ({ value: family.id, label: family.name })),
    typeOptions,
    sizeOptions,
    isGM,
    isEmpty: creatures.length === 0,
    hasPlayers: isGM && getPlayerUsers().length > 0,
    partyTierOptions: isGM ? localizedTierChoices(null, { includeNever: false }) : [],
    sectionName: section.name,
    sectionId: section.id,
    sectionImage: section.image,
    sectionHidden: !!section.hidden,
    sectionLocked: !!section.locked,
    resultCount: creatures.length,
    summaryCountLabel: formatCount("BESTIARY.Count.Creatures", creatures.length),
    familyCountLabel: families.length ? formatCount("BESTIARY.Count.Families", families.length) : "",
    progressLabel: progress ? game.i18n.format("BESTIARY.Progress.Known", progress) : "",
    viewMode,
    isGrid: viewMode === "grid",
    isList: viewMode === "list",
    isFamiliesView: viewMode === "families",
    filtersOpen: state.filtersOpen,
    hasFamilies: families.length > 0,
    showHints: getShowOnboardingHints(),
  };
}

/**
 * Interactive controller for a collection workspace (search, filters, sorting,
 * family showcase & banners, drag-drop, quick preview, and context menus).
 */
export class CollectionWorkspaceController {
  constructor(host, sectionId = null) {
    this.host = host;
    this.sectionId = sectionId;
    this.state = {
      viewMode: getLibraryViewMode(),
      sortMode: "name-asc",
      searchQuery: "",
      filtersOpen: false,
      selectedUuid: null,
      typeFilters: new Set(),
      sizeFilters: new Set(),
      familyFilters: new Set(),
      crMin: "",
      crMax: "",
    };
    this._dragDepth = new WeakMap();
  }

  get element() {
    return this.host.element;
  }

  setSection(sectionId) {
    if (sectionId === this.sectionId) return;
    this.sectionId = sectionId;
    this.state.selectedUuid = null;
    this.state.searchQuery = "";
    this.state.filtersOpen = false;
    this.state.typeFilters.clear();
    this.state.sizeFilters.clear();
    this.state.familyFilters.clear();
    this.state.crMin = "";
    this.state.crMax = "";
    if (this.state.viewMode === "families") {
      this.state.viewMode = getLibraryViewMode();
    }
  }

  clearDragState() {
    this._dragDepth = new WeakMap();
    for (const zone of this.element?.querySelectorAll(".is-dragging-actor") ?? []) {
      zone.classList.remove("is-dragging-actor");
    }
  }

  handleKeydown(event) {
    const search = this.element?.querySelector(".collection-search-input");
    if (!search) return false;
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      search.focus();
      return true;
    }
    if (event.key === "Escape" && (search.value || this.state.filtersOpen)) {
      event.preventDefault();
      event.stopPropagation();
      if (search.value) {
        search.value = "";
        this.state.searchQuery = "";
        this.applyClientState();
      } else {
        this.toggleFilters(false);
      }
      return true;
    }
    return false;
  }

  activate({ missing = false } = {}) {
    if (missing) return;
    this._dragDepth = new WeakMap();
    this._activateSearchAndFilters();
    this._activateDragDrop();
    this._activateCards();
    this._activateContextMenus();
    this._restoreFilterControls();
    this.applyClientState();
    this._restoreSelection();
  }

  _filterSetFor(kind) {
    if (kind === "type") return this.state.typeFilters;
    if (kind === "size") return this.state.sizeFilters;
    return this.state.familyFilters;
  }

  _filterState() {
    return {
      query: this.state.searchQuery,
      types: this.state.typeFilters,
      sizes: this.state.sizeFilters,
      families: this.state.familyFilters,
      crMin: this.state.crMin,
      crMax: this.state.crMax,
    };
  }

  _restoreFilterControls() {
    const search = this.element.querySelector(".collection-search-input");
    if (search) search.value = this.state.searchQuery;

    const sort = this.element.querySelector(".collection-sort-select");
    if (sort) sort.value = this.state.sortMode;

    for (const checkbox of this.element.querySelectorAll("[data-filter-type]")) {
      const selected = this._filterSetFor(checkbox.dataset.filterType);
      checkbox.checked = selected.has(checkbox.value);
    }
    const min = this.element.querySelector('[data-cr-bound="min"]');
    const max = this.element.querySelector('[data-cr-bound="max"]');
    if (min) min.value = this.state.crMin;
    if (max) max.value = this.state.crMax;
  }

  _restoreSelection() {
    if (!this.state.selectedUuid) return;
    const exists = this.element.querySelector(
      `.creature-preview-content[data-uuid="${CSS.escape(this.state.selectedUuid)}"]`,
    );
    if (exists) this.selectCreatureByUuid(this.state.selectedUuid);
    else this.closePreview();
  }

  _activateSearchAndFilters() {
    this.element.querySelector(".collection-search-input")?.addEventListener("input", (event) => {
      this.state.searchQuery = event.currentTarget.value.trim().toLocaleLowerCase();
      this.applyClientState();
    });
    this.element.querySelector(".collection-sort-select")?.addEventListener("change", (event) => {
      this.state.sortMode = event.currentTarget.value;
      this.applyClientState();
    });
    for (const checkbox of this.element.querySelectorAll("[data-filter-type]")) {
      checkbox.addEventListener("change", (event) => {
        const set = this._filterSetFor(event.currentTarget.dataset.filterType);
        event.currentTarget.checked
          ? set.add(event.currentTarget.value)
          : set.delete(event.currentTarget.value);
        this.applyClientState();
      });
    }
    for (const input of this.element.querySelectorAll("[data-cr-bound]")) {
      input.addEventListener("input", (event) => {
        if (event.currentTarget.dataset.crBound === "min") this.state.crMin = event.currentTarget.value;
        else this.state.crMax = event.currentTarget.value;
        this.applyClientState();
      });
    }
    for (const select of this.element.querySelectorAll(".preview-family-select")) {
      select.addEventListener("change", (event) => {
        const uuid = event.currentTarget.dataset.uuid;
        const targetFamilyId = event.currentTarget.value || null;
        if (uuid) this.moveToFamily(uuid, targetFamilyId);
      });
    }
  }

  _activateCards() {
    for (const card of this.element.querySelectorAll("[data-creature-entry][data-uuid]")) {
      card.addEventListener("dblclick", (event) => {
        if (event.target?.closest?.(".creature-card-quick")) return;
        if (game.user.isGM) this.openSheet(event, card);
        else this.openCreature(event, card);
      });
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData(
          "text/plain",
          JSON.stringify({
            type: "Actor",
            uuid: card.dataset.uuid,
            bestiarySource: this.sectionId,
          }),
        );
        event.dataTransfer.setData(CARD_DRAG_TYPE, card.dataset.uuid);
      });
    }
  }

  _activateContextMenus() {
    if (!game.user.isGM) return;
    for (const card of this.element.querySelectorAll("[data-creature-entry][data-uuid]")) {
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.showCreatureMenu(event, card);
      });
    }
    for (const familyCard of this.element.querySelectorAll(".family-showcase-card[data-family-id]")) {
      if (familyCard.dataset.systemGroup === "true") continue;
      familyCard.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.showFamilyMenu(event, familyCard.dataset.familyId);
      });
    }
  }

  _activateDragDrop() {
    if (!game.user.isGM) return;
    const workspace = this.element.querySelector(".collection-workspace");
    if (workspace) this._bindDropZone(workspace, () => null, { acceptMove: false });

    for (const zone of this.element.querySelectorAll("[data-family-drop]")) {
      this._bindDropZone(
        zone,
        () => {
          const id = zone.dataset.familyDrop;
          return id === UNGROUPED_ID ? null : id;
        },
        { acceptMove: true },
      );
    }
  }

  _bindDropZone(element, resolveFamilyId, { acceptMove = true } = {}) {
    const accepts = (event) => acceptMove || !event.dataTransfer?.types?.includes(CARD_DRAG_TYPE);
    element.addEventListener("dragenter", (event) => {
      event.preventDefault();
      if (!accepts(event)) return;
      this._dragDepth.set(element, (this._dragDepth.get(element) ?? 0) + 1);
      element.classList.add("is-dragging-actor");
    });
    element.addEventListener("dragover", (event) => event.preventDefault());
    element.addEventListener("dragleave", (event) => {
      if (!accepts(event)) return;
      const depth = Math.max(0, (this._dragDepth.get(element) ?? 0) - 1);
      this._dragDepth.set(element, depth);
      if (!depth) element.classList.remove("is-dragging-actor");
    });
    element.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearDragState();
      await this._onDrop(event, resolveFamilyId(), acceptMove);
    });
  }

  applyClientState() {
    if (!this.element) return;
    const state = this._filterState();

    let visible = 0;
    for (const element of this.element.querySelectorAll("[data-creature-entry]")) {
      const show = matchesCollectionFilter(element.dataset, state);
      element.classList.toggle("is-filtered-out", !show);
      if (show && element.closest(".collection-grid-view")) visible += 1;
    }

    for (const container of this.element.querySelectorAll(".family-grid, .collection-list-body")) {
      [...container.children]
        .filter((child) => child.matches("[data-creature-entry]"))
        .toSorted((a, b) => compareCollectionCards(a.dataset, b.dataset, this.state.sortMode))
        .forEach((child) => container.appendChild(child));
    }

    const activeFilters = activeFilterCount(state);
    const isNarrowing = activeFilters > 0 || !!this.state.searchQuery;

    for (const group of this.element.querySelectorAll("[data-family-group]")) {
      const shown = [...group.querySelectorAll("[data-creature-entry]")].filter(
        (card) => !card.classList.contains("is-filtered-out"),
      ).length;
      group.classList.toggle("is-empty-after-filter", shown === 0 && isNarrowing);
      const counter = group.querySelector(".family-count");
      if (counter) counter.textContent = String(shown);
    }

    let visibleFamilies = 0;
    for (const card of this.element.querySelectorAll(".family-showcase-card:not(.is-create-card)")) {
      const text = (card.dataset.searchText ?? "").toLocaleLowerCase();
      const matchSearch = !this.state.searchQuery || text.includes(this.state.searchQuery);
      const matchFilter =
        !this.state.familyFilters.size || this.state.familyFilters.has(card.dataset.familyId);
      const showCard = matchSearch && matchFilter;
      card.classList.toggle("is-filtered-out", !showCard);
      if (showCard) visibleFamilies += 1;
    }

    const totalEntries = this.element.querySelectorAll(".collection-grid-view [data-creature-entry]").length;
    const isFamilies = this.state.viewMode === "families";
    const shownActive = isFamilies ? visibleFamilies : visible;
    const filteredEmpty = isFamilies
      ? isNarrowing && visibleFamilies === 0 && totalEntries > 0
      : isNarrowing && totalEntries > 0 && visible === 0;
    this.element.querySelector(".collection-workspace")?.classList.toggle("is-filtered-empty", filteredEmpty);

    for (const count of this.element.querySelectorAll(".collection-result-count")) {
      count.textContent = String(shownActive);
    }
    for (const label of this.element.querySelectorAll(".collection-result-label")) {
      label.textContent = formatCount(
        isFamilies ? "BESTIARY.Count.Families" : "BESTIARY.Count.Creatures",
        shownActive,
      );
    }
    const badge = this.element.querySelector(".filter-count-badge");
    if (badge) {
      badge.textContent = String(activeFilters);
      badge.hidden = activeFilters === 0;
    }
    this.element
      .querySelector(".collection-search-clear")
      ?.classList.toggle("is-visible", !!this.state.searchQuery);
    this._renderFilterChips();
  }

  _renderFilterChips() {
    const container = this.element.querySelector(".active-filter-chips");
    if (!container) return;
    container.replaceChildren();

    for (const input of this.element.querySelectorAll(
      ".collection-filter-panel input[type='checkbox']:checked",
    )) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.innerHTML = `<span></span><i class="fa-solid fa-xmark"></i>`;
      chip.querySelector("span").textContent =
        input.closest("label")?.querySelector("span")?.textContent ?? input.value;
      chip.addEventListener("click", () => {
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      container.appendChild(chip);
    }

    for (const [value, label, bound] of [
      [this.state.crMin, localize("BESTIARY.From"), "min"],
      [this.state.crMax, localize("BESTIARY.To"), "max"],
    ]) {
      if (value === "") continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.innerHTML = `<span></span><i class="fa-solid fa-xmark"></i>`;
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
      clear.addEventListener("click", () => this.resetFilters());
      container.appendChild(clear);
    }
  }

  clearSearch() {
    const input = this.element?.querySelector(".collection-search-input");
    if (!input) return;
    input.value = "";
    this.state.searchQuery = "";
    this.applyClientState();
    input.focus();
  }

  resetAllFiltering() {
    const input = this.element?.querySelector(".collection-search-input");
    if (input) input.value = "";
    this.state.searchQuery = "";
    this.resetFilters();
  }

  async toggleView(mode) {
    if (!["grid", "list", "families"].includes(mode)) return;
    this.state.viewMode = mode;
    if (mode !== "families") await setLibraryViewMode(mode);
    this.element.querySelector(".collection-grid-view")?.classList.toggle("is-hidden", mode !== "grid");
    this.element.querySelector(".collection-list-view")?.classList.toggle("is-hidden", mode !== "list");
    this.element
      .querySelector(".collection-families-view")
      ?.classList.toggle("is-hidden", mode !== "families");
    for (const button of this.element.querySelectorAll("[data-view-mode]")) {
      const active = button.dataset.viewMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.applyClientState();
  }

  async focusFamily(familyId) {
    if (!familyId) return;
    await this.toggleView("grid");
    if (
      familyId !== UNGROUPED_ID &&
      this.element.querySelector(`[data-filter-type="family"][value="${CSS.escape(familyId)}"]`)
    ) {
      this.state.familyFilters = new Set([familyId]);
      this._restoreFilterControls();
      this.applyClientState();
    } else if (familyId === UNGROUPED_ID && this.state.familyFilters.size) {
      this.state.familyFilters.clear();
      this._restoreFilterControls();
      this.applyClientState();
    }
    const target = this.element.querySelector(`[data-family-group="${CSS.escape(familyId)}"]`);
    if (target?.classList.contains("is-collapsed")) await this.toggleFamily(target);
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  toggleFilters(force) {
    this.state.filtersOpen = typeof force === "boolean" ? force : !this.state.filtersOpen;
    this.element
      ?.querySelector(".collection-filter-panel")
      ?.classList.toggle("is-open", this.state.filtersOpen);
    this.element?.querySelector(".filter-backdrop")?.classList.toggle("is-open", this.state.filtersOpen);
  }

  resetFilters() {
    this.state.typeFilters.clear();
    this.state.sizeFilters.clear();
    this.state.familyFilters.clear();
    this.state.crMin = "";
    this.state.crMax = "";
    for (const input of this.element.querySelectorAll(".collection-filter-panel input")) {
      if (input.type === "checkbox") input.checked = false;
      else input.value = "";
    }
    this.applyClientState();
  }

  selectCreature(event, target) {
    if (event.target?.closest?.(".creature-card-quick")) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (uuid) this.selectCreatureByUuid(uuid);
  }

  selectCreatureByUuid(uuid) {
    this.state.selectedUuid = uuid;
    for (const card of this.element.querySelectorAll("[data-creature-entry]")) {
      card.classList.toggle("is-selected", card.dataset.uuid === uuid);
    }
    for (const preview of this.element.querySelectorAll(".creature-preview-content")) {
      preview.classList.toggle("is-active", preview.dataset.uuid === uuid);
    }
    this.element.querySelector(".collection-preview-panel")?.classList.add("has-selection");
    this.element.querySelector(".collection-layout")?.classList.add("has-preview");
    this.element.querySelector(".preview-backdrop")?.classList.add("is-open");
  }

  closePreview() {
    this.state.selectedUuid = null;
    this.element.querySelector(".collection-preview-panel")?.classList.remove("has-selection");
    this.element.querySelector(".collection-layout")?.classList.remove("has-preview");
    this.element.querySelector(".preview-backdrop")?.classList.remove("is-open");
    this.element
      .querySelectorAll("[data-creature-entry]")
      .forEach((card) => card.classList.remove("is-selected"));
  }

  async setPartyTier(tier) {
    if (!game.user.isGM || !this.state.selectedUuid) return;
    const userIds = getPlayerUsers().map((user) => user.id);
    if (!userIds.length) return;
    await runCommand(
      {
        type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
        uuids: [this.state.selectedUuid],
        userIds,
        tier: Number(tier),
        source: "gm",
        grantedBy: game.user.id,
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
  }

  openCreature(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this.state.selectedUuid;
    if (uuid) this.openCreatureByUuid(uuid);
  }

  openCreatureByUuid(uuid) {
    game.bestiaryJournal?.openCreature(uuid, { sectionId: this.sectionId });
  }

  async openSheet(event, target) {
    event.stopPropagation();
    const uuid =
      target.closest?.("[data-uuid]")?.dataset.uuid ?? target.dataset?.uuid ?? this.state.selectedUuid;
    await this.openSheetByUuid(uuid);
  }

  async openSheetByUuid(uuid) {
    if (!game.user.isGM || !uuid) return;
    const actor = await resolveUuid(uuid);
    actor?.sheet.render({ force: true });
  }

  async sendToChatByUuid(uuid) {
    await postCreatureToChat({ uuid, sectionId: this.sectionId, viewer: PARTY_VIEWER });
  }

  openEntryEditor(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this.state.selectedUuid;
    if (uuid) this.openEntryEditorByUuid(uuid);
  }

  openEntryEditorByUuid(uuid) {
    new BestiaryEntryEditor({ sectionId: this.sectionId, uuid }).render({ force: true });
  }

  showCollectionMenu(event) {
    const section = getBestiaryData().sections.find((item) => item.id === this.sectionId);
    if (!section) return;
    const isHidden = !!section.hidden;
    const isLocked = !!section.locked;
    showContextMenu(event, [
      {
        label: localize("BESTIARY.Board.Title"),
        icon: "fa-table-cells",
        onClick: () => BestiaryKnowledgeBoard.open(this.sectionId),
      },
      {
        label: localize("BESTIARY.BulkResearch.Title"),
        icon: "fa-sliders",
        onClick: () => this.openBulkResearch(),
      },
      { separator: true },
      {
        label: localize("BESTIARY.EditSection"),
        icon: "fa-pen",
        onClick: () => new BestiaryTileEditor({ mode: "section", tileData: section }).render({ force: true }),
      },
      {
        label: localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
        icon: isHidden ? "fa-eye" : "fa-eye-slash",
        onClick: () =>
          runCommand({ type: BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY, sectionId: this.sectionId }),
      },
      {
        label: localize(isLocked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
        icon: isLocked ? "fa-lock-open" : "fa-lock",
        onClick: () =>
          runCommand({
            type: BESTIARY_COMMANDS.SET_SECTION_LOCK,
            sectionId: this.sectionId,
            locked: !isLocked,
          }),
      },
      {
        label: localize("BESTIARY.Transfer.ExportSection"),
        icon: "fa-file-export",
        onClick: () => this.exportSection(),
      },
      { separator: true },
      {
        label: localize("BESTIARY.DeleteSection"),
        icon: "fa-trash",
        danger: true,
        disabled: isLocked,
        onClick: async () => {
          const confirmed = await confirmDialog({
            title: localize("BESTIARY.DeleteSection"),
            yesLabel: localize("BESTIARY.DeleteSection"),
            content: `<p>${localize("BESTIARY.ConfirmDelete")}</p>`,
          });
          if (!confirmed) return;
          await runCommand(
            { type: BESTIARY_COMMANDS.DELETE_SECTION, sectionId: this.sectionId },
            { unchanged: "BESTIARY.Lock.Blocked" },
          );
        },
      },
    ]);
  }

  showFamilyMenu(event, familyId) {
    const section = getBestiaryData().sections.find((item) => item.id === this.sectionId);
    const family = section?.families.find((item) => item.id === familyId);
    if (!family) return;
    showContextMenu(event, [
      {
        label: localize("BESTIARY.Import.Title"),
        icon: "fa-layer-group",
        onClick: () => this.openBulkImport(familyId),
      },
      {
        label: localize("BESTIARY.BulkResearch.Title"),
        icon: "fa-sliders",
        onClick: () => this.openBulkResearch(familyId),
      },
      { separator: true },
      {
        label: localize("BESTIARY.Families.Edit"),
        icon: "fa-pen",
        onClick: () =>
          new BestiaryTileEditor({ mode: "family", sectionId: this.sectionId, tileData: family }).render({
            force: true,
          }),
      },
      {
        label: localize("BESTIARY.Families.Delete"),
        icon: "fa-trash",
        danger: true,
        onClick: () => this.deleteFamilyById(familyId),
      },
    ]);
  }

  showCreatureMenu(event, card) {
    const uuid = card.dataset.uuid;
    const isHidden = card.dataset.hidden === "true";
    const isLocked = card.dataset.locked === "true";
    const data = getBestiaryData();
    const section = data.sections.find((item) => item.id === this.sectionId);
    const families = selectVisibleFamilies(section, game.user);

    const items = [
      {
        label: localize("BESTIARY.ViewCreature"),
        icon: "fa-eye",
        onClick: () => this.openCreatureByUuid(uuid),
      },
      {
        label: localize("BESTIARY.OpenSheet"),
        icon: "fa-arrow-up-right-from-square",
        onClick: () => this.openSheetByUuid(uuid),
      },
      {
        label: localize("BESTIARY.SendToChatParty"),
        icon: "fa-message",
        onClick: () => this.sendToChatByUuid(uuid),
      },
      {
        label: localize("BESTIARY.Entry.Title"),
        icon: "fa-sliders",
        onClick: () => this.openEntryEditorByUuid(uuid),
      },
      {
        label: localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
        icon: isHidden ? "fa-eye" : "fa-eye-slash",
        onClick: () => this.toggleVisibilityByUuid(uuid),
      },
      {
        label: localize(isLocked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
        icon: isLocked ? "fa-lock-open" : "fa-lock",
        onClick: () => this.toggleLockByUuid(uuid, !isLocked),
      },
    ];

    if (families.length) {
      items.push({ separator: true });
      for (const family of families) {
        items.push({
          label: game.i18n.format("BESTIARY.Families.MoveTo", { name: family.name }),
          icon: "fa-folder-tree",
          onClick: () => this.moveToFamily(uuid, family.id),
        });
      }
      items.push({
        label: localize("BESTIARY.Families.MoveToNone"),
        icon: "fa-folder-minus",
        onClick: () => this.moveToFamily(uuid, null),
      });
    }

    items.push({ separator: true });
    items.push({
      label: localize("BESTIARY.Transfer.ExportEntry"),
      icon: "fa-file-export",
      onClick: () => exportCreatureEntry(this.sectionId, uuid),
    });
    items.push({
      label: localize("BESTIARY.RemoveCreature"),
      icon: "fa-trash",
      danger: true,
      onClick: () => this.removeByUuid(uuid),
    });
    showContextMenu(event, items);
  }

  createFamily() {
    new BestiaryTileEditor({ mode: "family", sectionId: this.sectionId }).render({ force: true });
  }

  editFamily(target) {
    const familyId = target.closest("[data-family-id]")?.dataset.familyId;
    const section = getBestiaryData().sections.find((item) => item.id === this.sectionId);
    const family = section?.families.find((item) => item.id === familyId);
    if (!family) return;
    new BestiaryTileEditor({ mode: "family", sectionId: this.sectionId, tileData: family }).render({
      force: true,
    });
  }

  deleteFamily(target) {
    const familyId = target.closest("[data-family-id]")?.dataset.familyId;
    if (familyId) return this.deleteFamilyById(familyId);
  }

  async deleteFamilyById(familyId) {
    const confirmed = await confirmDialog({
      title: localize("BESTIARY.Families.Delete"),
      yesLabel: localize("BESTIARY.Families.Delete"),
      content: `<p>${localize("BESTIARY.Families.ConfirmDelete")}</p>`,
    });
    if (!confirmed) return;
    await runCommand(
      {
        type: BESTIARY_COMMANDS.DELETE_FAMILY,
        sectionId: this.sectionId,
        familyId,
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
  }

  async toggleFamily(target) {
    const group = target.closest("[data-family-group]");
    const familyId = group?.dataset.familyGroup;
    if (!familyId) return;
    const collapsed = (await toggleCollapsedFamily(`${this.sectionId}:${familyId}`)).has(
      `${this.sectionId}:${familyId}`,
    );
    for (const element of this.element.querySelectorAll(`[data-family-group="${CSS.escape(familyId)}"]`)) {
      element.classList.toggle("is-collapsed", collapsed);
      element.querySelector(".family-toggle")?.setAttribute("aria-expanded", String(!collapsed));
      const icon = element.querySelector(".family-chevron");
      icon?.classList.toggle("fa-chevron-down", !collapsed);
      icon?.classList.toggle("fa-chevron-right", collapsed);
    }
  }

  async moveToFamily(uuid, familyId) {
    await runCommand({
      type: BESTIARY_COMMANDS.MOVE_CREATURE,
      sectionId: this.sectionId,
      uuid,
      targetFamilyId: familyId,
    });
  }

  openBulkImport(familyId = "") {
    if (!game.user.isGM) return;
    new BestiaryBulkImport({
      sectionId: this.sectionId,
      familyId: familyId === UNGROUPED_ID ? "" : familyId,
    }).render({ force: true });
  }

  openBulkResearch(familyId = null) {
    if (!game.user.isGM) return;
    new BestiaryBulkResearch({
      sectionId: this.sectionId,
      familyId: familyId === UNGROUPED_ID ? null : familyId,
    }).render({ force: true });
  }

  exportSection() {
    exportBestiary({ sectionIds: [this.sectionId] });
  }

  exportEntry(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this.state.selectedUuid;
    if (uuid) exportCreatureEntry(this.sectionId, uuid);
  }

  async _onDrop(event, familyId, acceptMove = true) {
    let dropData;
    try {
      dropData = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (dropData.type === "Folder") return this._onDropFolder(dropData, familyId);
    if (dropData.type !== "Actor") return;

    if (dropData.bestiarySource === this.sectionId) {
      if (acceptMove) await this.moveToFamily(dropData.uuid, familyId);
      return;
    }

    const actor = await resolveUuid(dropData.uuid);
    if (!actor || actor.type !== "npc") {
      ui.notifications.warn(localize("BESTIARY.OnlyNpcActors"));
      return;
    }
    const section = getBestiaryData().sections.find((item) => item.id === this.sectionId);
    if (!section) return;
    if (section.creatures?.some((entry) => entry.uuid === actor.uuid)) {
      ui.notifications.info(game.i18n.format("BESTIARY.AlreadyInCollection", { name: actor.name }));
      return;
    }

    const result = await runCommand(
      {
        type: BESTIARY_COMMANDS.ADD_CREATURE,
        sectionId: this.sectionId,
        familyId,
        uuid: actor.uuid,
        label: actor.name,
        thumb: actor.img,
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
    if (!result?.changed) return;
    ui.notifications.info(
      game.i18n.format("BESTIARY.AddedToCollection", {
        name: actor.name,
        collection: section.name,
      }),
    );
  }

  async _onDropFolder(dropData, familyId) {
    const folder = dropData.uuid ? await resolveUuid(dropData.uuid) : game.folders?.get(dropData.id);
    if (!folder || folder.type !== "Actor") return;
    const actors = folder.contents.filter((actor) => actor.type === "npc");
    if (!actors.length) {
      ui.notifications.warn(localize("BESTIARY.Import.FolderEmpty"));
      return;
    }
    const present = new Set(
      getBestiaryData()
        .sections.find((item) => item.id === this.sectionId)
        ?.creatures.map((entry) => entry.uuid) ?? [],
    );
    const fresh = actors.filter((actor) => !present.has(actor.uuid));
    if (!fresh.length) {
      ui.notifications.info(localize("BESTIARY.Import.NothingNew"));
      return;
    }
    const result = await runCommand(
      {
        type: BESTIARY_COMMANDS.ADD_CREATURES,
        sectionId: this.sectionId,
        familyId,
        entries: fresh.map((actor) => ({ uuid: actor.uuid, label: actor.name, thumb: actor.img })),
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
    if (result?.changed)
      ui.notifications.info(game.i18n.format("BESTIARY.Import.Done", { count: fresh.length }));
  }

  async removeCreature(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this.state.selectedUuid;
    if (uuid) await this.removeByUuid(uuid);
  }

  async removeByUuid(uuid) {
    const section = getBestiaryData().sections.find((item) => item.id === this.sectionId);
    if (section?.locked || section?.creatures.find((item) => item.uuid === uuid)?.locked) {
      ui.notifications.warn(localize("BESTIARY.Lock.Blocked"));
      return;
    }
    const confirmed = await confirmDialog({
      title: localize("BESTIARY.RemoveCreature"),
      yesLabel: localize("BESTIARY.RemoveCreature"),
      content: `<p>${localize("BESTIARY.ConfirmRemoveCreature")}</p>`,
    });
    if (!confirmed) return;
    await runCommand(
      {
        type: BESTIARY_COMMANDS.REMOVE_CREATURE,
        sectionId: this.sectionId,
        uuid,
      },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
  }

  async toggleCreatureVisibility(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? this.state.selectedUuid;
    if (uuid) await this.toggleVisibilityByUuid(uuid);
  }

  async toggleVisibilityByUuid(uuid) {
    await runCommand({
      type: BESTIARY_COMMANDS.TOGGLE_CREATURE_VISIBILITY,
      sectionId: this.sectionId,
      uuid,
    });
  }

  async toggleCreatureLock(event, target) {
    event.stopPropagation();
    const card = target.closest("[data-uuid]");
    if (!card) return;
    await this.toggleLockByUuid(card.dataset.uuid, card.dataset.locked !== "true");
  }

  async toggleLockByUuid(uuid, locked) {
    await runCommand({
      type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
      sectionId: this.sectionId,
      uuid,
      locked,
    });
  }
}
