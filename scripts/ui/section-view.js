import { selectVisibleSections } from "../core/bestiary-domain.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { toggleFavoriteCreature } from "../foundry/client-preferences.js";
import { localize } from "../foundry/foundry-runtime.js";
import { bindArtwork } from "./artwork.js";
import { CollectionWorkspaceController, prepareCollectionContext } from "./collection-workspace.js";
import { buildCreatureRows, rowInputs } from "./creature-rows.js";
import { BestiaryGuideApp, maybeShowFirstTimeGuide } from "./guide-app.js";
import { BestiaryKnowledgeBoard } from "./knowledge-board.js";
import { playApplicationEntrance } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function buttonMenuEvent(target) {
  const bounds = target.getBoundingClientRect();
  return { target, currentTarget: target, clientX: bounds.left, clientY: bounds.bottom + 4 };
}

/** Standalone collection window wrapper preserved for backwards compatibility with callers/instances. */
export class BestiarySectionView extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instances = new Set();

  static DEFAULT_OPTIONS = {
    id: "bestiary-section-view-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-section-view"],
    tag: "div",
    window: { title: "BESTIARY.Title", icon: "fa-solid fa-book-open", resizable: true, minimizable: true },
    position: { width: 1280, height: 820 },
    actions: {
      openKnowledgeBoard: function () {
        BestiaryKnowledgeBoard.open(this.sectionId);
      },
      goBack: function () {
        this.close();
        game.bestiaryJournal?.open();
      },
      switchSection: function (event, target) {
        const sectionId = target.dataset.sectionId;
        if (!sectionId || sectionId === this.sectionId) return;
        this.sectionId = sectionId;
        this._collection.setSection(sectionId);
        this.render();
      },
      toggleView: function (event, target) {
        this._collection.toggleView(target.dataset.viewMode);
      },
      selectCreature: function (event, target) {
        this._collection.selectCreature(event, target);
      },
      openCreature: function (event, target) {
        this._collection.openCreature(event, target);
      },
      toggleFavorite: async function (event, target) {
        event.stopPropagation();
        const uuid = target.closest("[data-uuid]")?.dataset.uuid;
        if (!uuid) return;
        await toggleFavoriteCreature(uuid);
        await this.render();
      },
      removeCreature: function (event, target) {
        this._collection.removeCreature(event, target);
      },
      openSheet: function (event, target) {
        this._collection.openSheet(event, target);
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
      toggleFilters: function () {
        this._collection.toggleFilters();
      },
      closePreview: function () {
        this._collection.closePreview();
      },
      resetFilters: function () {
        this._collection.resetFilters();
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
      toggleFamily: function (event, target) {
        this._collection.toggleFamily(target);
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
      clearCollectionSearch: function () {
        this._collection.clearSearch();
      },
      openGuide: function (event, target) {
        BestiaryGuideApp.open({ tab: target?.dataset?.tab || "quickstart" });
      },
    },
  };

  static PARTS = {
    section: {
      template: "modules/bestiary-journal/templates/section-view.hbs",
      scrollable: [".collection-results-scroll", ".library-collection-nav", ".filter-panel-scroll"],
    },
  };

  constructor(options = {}) {
    const uniqueId = options.uniqueId ?? foundry.utils.randomID(16);
    super({ ...options, uniqueId });
    this.sectionId = options.sectionId;
    this._collection = new CollectionWorkspaceController(this, this.sectionId);
    BestiarySectionView._instances.add(this);
  }

  get title() {
    const section = getBestiaryData().sections.find((item) => item.id === this.sectionId);
    return section?.name || localize("BESTIARY.Title");
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const visibleSections = selectVisibleSections(data, game.user);
    const inputs = await rowInputs(visibleSections, { data, knowledge });
    const allSections = visibleSections.map((section) => ({
      ...section,
      creatureCount: buildCreatureRows([section], inputs).length,
      isActive: section.id === this.sectionId,
    }));
    const collection = await prepareCollectionContext({
      sectionId: this.sectionId,
      state: this._collection.state,
      inputs,
    });
    return {
      ...collection,
      isGM: game.user.isGM,
      allSections,
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("keydown", (event) => this._collection.handleKeydown(event));
    this.element.addEventListener("drop", () => this._collection.clearDragState(), true);
    this.element.addEventListener("dragend", () => this._collection.clearDragState(), true);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._disposeArtwork?.();
    const title = this.window?.title;
    if (title instanceof HTMLElement) title.textContent = this.title;
    if (context.missing) return;
    this._collection.activate({ missing: context.missing });
    playApplicationEntrance(this, ".section-shell");
    this._disposeArtwork = bindArtwork(this.element);
    maybeShowFirstTimeGuide(this);
  }

  _onClose(options) {
    this._disposeArtwork?.();
    super._onClose(options);
  }

  async refreshFromExternalUpdate(payload = {}) {
    const changed = payload.changed ?? {};
    const showsChangedCreature =
      (changed.creatures || changed.seen) &&
      (!Array.isArray(payload.uuids) ||
        payload.uuids.some((uuid) => this.element?.querySelector(`[data-uuid="${CSS.escape(uuid)}"]`)));
    if (!changed.data && !changed.knowledge && !changed.settings && !showsChangedCreature) return;
    await this.render();
  }

  async close(options) {
    BestiarySectionView._instances.delete(this);
    return super.close(options);
  }
}
