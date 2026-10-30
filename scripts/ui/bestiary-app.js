import {
  BESTIARY_COMMANDS,
  selectVisibleFamilies,
  selectVisibleSections
} from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge, getBestiarySocial } from "../foundry/bestiary-store.js";
import { buildNotesFeed, selectPartyNotes } from "./comments.js";
import { runCommand } from "../foundry/command-feedback.js";
import {
  getLibraryViewMode,
  setLibraryViewMode,
  toggleFavoriteCreature
} from "../foundry/client-preferences.js";
import { buildCreatureRows, rowInputs, summarizeRows } from "./creature-rows.js";
import { ACCENTS, DENSITIES, MOTION_LEVELS, THEMES } from "../core/theme.js";
import { MIN_RESEARCH_TIER } from "../core/research-model.js";
import { localize, resolveUuid } from "../foundry/foundry-runtime.js";
import { BestiaryTileEditor } from "./tile-editor.js";
import { BestiarySectionView } from "./section-view.js";
import { BestiaryTierSettings } from "./tier-settings.js";
import { BestiaryKnowledgeBoard } from "./knowledge-board.js";
import { exportBestiary, importBestiaryFromFile } from "../foundry/transfer.js";
import { playApplicationEntrance, showContextMenu } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "bestiary-journal";

const LIBRARY_VIEWS = ["overview", "all", "recent", "favorites", "notes"];
const RECENT_LIMIT = 24;
const CARD_DRAG_TYPE = "application/x-bestiary-card";

