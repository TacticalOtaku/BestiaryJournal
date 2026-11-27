import { BESTIARY_COMMANDS, selectVisibleFamilies, selectVisibleSections } from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge, getBestiarySocial } from "../foundry/bestiary-store.js";
import { buildNotesFeed, selectPartyNotes } from "./comments.js";
import { runCommand } from "../foundry/command-feedback.js";
import {
  getDismissedTipBanner,
  getLibraryViewMode,
  getShowOnboardingHints,
  setDismissedTipBanner,
  setLibraryViewMode,
  toggleFavoriteCreature,
} from "../foundry/client-preferences.js";
import { buildCreatureRows, rowInputs, summarizeRows } from "./creature-rows.js";
import { buildQuickTips } from "../core/guide-model.js";
import { ACCENTS, COVER_SIZES, DENSITIES, MOTION_LEVELS, THEMES } from "../core/theme.js";
import { MIN_RESEARCH_TIER } from "../core/research-model.js";
import { confirmDialog, localize, resolveUuid } from "../foundry/foundry-runtime.js";
import { BestiaryTileEditor } from "./tile-editor.js";
import { BestiaryTierSettings } from "./tier-settings.js";
import { BestiaryKnowledgeBoard } from "./knowledge-board.js";
import { BestiaryGuideApp, maybeShowFirstTimeGuide } from "./guide-app.js";
import { exportBestiary, importBestiaryFromFile } from "../foundry/transfer.js";
import { CollectionWorkspaceController, prepareCollectionContext } from "./collection-workspace.js";
import { playApplicationEntrance, showContextMenu } from "./ui-effects.js";
import { bindArtwork } from "./artwork.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "bestiary-journal";

const LIBRARY_VIEWS = ["overview", "all", "recent", "favorites", "notes"];
const RECENT_LIMIT = 24;
const CARD_DRAG_TYPE = "application/x-bestiary-card";

function buttonMenuEvent(target) {
  const bounds = target.getBoundingClientRect();
  return { target, currentTarget: target, clientX: bounds.left, clientY: bounds.bottom + 4 };
}

