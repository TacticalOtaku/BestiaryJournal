import { getBestiaryData, setBestiaryData, extractCreatureData, formatCR } from "./helpers.mjs";
import { BestiaryCreatureView } from "./creature-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiarySectionView extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-section-view",
    classes: ["bestiary-journal", "bestiary-section-view"],
    tag: "div",
    window: {
      title: "BESTIARY.Title",
      icon: "fas fa-book-skull",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 960,
      height: 720
    },
    actions: {
      goBack: function (event, target) { this._onGoBack(event, target); },
      toggleView: function (event, target) { this._onToggleView(event, target); },
      openCreature: function (event, target) { this._onOpenCreature(event, target); },
      removeCreature: function (event, target) { this._onRemoveCreature(event, target); },
      openSheet: function (event, target) { this._onOpenSheet(event, target); },
      sortName: function (event, target) { this._onSortName(event, target); },
      sortCR: function (event, target) { this._onSortCR(event, target); },
      toggleCreatureVisibility: function (event, target) { this._onToggleCreatureVisibility(event, target); }
    }
  };

  static PARTS = {
    section: {
      template: "modules/bestiary-journal/templates/section-view.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this.sectionId = options.sectionId;
    this._viewMode = "card";
    this._searchQuery = "";
    this._sortMode = "name";
    this._sortDirection = 1;
  }

  get title() {
    const data = getBestiaryData();
    const section = data.sections.find(s => s.id === this.sectionId);
    return section?.name || game.i18n.localize("BESTIARY.Title");
  }

  async _prepareContext(options) {
    const data = getBestiaryData();
    const section = data.sections.find(s => s.id === this.sectionId);
    const isGM = game.user.isGM;
    if (!section) return { creatures: [], viewMode: this._viewMode, isGM };

    const creatures = [];
    for (const entry of section.creatures ?? []) {
      if (!isGM && entry.hidden) continue;
      try {
        const actor = await fromUuid(entry.uuid);
        if (!actor) continue;
        const creatureData = await extractCreatureData(actor);
        creatureData.crFormatted = formatCR(creatureData.cr);
        creatureData.typeLabel = this._getTypeLabel(creatureData);
        creatureData.isHidden = !!entry.hidden;
        creatures.push(creatureData);
      } catch (e) {
        console.warn(`Bestiary: Could not resolve actor UUID ${entry.uuid}`, e);
      }
    }

    let filtered = creatures;
    if (this._searchQuery) {
      const q = this._searchQuery.toLowerCase();
      filtered = creatures.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.creatureType.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      if (this._sortMode === "cr") return (a.cr - b.cr) * this._sortDirection;
      return a.name.localeCompare(b.name) * this._sortDirection;
    });

    return {
      creatures: filtered,
      viewMode: this._viewMode,
      isGM,
      isEmpty: filtered.length === 0,
      sectionName: section.name,
      sectionImage: section.image,
      searchQuery: this._searchQuery,
      sortMode: this._sortMode
    };
  }

  _getTypeLabel(creature) {
    const parts = [];
    if (creature.size) parts.push(creature.size);
    if (creature.creatureType) {
      let typeStr = creature.creatureType;
      if (creature.creatureSubtype) typeStr += ` (${creature.creatureSubtype})`;
      parts.push(typeStr);
    }
    return parts.join(" ");
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateDragDrop();
    this._activateSearch();
  }

  _activateDragDrop() {
    if (!game.user.isGM) return;
    const dropZone = this.element.querySelector(".bestiary-creatures-area");
    if (!dropZone) return;
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
      await this._onDrop(event);
    });
  }

  _activateSearch() {
    const searchInput = this.element.querySelector(".bestiary-search-input");
    if (!searchInput) return;
    searchInput.addEventListener("input", foundry.utils.debounce((event) => {
      this._searchQuery = event.target.value;
      this.render();
    }, 300));
  }

  async _onDrop(event) {
    let dropData;
    try { dropData = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (e) { return; }
    if (dropData.type !== "Actor") return;
    const actor = await fromUuid(dropData.uuid);
    if (!actor) return;
    if (actor.type !== "npc") {
      ui.notifications.warn("Only NPC actors can be added to the bestiary.");
      return;
    }
    const data = getBestiaryData();
    const section = data.sections.find(s => s.id === this.sectionId);
    if (!section) return;
    if (section.creatures?.some(c => c.uuid === actor.uuid)) {
      ui.notifications.info(`${actor.name} is already in this section.`);
      return;
    }
    if (!section.creatures) section.creatures = [];
    section.creatures.push({ uuid: actor.uuid, addedAt: Date.now(), hidden: false });
    await setBestiaryData(data);
    this.render();
  }

  // ── Action handlers ──

  _onGoBack(event, target) {
    this.close();
    if (game.bestiaryJournal?.mainApp) game.bestiaryJournal.mainApp.render(true);
  }

  _onToggleView(event, target) {
    const mode = target.dataset.viewMode;
    if (mode) this._viewMode = mode;
    this.render();
  }

  _onOpenCreature(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    new BestiaryCreatureView({ uuid }).render(true);
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
    const section = data.sections.find(s => s.id === this.sectionId);
    if (!section) return;
    section.creatures = (section.creatures ?? []).filter(c => c.uuid !== uuid);
    await setBestiaryData(data);
    this.render();
  }

  async _onOpenSheet(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid);
    if (actor) actor.sheet.render(true);
  }

  _onSortName(event, target) {
    if (this._sortMode === "name") this._sortDirection *= -1;
    else { this._sortMode = "name"; this._sortDirection = 1; }
    this.render();
  }

  _onSortCR(event, target) {
    if (this._sortMode === "cr") this._sortDirection *= -1;
    else { this._sortMode = "cr"; this._sortDirection = 1; }
    this.render();
  }

  async _onToggleCreatureVisibility(event, target) {
    event.stopPropagation();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const data = getBestiaryData();
    const section = data.sections.find(s => s.id === this.sectionId);
    if (!section) return;
    const creature = section.creatures?.find(c => c.uuid === uuid);
    if (!creature) return;
    creature.hidden = !creature.hidden;
    await setBestiaryData(data);
    this.render();
  }
}
