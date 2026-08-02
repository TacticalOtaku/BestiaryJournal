import { extractCreatureData, formatCR } from "./helpers.mjs";
import {
  BESTIARY_COMMANDS,
  mergeCreatureEntries,
  selectVisibleCreatureEntries,
  selectVisibleSections
} from "./bestiary-domain.mjs";
import { dispatchBestiaryCommand, getBestiaryData } from "./bestiary-store.mjs";
import {
  getFavoriteCreatureUuids,
  getLibraryViewMode,
  setLibraryViewMode,
  toggleFavoriteCreature
} from "./client-preferences.mjs";
import { resolveUuid } from "./foundry-runtime.mjs";
import { BestiaryTileEditor } from "./tile-editor.mjs";
import { BestiarySectionView } from "./section-view.mjs";
import { BestiaryCreatureView } from "./creature-view.mjs";
import { playApplicationEntrance } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiaryApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-main",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-main"],
    tag: "div",
    window: {
      title: "BESTIARY.Title",
      icon: "fas fa-book-open",
      resizable: true,
      minimizable: true
    },
    position: { width: 1180, height: 760 },
    actions: {
      createSection: function (event, target) { this._onCreateSection(event, target); },
      openSection: function (event, target) { this._onOpenSection(event, target); },
      editSection: function (event, target) { this._onEditSection(event, target); },
      deleteSection: function (event, target) { this._onDeleteSection(event, target); },
      toggleSectionVisibility: function (event, target) { this._onToggleSectionVisibility(event, target); },
      setLibraryView: function (event, target) { this._onSetLibraryView(event, target); },
      openCreature: function (event, target) { this._onOpenCreature(event, target); },
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      toggleFavorite: function (event, target) { this._onToggleFavorite(event, target); },
      toggleCreatureLayout: function (event, target) { this._onToggleCreatureLayout(event, target); },
      clearSearch: function () { this._clearSearch(); }
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
    const isGM = game.user.isGM;
    const visibleSections = selectVisibleSections(data, isGM);
    const sections = this._buildSectionCards(visibleSections, isGM);
    const creatures = await this._resolveLibraryCreatures(visibleSections, isGM);
    const favoriteCreatures = creatures.filter(creature => creature.isFavorite);
    const displayedCreatures = this._activeView === "favorites"
      ? favoriteCreatures
      : creatures;
    return this._buildLibraryContext({
      sections,
      creatures,
      favoriteCreatures,
      displayedCreatures,
      isGM
    });
  }

  _buildSectionCards(visibleSections, isGM) {
    return visibleSections.map(section => {
      const entries = selectVisibleCreatureEntries(section, isGM);
      const updatedAt = Math.max(
        section.updatedAt ?? 0,
        ...entries.map(entry => entry.addedAt ?? 0)
      );
      return {
        ...section,
        creatureCount: entries.length,
        displayImage: section.image || "icons/svg/book.svg",
        isHidden: !!section.hidden,
        searchText: section.name.toLocaleLowerCase(),
        updatedLabel: updatedAt
          ? new Date(updatedAt).toLocaleDateString(game.i18n.lang)
          : ""
      };
    });
  }

  async _resolveLibraryCreatures(visibleSections, isGM) {
    const favorites = getFavoriteCreatureUuids();
    const creatures = [];
    for (const entry of mergeCreatureEntries(visibleSections, isGM)) {
      try {
        const actor = await resolveUuid(entry.uuid);
        if (!actor) continue;
        const creature = await extractCreatureData(actor);
        creatures.push({
          ...creature,
          ...entry,
          crFormatted: formatCR(creature.cr),
          typeLabel: [creature.size, creature.creatureType].filter(Boolean).join(" · "),
          collectionLabel: entry.collections.join(", "),
          isFavorite: favorites.has(entry.uuid),
          searchText: [creature.name, creature.creatureType, creature.size, ...entry.collections].join(" ").toLocaleLowerCase()
        });
      } catch (error) {
        console.warn(`Bestiary | Could not resolve actor UUID ${entry.uuid}`, error);
      }
    }
    creatures.sort((a, b) => b.addedAt - a.addedAt);
    return creatures;
  }

  _buildLibraryContext({ sections, creatures, favoriteCreatures, displayedCreatures, isGM }) {
    return {
      sections,
      recentCreatures: creatures.slice(0, 8),
      displayedCreatures,
      totalCreatures: creatures.length,
      favoriteCount: favoriteCreatures.length,
      collectionCount: sections.length,
      activeView: this._activeView,
      isOverview: this._activeView === "overview",
      isRecent: this._activeView === "recent",
      isFavorites: this._activeView === "favorites",
      viewTitle: this._activeView === "favorites"
        ? game.i18n.localize("BESTIARY.Favorites")
        : game.i18n.localize("BESTIARY.Recent"),
      creatureLayout: this._creatureLayout,
      isGrid: this._creatureLayout === "grid",
      isGM,
      noSections: sections.length === 0,
      noCreatures: displayedCreatures.length === 0
    };
  }

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
    this._searchKeyHandler = event => {
      if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        input.focus();
      } else if (event.key === "Escape" && input.value) {
        this._clearSearch();
      }
    };
    this.element.addEventListener("keydown", this._searchKeyHandler);
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
        this._showContextMenu(event, [
          { name: game.i18n.localize("BESTIARY.EditSection"), icon: "fa-pen", callback: () => this._editSectionById(sectionId) },
          {
            name: game.i18n.localize(isHidden ? "BESTIARY.ShowToPlayers" : "BESTIARY.HideFromPlayers"),
            icon: isHidden ? "fa-eye" : "fa-eye-slash",
            callback: () => this._toggleSectionVisibilityById(sectionId)
          },
          { name: game.i18n.localize("BESTIARY.DeleteSection"), icon: "fa-trash", danger: true, callback: () => this._deleteSectionById(sectionId) }
        ]);
      });
    }
  }

  _showContextMenu(event, items) {
    document.querySelectorAll(".bestiary-context-menu").forEach(element => element.remove());
    const menu = document.createElement("nav");
    menu.className = "bestiary-context-menu bestiary-app";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.innerHTML = `<ol class="context-items"></ol>`;
    const list = menu.querySelector("ol");
    for (const item of items) {
      const row = document.createElement("li");
      row.className = `context-item${item.danger ? " is-danger" : ""}`;
      row.innerHTML = `<i class="fas ${item.icon}"></i><span>${item.name}</span>`;
      row.addEventListener("click", () => { menu.remove(); item.callback(); });
      list.appendChild(row);
    }
    document.body.appendChild(menu);
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
    const close = click => {
      if (!menu.contains(click.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", close);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", close), 0);
  }

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
    const content = this.element.querySelector(".library-creature-grid");
    content?.classList.toggle("is-list", layout === "list");
    for (const button of this.element.querySelectorAll("[data-layout]")) {
      button.classList.toggle("is-active", button.dataset.layout === layout);
    }
  }

  _onCreateSection() {
    new BestiaryTileEditor({ onSave: () => this.render() }).render(true);
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
    if (section) new BestiaryTileEditor({ sectionData: section, onSave: () => this.render() }).render(true);
  }

  async _deleteSectionById(sectionId) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BESTIARY.DeleteSection") },
      content: `<p>${game.i18n.localize("BESTIARY.ConfirmDelete")}</p>`
    });
    if (!confirmed) return;
    await dispatchBestiaryCommand({
      type: BESTIARY_COMMANDS.DELETE_SECTION,
      sectionId
    });
    this.render();
  }

  async _toggleSectionVisibilityById(sectionId) {
    await dispatchBestiaryCommand({
      type: BESTIARY_COMMANDS.TOGGLE_SECTION_VISIBILITY,
      sectionId
    });
    this.render();
  }
}