export class BestiaryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bestiary-main",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-main"],
    tag: "div",
    window: { title: "BESTIARY.Title", icon: "fa-solid fa-book-open", resizable: true, minimizable: true },
    position: { width: 1240, height: 800 },
    actions: {
      createSection: function () {
        this._onCreateSection();
      },
      openSection: function (event, target) {
        this._onOpenSection(event, target);
      },
      editSection: function (event, target) {
        this._onEditSection(event, target);
      },
      setLibraryView: function (event, target) {
        this._onSetLibraryView(event, target);
      },
      openCreature: function (event, target) {
        if (this._activeView === "collection") this._collection.openCreature(event, target);
        else this._onOpenCreature(event, target);
      },
      openCreatureNotes: function (event, target) {
        game.bestiaryJournal?.openCreature(target.dataset.uuid, { rail: "comments" });
      },
      openSheet: function (event, target) {
        if (this._activeView === "collection") this._collection.openSheet(event, target);
        else this._onOpenSheet(event, target);
      },
      toggleFavorite: function (event, target) {
        this._onToggleFavorite(event, target);
      },
      toggleCreatureLayout: function (event, target) {
        this._onToggleCreatureLayout(event, target);
      },
      clearSearch: function () {
        this._clearSearch();
      },
      openManageMenu: function (event, target) {
        this._onOpenManageMenu(event, target);
      },
      exportAll: function () {
        exportBestiary({});
      },
      importSnapshot: function () {
        importBestiaryFromFile();
      },
      openTierSettings: function () {
        new BestiaryTierSettings().render({ force: true });
      },
      openKnowledgeBoard: function () {
        BestiaryKnowledgeBoard.open(this._activeView === "collection" ? this._activeSectionId : "");
      },
      toggleLookDrawer: function () {
        this._onToggleLookDrawer();
      },
      setLook: function (event, target) {
        this._onSetLook(target);
      },
      openGuide: function (event, target) {
        BestiaryGuideApp.open({ tab: target?.dataset?.tab || "quickstart" });
      },
      nextTip: function () {
        this._onStepTip(1);
      },
      prevTip: function () {
        this._onStepTip(-1);
      },
      dismissTipBanner: async function () {
        await setDismissedTipBanner(true);
        await this.render();
      },
      toggleView: function (event, target) {
        this._collection.toggleView(target.dataset.viewMode);
      },
      toggleFilters: function () {
        this._collection.toggleFilters();
      },
      resetFilters: function () {
        this._collection.resetFilters();
      },
      selectCreature: function (event, target) {
        this._collection.selectCreature(event, target);
      },
      closePreview: function () {
        this._collection.closePreview();
      },
      toggleFamily: function (event, target) {
        this._collection.toggleFamily(target);
      },
      createFamily: function () {
        this._collection.createFamily();
      },
      editFamily: function (event, target) {
        this._collection.editFamily(target);
      },
      deleteFamily: function (event, target) {
        this._collection.deleteFamily(target);
      },
      focusFamily: function (event, target) {
        const familyId = target.closest("[data-family-id]")?.dataset.familyId;
        if (familyId) this._collection.focusFamily(familyId);
      },
      openCollectionMenu: function (event, target) {
        event.stopPropagation();
        this._collection.showCollectionMenu(buttonMenuEvent(target));
      },
      openFamilyMenu: function (event, target) {
        event.stopPropagation();
        const familyId = target.closest("[data-family-id]")?.dataset.familyId;
        if (familyId) this._collection.showFamilyMenu(buttonMenuEvent(target), familyId);
      },
      openBulkImport: function (event, target) {
        this._collection.openBulkImport(target.dataset.familyId || "");
      },
      openBulkResearch: function (event, target) {
        this._collection.openBulkResearch(target.dataset.familyId || null);
      },
      exportSection: function () {
        this._collection.exportSection();
      },
      exportEntry: function (event, target) {
        this._collection.exportEntry(event, target);
      },
      removeCreature: function (event, target) {
        this._collection.removeCreature(event, target);
      },
      toggleCreatureVisibility: function (event, target) {
        this._collection.toggleCreatureVisibility(event, target);
      },
      toggleCreatureLock: function (event, target) {
        this._collection.toggleCreatureLock(event, target);
      },
      openEntryEditor: function (event, target) {
        this._collection.openEntryEditor(event, target);
      },
      setPreviewPartyTier: function (event, target) {
        this._collection.setPartyTier(target.dataset.tier);
      },
      clearCollectionSearch: function () {
        this._collection.clearSearch();
      },
      resetCollectionView: function () {
        this._collection.resetAllFiltering();
      },
    },
  };

  static PARTS = {
    main: {
      template: "modules/bestiary-journal/templates/bestiary-main.hbs",
      scrollable: [
        ".library-scroll",
        ".library-collection-nav",
        ".collection-results-scroll",
        ".filter-panel-scroll",
      ],
    },
  };

  constructor(options = {}) {
    super(options);
    this._activeView = "overview";
    this._activeSectionId = null;
    this._creatureLayout = getLibraryViewMode();
    this._searchQuery = "";
    this._tipIndex = 0;
    this._collection = new CollectionWorkspaceController(this, null);
  }

  async openCollection(sectionId) {
    if (!sectionId) return this;
    this._activeView = "collection";
    this._activeSectionId = sectionId;
    this._collection.setSection(sectionId);
    await this.render({ force: true });
    if (this.minimized) await this.maximize?.();
    this.bringToFront?.();
    return this;
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const isGM = game.user.isGM;
    const visibleSections = selectVisibleSections(data, game.user);
    if (this._activeView === "collection" && !visibleSections.some((s) => s.id === this._activeSectionId)) {
      this._activeView = "overview";
      this._activeSectionId = null;
    }

    const inputs = await rowInputs(visibleSections, { data, knowledge });
    const sections = this._buildSectionCards(visibleSections, inputs);
    const creatures = buildCreatureRows(visibleSections, inputs);
    const byDate = creatures.toSorted((a, b) => b.addedAt - a.addedAt);
    const favoriteCreatures = byDate.filter((creature) => creature.isFavorite);
    const isCollection = this._activeView === "collection";
    const displayed = isCollection
      ? []
      : {
          overview: creatures,
          all: creatures,
          recent: byDate.slice(0, RECENT_LIMIT),
          favorites: favoriteCreatures,
          notes: [],
        }[this._activeView];

    const collection = isCollection
      ? await prepareCollectionContext({
          sectionId: this._activeSectionId,
          state: this._collection.state,
          inputs,
        })
      : null;

    // Notes are named as the viewer knows each creature; only open creatures take part.
    const viewer = { id: game.user.id, isGM };
    const names = new Map(creatures.map((creature) => [creature.uuid, creature.name]));
    const social = getBestiarySocial();
    const notes = this._activeView === "notes" ? await buildNotesFeed(social, viewer, names) : [];

    return {
      sections,
      recentCreatures: byDate.slice(0, 8),
      displayedCreatures: displayed,
      totalCreatures: creatures.length,
      favoriteCount: favoriteCreatures.length,
      notes,
      notesCount: selectPartyNotes(social, viewer, names).length,
      collectionCount: sections.length,
      knownCount: creatures.filter((creature) => creature.viewerTier > MIN_RESEARCH_TIER).length,
      activeView: this._activeView,
      isOverview: this._activeView === "overview",
      isAll: this._activeView === "all",
      isRecent: this._activeView === "recent",
      isFavorites: this._activeView === "favorites",
      isNotes: this._activeView === "notes",
      isCollection,
      collection,
      look: this._buildLook(),
      lookOpen: !!this._lookOpen,
      viewTitle: isCollection
        ? collection?.sectionName || localize("BESTIARY.Title")
        : localize(
            {
              all: "BESTIARY.AllCreatures",
              recent: "BESTIARY.Recent",
              favorites: "BESTIARY.Favorites",
              notes: "BESTIARY.Notes.Title",
            }[this._activeView] ?? "BESTIARY.Title",
          ),
      creatureLayout: this._creatureLayout,
      isGrid: this._creatureLayout === "grid",
      isGM,
      noSections: sections.length === 0,
      tipBanner: this._buildTipBanner(isGM),
      emptyState: isCollection || displayed.length ? null : this._emptyState(isGM, sections.length),
    };
  }

  _buildTipBanner(isGM) {
    if (this._activeView !== "overview") return null;
    if (!getShowOnboardingHints() || getDismissedTipBanner()) return null;
    const tips = buildQuickTips({ isGM });
    if (!tips.length) return null;
    const idx = ((this._tipIndex % tips.length) + tips.length) % tips.length;
    const tip = tips[idx];
    return {
      icon: tip.icon,
      title: localize(tip.titleKey),
      body: localize(tip.bodyKey),
      tab: tip.tab,
      indexLabel: `${idx + 1}/${tips.length}`,
    };
  }

  _onStepTip(delta) {
    this._tipIndex += delta;
    this.render();
  }

  /** What an empty list says, and the one step that fills it. */
  _emptyState(isGM, sectionCount) {
    if (this._activeView === "favorites") {
      return {
        icon: "fa-regular fa-star",
        title: "BESTIARY.Empty.FavoritesTitle",
        hint: "BESTIARY.Empty.FavoritesHint",
      };
    }
    if (!isGM)
      return {
        icon: "fa-solid fa-dragon",
        title: "BESTIARY.Empty.LibraryTitle",
        hint: "BESTIARY.Empty.LibraryHintPlayer",
      };
    const action = sectionCount
      ? {
          name: "setLibraryView",
          view: "overview",
          icon: "fa-solid fa-layer-group",
          label: "BESTIARY.AllCollections",
        }
      : { name: "createSection", icon: "fa-solid fa-plus", label: "BESTIARY.NewCollection" };
    return {
      icon: "fa-solid fa-dragon",
      title: "BESTIARY.Empty.LibraryTitle",
      hint: "BESTIARY.Empty.LibraryHintGM",
      action,
    };
  }

  _buildSectionCards(visibleSections, inputs) {
    return visibleSections.map((section) => {
      const rows = buildCreatureRows([section], inputs);
      // A player sees their own progress; the GM sees the party's, at the tier every player has reached.
      const { count, progress } = summarizeRows(rows);
      const updatedAt = Math.max(section.updatedAt ?? 0, ...rows.map((row) => row.addedAt));
      return {
        ...section,
        creatureCount: count,
        familyCount: selectVisibleFamilies(section, inputs.viewer).length,
        progress: progress
          ? { ...progress, label: game.i18n.format("BESTIARY.Progress.Known", progress) }
          : null,
        isHidden: !!section.hidden,
        isLocked: !!section.locked,
        isActive: this._activeView === "collection" && section.id === this._activeSectionId,
        searchText: section.name.toLocaleLowerCase(),
        updatedLabel: updatedAt ? new Date(updatedAt).toLocaleDateString(game.i18n.lang) : "",
      };
    });
  }

  // ── Rendering ──

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // The outer element survives re-renders, so bind element-level listeners once.
    this.element.addEventListener("keydown", (event) => this._onShellKeydown(event));
    this.element.addEventListener("drop", () => this._collection.clearDragState(), true);
    this.element.addEventListener("dragend", () => this._collection.clearDragState(), true);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._disposeArtwork?.();
    this._activateSectionContextMenus();
    if (context.isCollection) {
      this._collection.activate({ missing: context.collection?.missing });
    } else {
      this._activateSearch();
      this._activateCreatureCards();
    }
    playApplicationEntrance(this, ".bestiary-shell");
    this._disposeArtwork = bindArtwork(this.element);
    maybeShowFirstTimeGuide(this);
  }

  _onClose(options) {
    this._disposeArtwork?.();
    super._onClose(options);
  }

  async refreshFromExternalUpdate(payload = {}) {
    const changed = payload.changed ?? {};
    if (
      changed.data ||
      changed.knowledge ||
      changed.creatures ||
      changed.seen ||
      changed.social ||
      changed.settings
    )
      await this.render();
  }

  _onShellKeydown(event) {
    if (this._activeView === "collection") {
      this._collection.handleKeydown(event);
      return;
    }
    const input = this.element.querySelector(".library-search-input");
    if (!input) return;
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      input.focus();
    } else if (event.key === "Escape" && input.value) {
      event.preventDefault();
      event.stopPropagation();
      this._clearSearch();
    }
  }

  _activateSearch() {
    const input = this.element.querySelector(".library-search-input");
    if (!input) return;
    input.value = this._searchQuery;
    input.addEventListener("input", () => {
      this._searchQuery = input.value.trim().toLocaleLowerCase();
      this._applySearch();
    });
    this._applySearch();
  }

  _applySearch() {
    const query = this._searchQuery;
    for (const element of this.element.querySelectorAll("[data-search-text]")) {
      const text = (element.dataset.searchText ?? "").toLocaleLowerCase();
      element.classList.toggle("is-filtered-out", !!query && !text.includes(query));
    }
    this.element.querySelector(".library-search-clear")?.classList.toggle("is-visible", !!query);
    this.element.querySelector(".library-scroll")?.classList.toggle("is-searching", !!query);
    const results = this.element.querySelector(".library-search-results, .library-creature-results");
    if (results) {
      const cards = results.querySelectorAll(".creature-card");
      const shown = [...cards].filter((card) => !card.classList.contains("is-filtered-out")).length;
      // An empty list has its own message; this one is only for a query that hides every card.
      results.classList.toggle("is-empty", !!query && cards.length > 0 && shown === 0);
    }
    const notesFeed = this.element.querySelector(".library-notes-feed");
    if (notesFeed) {
      const items = notesFeed.querySelectorAll(".notes-feed-item");
      const shownNotes = [...items].filter((item) => !item.classList.contains("is-filtered-out")).length;
      notesFeed.classList.toggle("is-empty", !!query && items.length > 0 && shownNotes === 0);
    }
  }

  _clearSearch() {
    const input = this.element?.querySelector(".library-search-input");
    if (!input) return;
    input.value = "";
    this._searchQuery = "";
    this._applySearch();
    input.focus();
  }

  _activateCreatureCards() {
    for (const card of this.element.querySelectorAll("[data-uuid][draggable='true']")) {
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: card.dataset.uuid }));
        event.dataTransfer.setData(CARD_DRAG_TYPE, card.dataset.uuid);
      });
    }
  }

  _activateSectionContextMenus() {
    if (!game.user.isGM) return;
    for (const tile of this.element.querySelectorAll(
      ".collection-card[data-section-id], .library-nav-item[data-section-id]",
    )) {
      tile.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this._showSectionMenu(event, tile.dataset.sectionId, {
          isHidden: tile.dataset.hidden === "true",
          isLocked: tile.dataset.locked === "true",
        });
      });
    }
  }

  _showSectionMenu(event, sectionId, { isHidden, isLocked }) {
    showContextMenu(event, [
      {
        label: localize("BESTIARY.EditSection"),
        icon: "fa-pen",
        onClick: () => this._editSectionById(sectionId),
      },
      {
        label: localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
        icon: isHidden ? "fa-eye" : "fa-eye-slash",
        onClick: () => runCommand({ type: BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY, sectionId }),
      },
      {
        label: localize(isLocked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
        icon: isLocked ? "fa-lock-open" : "fa-lock",
        onClick: () => runCommand({ type: BESTIARY_COMMANDS.SET_SECTION_LOCK, sectionId, locked: !isLocked }),
      },
      { separator: true },
      {
        label: localize("BESTIARY.Transfer.ExportSection"),
        icon: "fa-file-export",
        onClick: () => exportBestiary({ sectionIds: [sectionId] }),
      },
      {
        label: localize("BESTIARY.DeleteSection"),
        icon: "fa-trash",
        danger: true,
        disabled: isLocked,
        onClick: () => this._deleteSectionById(sectionId),
      },
    ]);
  }

  // ── Actions ──

  /** The look drawer's choices, AIM's settings drawer: theme, accent, density, motion; «Как в AIM» only with AIM on. */
  _buildLook() {
    const choices = (key, values, prefix) =>
      values.map((value) => ({
        key,
        value,
        label: localize(`BESTIARY.Settings.${prefix}_${value}`),
        active: game.settings.get(MODULE_ID, key) === value,
      }));
    const aimActive = !!game.modules.get("actor-inventory-manager")?.active;
    return {
      themes: choices(
        "uiTheme",
        THEMES.filter((theme) => theme !== "aim" || aimActive),
        "Theme",
      ),
      accents: choices("uiAccent", ACCENTS, "Accent"),
      densities: choices("uiDensity", DENSITIES, "Density"),
      coverSizes: choices("uiCoverSize", COVER_SIZES, "CoverSize"),
      motions: choices("uiMotion", MOTION_LEVELS, "Motion"),
    };
  }

  _onToggleLookDrawer() {
    this._lookOpen = !this._lookOpen;
    this.element.querySelector(".look-drawer")?.classList.toggle("is-open", this._lookOpen);
  }

  /** Applies at once: the setting's onChange restamps every open window; only the drawer's marks move here. */
  async _onSetLook(target) {
    const { key, value } = target.dataset;
    await game.settings.set(MODULE_ID, key, value);
    for (const option of this.element.querySelectorAll(`[data-action="setLook"][data-key="${key}"]`)) {
      option.classList.toggle("is-active", option.dataset.value === value);
      option.setAttribute("aria-pressed", String(option.dataset.value === value));
    }
  }

  _onSetLibraryView(event, target) {
    const view = target.dataset.libraryView;
    if (!LIBRARY_VIEWS.includes(view)) return;
    this._activeView = view;
    this._activeSectionId = null;
    this.render();
  }

  _onOpenManageMenu(event, target) {
    if (!game.user.isGM) return;
    showContextMenu(buttonMenuEvent(target), [
      {
        label: localize("BESTIARY.Tier.WorldTitle"),
        icon: "fa-stairs",
        onClick: () => new BestiaryTierSettings().render({ force: true }),
      },
      { separator: true },
      {
        label: localize("BESTIARY.Transfer.Import"),
        icon: "fa-file-import",
        onClick: () => importBestiaryFromFile(),
      },
      {
        label: localize("BESTIARY.Transfer.ExportAll"),
        icon: "fa-file-export",
        onClick: () => exportBestiary({}),
      },
    ]);
  }

  async _onToggleCreatureLayout(event, target) {
    const layout = target.dataset.layout;
    if (!["grid", "list"].includes(layout)) return;
    this._creatureLayout = layout;
    await setLibraryViewMode(layout);
    for (const grid of this.element.querySelectorAll(".library-creature-grid:not(.is-search-grid)")) {
      grid.classList.toggle("is-list", layout === "list");
    }
    for (const button of this.element.querySelectorAll("[data-layout]")) {
      const active = button.dataset.layout === layout;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  _onCreateSection() {
    new BestiaryTileEditor({ mode: "section" }).render({ force: true });
  }

  _onOpenSection(event, target) {
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this.openCollection(sectionId);
  }

  _onOpenCreature(event, target) {
    if (event.target?.closest?.(".creature-card-quick")) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (uuid) game.bestiaryJournal?.openCreature(uuid);
  }

  async _onOpenSheet(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const actor = uuid ? await resolveUuid(uuid) : null;
    actor?.sheet.render({ force: true });
  }

  async _onToggleFavorite(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    await toggleFavoriteCreature(uuid);
    this.render();
  }

  _onEditSection(event, target) {
    event.stopPropagation();
    const tile = target.closest("[data-section-id]");
    if (!tile) return;
    // The "…" button opens the same menu as a right click.
    this._showSectionMenu(buttonMenuEvent(target), tile.dataset.sectionId, {
      isHidden: tile.dataset.hidden === "true",
      isLocked: tile.dataset.locked === "true",
    });
  }

  _editSectionById(sectionId) {
    const section = getBestiaryData().sections.find((item) => item.id === sectionId);
    if (!section) return;
    new BestiaryTileEditor({ mode: "section", tileData: section }).render({ force: true });
  }

  async _deleteSectionById(sectionId) {
    const confirmed = await confirmDialog({
      title: localize("BESTIARY.DeleteSection"),
      yesLabel: localize("BESTIARY.DeleteSection"),
      content: `<p>${localize("BESTIARY.ConfirmDelete")}</p>`,
    });
    if (!confirmed) return;
    await runCommand(
      { type: BESTIARY_COMMANDS.DELETE_SECTION, sectionId },
      { unchanged: "BESTIARY.Lock.Blocked" },
    );
  }
}