export class BestiaryApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-main",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-main"],
    tag: "div",
    window: { title: "BESTIARY.Title", icon: "fa-solid fa-book-open", resizable: true, minimizable: true },
    position: { width: 1240, height: 800 },
    actions: {
      createSection: function () { this._onCreateSection(); },
      openSection: function (event, target) { this._onOpenSection(event, target); },
      editSection: function (event, target) { this._onEditSection(event, target); },
      setLibraryView: function (event, target) { this._onSetLibraryView(event, target); },
      openCreature: function (event, target) { this._onOpenCreature(event, target); },
      openCreatureNotes: function (event, target) { game.bestiaryJournal?.openCreature(target.dataset.uuid, { rail: "comments" }); },
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      toggleFavorite: function (event, target) { this._onToggleFavorite(event, target); },
      toggleCreatureLayout: function (event, target) { this._onToggleCreatureLayout(event, target); },
      clearSearch: function () { this._clearSearch(); },
      exportAll: function () { exportBestiary({}); },
      importSnapshot: function () { importBestiaryFromFile(); },
      openTierSettings: function () { new BestiaryTierSettings().render({ force: true }); },
      openKnowledgeBoard: function () { BestiaryKnowledgeBoard.open(); },
      toggleLookDrawer: function () { this._onToggleLookDrawer(); },
      setLook: function (event, target) { this._onSetLook(target); }
    }
  };

  static PARTS = {
    main: { template: "modules/bestiary-journal/templates/bestiary-main.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this._activeView = "overview";
    this._creatureLayout = getLibraryViewMode();
    this._searchQuery = "";
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const isGM = game.user.isGM;
    const visibleSections = selectVisibleSections(data, isGM);
    const inputs = await rowInputs(visibleSections, { data, knowledge });
    const sections = this._buildSectionCards(visibleSections, inputs);
    const creatures = buildCreatureRows(visibleSections, inputs);
    const byDate = [...creatures].sort((a, b) => b.addedAt - a.addedAt);
    const favoriteCreatures = byDate.filter(creature => creature.isFavorite);
    const displayed = {
      overview: creatures,
      all: creatures,
      recent: byDate.slice(0, RECENT_LIMIT),
      favorites: favoriteCreatures,
      notes: []
    }[this._activeView];
    // Notes are named as the viewer knows each creature; only open creatures take part.
    const viewer = { id: game.user.id, isGM };
    const names = new Map(creatures.map(creature => [creature.uuid, creature.name]));
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
      knownCount: creatures.filter(creature => creature.viewerTier > MIN_RESEARCH_TIER).length,
      activeView: this._activeView,
      isOverview: this._activeView === "overview",
      isAll: this._activeView === "all",
      isRecent: this._activeView === "recent",
      isFavorites: this._activeView === "favorites",
      isNotes: this._activeView === "notes",
      look: this._buildLook(),
      lookOpen: !!this._lookOpen,
      viewTitle: localize({
        all: "BESTIARY.AllCreatures",
        recent: "BESTIARY.Recent",
        favorites: "BESTIARY.Favorites",
        notes: "BESTIARY.Notes.Title"
      }[this._activeView] ?? "BESTIARY.Title"),
      creatureLayout: this._creatureLayout,
      isGrid: this._creatureLayout === "grid",
      isGM,
      noSections: sections.length === 0,
      emptyState: displayed.length ? null : this._emptyState(isGM, sections.length)
    };
  }

  /** What an empty list says, and the one step that fills it. */
  _emptyState(isGM, sectionCount) {
    if (this._activeView === "favorites") {
      return { icon: "fa-regular fa-star", title: "BESTIARY.Empty.FavoritesTitle", hint: "BESTIARY.Empty.FavoritesHint" };
    }
    if (!isGM) return { icon: "fa-solid fa-dragon", title: "BESTIARY.Empty.LibraryTitle", hint: "BESTIARY.Empty.LibraryHintPlayer" };
    const action = sectionCount
      ? { name: "setLibraryView", view: "overview", icon: "fa-solid fa-layer-group", label: "BESTIARY.AllCollections" }
      : { name: "createSection", icon: "fa-solid fa-plus", label: "BESTIARY.NewCollection" };
    return { icon: "fa-solid fa-dragon", title: "BESTIARY.Empty.LibraryTitle", hint: "BESTIARY.Empty.LibraryHintGM", action };
  }

  _buildSectionCards(visibleSections, inputs) {
    return visibleSections.map(section => {
      const rows = buildCreatureRows([section], inputs);
      // A player sees their own progress; the GM sees the party's, at the tier every player has reached.
      const { count, progress } = summarizeRows(rows);
      const updatedAt = Math.max(section.updatedAt ?? 0, ...rows.map(row => row.addedAt));
      return {
        ...section,
        creatureCount: count,
        familyCount: selectVisibleFamilies(section, inputs.viewer.isGM).length,
        progress: progress ? { ...progress, label: game.i18n.format("BESTIARY.Progress.Known", progress) } : null,
        isHidden: !!section.hidden,
        isLocked: !!section.locked,
        searchText: section.name.toLocaleLowerCase(),
        updatedLabel: updatedAt
          ? new Date(updatedAt).toLocaleDateString(game.i18n.lang)
          : ""
      };
    });
  }

  // ── Rendering ──

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // The outer element survives re-renders, so bind element-level keys once.
    this.element.addEventListener("keydown", event => this._onShellKeydown(event));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateSearch();
    this._activateContextMenus();
    this._activateCreatureCards();
    playApplicationEntrance(this, ".bestiary-shell");
  }

  async refreshFromExternalUpdate(payload = {}) {
    const changed = payload.changed ?? {};
    if (changed.data || changed.knowledge || changed.creatures || changed.seen || changed.social) await this.render();
  }

  _onShellKeydown(event) {
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
      element.classList.toggle("is-filtered-out", !!query && !element.dataset.searchText.includes(query));
    }
    this.element.querySelector(".library-search-clear")?.classList.toggle("is-visible", !!query);
    this.element.querySelector(".library-scroll")?.classList.toggle("is-searching", !!query);
    const results = this.element.querySelector(".library-search-results, .library-creature-results");
    if (results) {
      const cards = results.querySelectorAll(".library-creature-card");
      const shown = [...cards].filter(card => !card.classList.contains("is-filtered-out")).length;
      // An empty list has its own message; this one is only for a query that hides every card.
      results.classList.toggle("is-empty", !!query && cards.length > 0 && shown === 0);
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
      card.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: card.dataset.uuid }));
        event.dataTransfer.setData(CARD_DRAG_TYPE, card.dataset.uuid);
      });
    }
    for (const card of this.element.querySelectorAll("[data-action='openSection'][tabindex], [data-action='openCreature'][tabindex]")) {
      card.addEventListener("keydown", event => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          card.click();
        }
      });
    }
  }

  _activateContextMenus() {
    if (!game.user.isGM) return;
    for (const tile of this.element.querySelectorAll(".collection-card[data-section-id]")) {
      tile.addEventListener("contextmenu", event => {
        event.preventDefault();
        this._showSectionMenu(event, tile.dataset.sectionId, {
          isHidden: tile.dataset.hidden === "true",
          isLocked: tile.dataset.locked === "true"
        });
      });
    }
  }

  _showSectionMenu(event, sectionId, { isHidden, isLocked }) {
    showContextMenu(event, [
      { name: localize("BESTIARY.EditSection"), icon: "fa-pen", callback: () => this._editSectionById(sectionId) },
      {
        name: localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
        icon: isHidden ? "fa-eye" : "fa-eye-slash",
        callback: () => runCommand({ type: BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY, sectionId })
      },
      {
        name: localize(isLocked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
        icon: isLocked ? "fa-lock-open" : "fa-lock",
        callback: () => runCommand({ type: BESTIARY_COMMANDS.SET_SECTION_LOCK, sectionId, locked: !isLocked })
      },
      { separator: true },
      {
        name: localize("BESTIARY.Transfer.ExportSection"),
        icon: "fa-file-export",
        callback: () => exportBestiary({ sectionIds: [sectionId] })
      },
      {
        name: localize("BESTIARY.DeleteSection"),
        icon: "fa-trash",
        danger: true,
        disabled: isLocked,
        callback: () => this._deleteSectionById(sectionId)
      }
    ]);
  }

  // ── Actions ──

  /** The look drawer's choices, AIM's settings drawer: theme, accent, density, motion; «Как в AIM» only with AIM on. */
  _buildLook() {
    const choices = (key, values, prefix) => values.map(value => ({
      key, value, label: localize(`BESTIARY.Settings.${prefix}_${value}`), active: game.settings.get(MODULE_ID, key) === value
    }));
    const aimActive = !!game.modules.get("actor-inventory-manager")?.active;
    return {
      themes: choices("uiTheme", THEMES.filter(theme => theme !== "aim" || aimActive), "Theme"),
      accents: choices("uiAccent", ACCENTS, "Accent"),
      densities: choices("uiDensity", DENSITIES, "Density"),
      motions: choices("uiMotion", MOTION_LEVELS, "Motion")
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
    this.render();
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
      button.classList.toggle("is-active", button.dataset.layout === layout);
    }
  }

  _onCreateSection() {
    new BestiaryTileEditor({ mode: "section" }).render({ force: true });
  }

  _onOpenSection(event, target) {
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (!sectionId) return;
    this.close();
    new BestiarySectionView({ sectionId }).render({ force: true });
  }

  _onOpenCreature(event, target) {
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
    const bounds = target.getBoundingClientRect();
    this._showSectionMenu({ clientX: bounds.left, clientY: bounds.bottom + 4 }, tile.dataset.sectionId, {
      isHidden: tile.dataset.hidden === "true",
      isLocked: tile.dataset.locked === "true"
    });
  }

  _editSectionById(sectionId) {
    const section = getBestiaryData().sections.find(item => item.id === sectionId);
    if (!section) return;
    new BestiaryTileEditor({ mode: "section", tileData: section }).render({ force: true });
  }

  async _deleteSectionById(sectionId) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.DeleteSection") },
      yes: { label: localize("BESTIARY.DeleteSection") },
      no: { label: localize("BESTIARY.Cancel") },
      content: `<p>${localize("BESTIARY.ConfirmDelete")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await runCommand({ type: BESTIARY_COMMANDS.DELETE_SECTION, sectionId }, { unchanged: "BESTIARY.Lock.Blocked" });
  }
}
