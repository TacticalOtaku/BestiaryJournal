import {
  BESTIARY_COMMANDS,
  getUserTier,
  mergeCreatureEntries,
  selectVisibleCreatureEntries,
  selectVisibleFamilies,
  selectVisibleSections
} from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { runCommand } from "../foundry/command-feedback.js";
import {
  getFavoriteCreatureUuids,
  getLibraryViewMode,
  setLibraryViewMode,
  toggleFavoriteCreature
} from "../foundry/client-preferences.js";
import { buildCreatureCard } from "./creature-cards.js";
import { getCreatureDataMany } from "../foundry/creature-cache.js";
import { buildPartyBadge } from "./knowledge-ui.js";
import { GM_TIER, MIN_RESEARCH_TIER } from "../core/research-model.js";
import { describeTier } from "../foundry/research.js";
import { getPlayerUsers, localize, resolveUuid } from "../foundry/foundry-runtime.js";
import { BestiaryTileEditor } from "./tile-editor.js";
import { BestiarySectionView } from "./section-view.js";
import { BestiaryTierSettings } from "./tier-settings.js";
import { exportBestiary, importBestiaryFromFile } from "../foundry/transfer.js";
import { playApplicationEntrance, showContextMenu } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LIBRARY_VIEWS = ["overview", "all", "recent", "favorites"];
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
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      toggleFavorite: function (event, target) { this._onToggleFavorite(event, target); },
      toggleCreatureLayout: function (event, target) { this._onToggleCreatureLayout(event, target); },
      clearSearch: function () { this._clearSearch(); },
      exportAll: function () { exportBestiary({}); },
      importSnapshot: function () { importBestiaryFromFile(); },
      openTierSettings: function () { new BestiaryTierSettings().render({ force: true }); }
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
    const sections = this._buildSectionCards(visibleSections, isGM);
    const creatures = await this._resolveLibraryCreatures(visibleSections, knowledge, isGM);
    const byDate = [...creatures].sort((a, b) => b.addedAt - a.addedAt);
    const favoriteCreatures = byDate.filter(creature => creature.isFavorite);
    const displayed = {
      overview: creatures,
      all: creatures,
      recent: byDate.slice(0, RECENT_LIMIT),
      favorites: favoriteCreatures
    }[this._activeView];

    return {
      sections,
      recentCreatures: byDate.slice(0, 8),
      displayedCreatures: displayed,
      totalCreatures: creatures.length,
      favoriteCount: favoriteCreatures.length,
      collectionCount: sections.length,
      knownCount: creatures.filter(creature => creature.viewerTier > MIN_RESEARCH_TIER).length,
      activeView: this._activeView,
      isOverview: this._activeView === "overview",
      isAll: this._activeView === "all",
      isRecent: this._activeView === "recent",
      isFavorites: this._activeView === "favorites",
      viewTitle: localize({
        all: "BESTIARY.AllCreatures",
        recent: "BESTIARY.Recent",
        favorites: "BESTIARY.Favorites"
      }[this._activeView] ?? "BESTIARY.Title"),
      creatureLayout: this._creatureLayout,
      isGrid: this._creatureLayout === "grid",
      isGM,
      noSections: sections.length === 0,
      noCreatures: displayed.length === 0
    };
  }

  _buildSectionCards(visibleSections, isGM) {
    return visibleSections.map(section => {
      const entries = selectVisibleCreatureEntries(section, isGM);
      const families = selectVisibleFamilies(section, isGM);
      const updatedAt = Math.max(
        section.updatedAt ?? 0,
        ...entries.map(entry => entry.addedAt ?? 0)
      );
      return {
        ...section,
        creatureCount: entries.length,
        familyCount: families.length,
        displayImage: section.image || "icons/svg/book.svg",
        isHidden: !!section.hidden,
        isLocked: !!section.locked,
        searchText: section.name.toLocaleLowerCase(),
        updatedLabel: updatedAt
          ? new Date(updatedAt).toLocaleDateString(game.i18n.lang)
          : ""
      };
    });
  }

  async _resolveLibraryCreatures(visibleSections, knowledge, isGM) {
    const favorites = getFavoriteCreatureUuids();
    const players = isGM ? getPlayerUsers() : [];
    const merged = mergeCreatureEntries(visibleSections, isGM);
    const resolved = await getCreatureDataMany(merged.map(item => item.uuid));
    const creatures = [];

    for (const item of merged) {
      const creature = resolved.get(item.uuid);
      if (!creature) continue;
      const viewerTier = isGM ? GM_TIER : getUserTier(knowledge, game.user.id, item.uuid);
      creatures.push({
        ...buildCreatureCard({
          uuid: item.uuid,
          entry: item.entry,
          creature,
          viewerTier,
          searchExtra: item.collections
        }),
        addedAt: item.addedAt,
        collectionLabel: item.collections.join(", "),
        isFavorite: favorites.has(item.uuid),
        viewerTier,
        tierBadge: isGM ? buildPartyBadge(knowledge, item.uuid, players) : describeTier(viewerTier)
      });
    }
    // Known names alphabetically, creatures the viewer cannot name last.
    creatures.sort((a, b) => (!a.sortName - !b.sortName) || a.sortName.localeCompare(b.sortName));
    return creatures;
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
    if (changed.data || changed.knowledge) await this.render();
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
    const results = this.element.querySelector(".library-search-results");
    if (results) {
      const shown = results.querySelectorAll(".library-creature-card:not(.is-filtered-out)").length;
      results.classList.toggle("is-empty", shown === 0);
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
      content: `<p>${localize("BESTIARY.ConfirmDelete")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await runCommand({ type: BESTIARY_COMMANDS.DELETE_SECTION, sectionId }, { unchanged: "BESTIARY.Lock.Blocked" });
  }
}
