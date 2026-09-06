import { extractCreatureData, formatCR } from "./helpers.mjs";
import {
  BESTIARY_COMMANDS,
  getUserTier,
  mergeCreatureEntries,
  selectVisibleCreatureEntries,
  selectVisibleFamilies,
  selectVisibleSections
} from "./bestiary-domain.mjs";
import {
  dispatchBestiaryCommand,
  getBestiaryData,
  getBestiaryKnowledge
} from "./bestiary-store.mjs";
import {
  getFavoriteCreatureUuids,
  getLibraryViewMode,
  setLibraryViewMode,
  toggleFavoriteCreature
} from "./client-preferences.mjs";
import { buildImageView, buildThumbView } from "./image-framing.mjs";
import { GM_TIER, MIN_RESEARCH_TIER } from "./research-model.mjs";
import { describeTier } from "./research.mjs";
import { getPlayerUsers, localize, resolveUuid } from "./foundry-runtime.mjs";
import { BestiaryTileEditor } from "./tile-editor.mjs";
import { BestiarySectionView } from "./section-view.mjs";
import { BestiaryCreatureView } from "./creature-view.mjs";
import { BestiaryTierSettings } from "./tier-settings.mjs";
import { exportBestiary, importBestiaryFromFile } from "./transfer.mjs";
import { playApplicationEntrance, showContextMenu } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiaryApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-main",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-main"],
    tag: "div",
    window: { title: "BESTIARY.Title", icon: "fas fa-book-open", resizable: true, minimizable: true },
    position: { width: 1240, height: 800 },
    actions: {
      createSection: function () { this._onCreateSection(); },
      openSection: function (event, target) { this._onOpenSection(event, target); },
      editSection: function (event, target) { this._onEditSection(event, target); },
      deleteSection: function (event, target) { this._onDeleteSection(event, target); },
      toggleSectionVisibility: function (event, target) { this._onToggleSectionVisibility(event, target); },
      setLibraryView: function (event, target) { this._onSetLibraryView(event, target); },
      openCreature: function (event, target) { this._onOpenCreature(event, target); },
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      toggleFavorite: function (event, target) { this._onToggleFavorite(event, target); },
      toggleCreatureLayout: function (event, target) { this._onToggleCreatureLayout(event, target); },
      clearSearch: function () { this._clearSearch(); },
      exportAll: function () { this._onExportAll(); },
      importSnapshot: function () { this._onImport(); },
      openTierSettings: function () { new BestiaryTierSettings().render(true); }
    }
  };

  static PARTS = {
    main: { template: "modules/bestiary-journal/templates/bestiary-main.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this._activeView = "overview";
    this._creatureLayout = getLibraryViewMode();
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const isGM = game.user.isGM;
    const visibleSections = selectVisibleSections(data, isGM);
    const sections = this._buildSectionCards(visibleSections, isGM);
    const creatures = await this._resolveLibraryCreatures(visibleSections, knowledge, isGM);
    const favoriteCreatures = creatures.filter(creature => creature.isFavorite);
    const displayedCreatures = this._activeView === "favorites" ? favoriteCreatures : creatures;

    return {
      sections,
      recentCreatures: creatures.slice(0, 8),
      displayedCreatures,
      totalCreatures: creatures.length,
      favoriteCount: favoriteCreatures.length,
      collectionCount: sections.length,
      knownCount: creatures.filter(creature => creature.viewerTier > MIN_RESEARCH_TIER).length,
      activeView: this._activeView,
      isOverview: this._activeView === "overview",
      isRecent: this._activeView === "recent",
      isFavorites: this._activeView === "favorites",
      viewTitle: this._activeView === "favorites"
        ? localize("BESTIARY.Favorites")
        : localize("BESTIARY.Recent"),
      creatureLayout: this._creatureLayout,
      isGrid: this._creatureLayout === "grid",
      isGM,
      noSections: sections.length === 0,
      noCreatures: displayedCreatures.length === 0
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
    const creatures = [];

    for (const merged of mergeCreatureEntries(visibleSections, isGM)) {
      try {
        const actor = await resolveUuid(merged.uuid);
        if (!actor) continue;
        const creature = await extractCreatureData(actor);
        const viewerTier = isGM ? GM_TIER : getUserTier(knowledge, game.user.id, merged.uuid);
        creatures.push({
          ...creature,
          uuid: merged.uuid,
          addedAt: merged.addedAt,
          collections: merged.collections,
          crFormatted: formatCR(creature.cr),
          typeLabel: [creature.size, creature.creatureType].filter(Boolean).join(" · "),
          collectionLabel: merged.collections.join(", "),
          isFavorite: favorites.has(merged.uuid),
          viewerTier,
          tierBadge: isGM
            ? this._buildPartyBadge(knowledge, merged.uuid, players)
            : describeTier(viewerTier),
          image: buildImageView(merged.entry, creature),
          thumb: buildThumbView(merged.entry, creature),
          searchText: [creature.name, creature.creatureType, creature.size, ...merged.collections]
            .join(" ").toLocaleLowerCase()
        });
      } catch (error) {
        console.warn(`Bestiary | Could not resolve actor UUID ${merged.uuid}`, error);
      }
    }
    creatures.sort((a, b) => b.addedAt - a.addedAt);
    return creatures;
  }

  /** Dropped entirely when the world has no players to report on. */
  _buildPartyBadge(knowledge, uuid, players) {
    if (!players.length) return null;
    const known = players.filter(user => getUserTier(knowledge, user.id, uuid) > MIN_RESEARCH_TIER).length;
    return {
      label: `${known}/${players.length}`,
      key: known === 0 ? "none" : "partial",
      icon: known === 0 ? "fa-user-slash" : "fa-users"
    };
  }

  // ── Rendering ──

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateSearch();
    this._activateContextMenus();
    this._activateCreatureDrag();
    playApplicationEntrance(this, ".bestiary-shell");
  }

  _activateSearch() {
    const input = this.element.querySelector(".library-search-input");
    if (!input) return;
    input.addEventListener("input", () => {
      const query = input.value.trim().toLocaleLowerCase();
      for (const element of this.element.querySelectorAll("[data-search-text]")) {
        element.classList.toggle("is-filtered-out", query && !element.dataset.searchText.includes(query));
      }
      this.element.querySelector(".library-search-clear")?.classList.toggle("is-visible", !!query);
    });
    this.element.addEventListener("keydown", event => {
      if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        input.focus();
      } else if (event.key === "Escape" && input.value) {
        this._clearSearch();
      }
    });
  }

  _clearSearch() {
    const input = this.element?.querySelector(".library-search-input");
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  _activateCreatureDrag() {
    for (const card of this.element.querySelectorAll(".library-creature-card[data-uuid]")) {
      card.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: card.dataset.uuid }));
      });
    }
    for (const card of this.element.querySelectorAll("[data-action='openSection'][tabindex], [data-action='openCreature'][tabindex]")) {
      card.addEventListener("keydown", event => {
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
        const sectionId = tile.dataset.sectionId;
        const isHidden = tile.dataset.hidden === "true";
        const isLocked = tile.dataset.locked === "true";
        showContextMenu(event, [
          { name: localize("BESTIARY.EditSection"), icon: "fa-pen", callback: () => this._editSectionById(sectionId) },
          {
            name: localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
            icon: isHidden ? "fa-eye" : "fa-eye-slash",
            callback: () => this._toggleSectionVisibilityById(sectionId)
          },
          {
            name: localize(isLocked ? "BESTIARY.Lock.Unlock" : "BESTIARY.Lock.Lock"),
            icon: isLocked ? "fa-lock-open" : "fa-lock",
            callback: () => this._toggleSectionLock(sectionId, !isLocked)
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
            callback: () => this._deleteSectionById(sectionId)
          }
        ]);
      });
    }
  }

  // ── Actions ──

  _onSetLibraryView(event, target) {
    const view = target.dataset.libraryView;
    if (!["overview", "recent", "favorites"].includes(view)) return;
    this._activeView = view;
    this.render();
  }

  async _onToggleCreatureLayout(event, target) {
    const layout = target.dataset.layout;
    if (!["grid", "list"].includes(layout)) return;
    this._creatureLayout = layout;
    await setLibraryViewMode(layout);
    this.element.querySelector(".library-creature-grid")?.classList.toggle("is-list", layout === "list");
    for (const button of this.element.querySelectorAll("[data-layout]")) {
      button.classList.toggle("is-active", button.dataset.layout === layout);
    }
  }

  _onCreateSection() {
    new BestiaryTileEditor({ mode: "section", onSave: () => this.render() }).render(true);
  }

  _onOpenSection(event, target) {
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (!sectionId) return;
    this.close();
    new BestiarySectionView({ sectionId }).render(true);
  }

  _onOpenCreature(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (uuid) new BestiaryCreatureView({ uuid }).render(true);
  }

  async _onOpenSheet(event, target) {
    event.stopPropagation();
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const actor = uuid ? await resolveUuid(uuid) : null;
    actor?.sheet.render(true);
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
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this._editSectionById(sectionId);
  }

  _onDeleteSection(event, target) {
    event.stopPropagation();
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this._deleteSectionById(sectionId);
  }

  _onToggleSectionVisibility(event, target) {
    event.stopPropagation();
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this._toggleSectionVisibilityById(sectionId);
  }

  _editSectionById(sectionId) {
    const section = getBestiaryData().sections.find(item => item.id === sectionId);
    if (!section) return;
    new BestiaryTileEditor({
      mode: "section",
      tileData: section,
      onSave: () => this.render()
    }).render(true);
  }

  async _deleteSectionById(sectionId) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.DeleteSection") },
      content: `<p>${localize("BESTIARY.ConfirmDelete")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await dispatchBestiaryCommand({ type: BESTIARY_COMMANDS.DELETE_SECTION, sectionId });
    this.render();
  }

  async _toggleSectionVisibilityById(sectionId) {
    await dispatchBestiaryCommand({ type: BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY, sectionId });
    this.render();
  }

  async _toggleSectionLock(sectionId, locked) {
    await dispatchBestiaryCommand({ type: BESTIARY_COMMANDS.SET_SECTION_LOCK, sectionId, locked });
    this.render();
  }

  _onExportAll() {
    exportBestiary({});
  }

  async _onImport() {
    const imported = await importBestiaryFromFile();
    if (imported) this.render();
  }
}
