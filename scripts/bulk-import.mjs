import { BESTIARY_COMMANDS, selectVisibleFamilies } from "./bestiary-domain.mjs";
import { dispatchBestiaryCommand, getBestiaryData } from "./bestiary-store.mjs";
import { formatCR } from "./helpers.mjs";
import { localize } from "./foundry-runtime.mjs";
import { playApplicationEntrance } from "./ui-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Mass import of NPC cards into a collection, sourced from the world's actor
 * directory or from any compendium the user can browse. Compendium entries are
 * linked by UUID by default; "copy into world" is offered for GMs who want
 * editable actors.
 */
export class BestiaryBulkImport extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-bulk-import",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-bulk-import"],
    tag: "div",
    window: { title: "BESTIARY.Import.Title", icon: "fas fa-layer-group", resizable: true },
    position: { width: 880, height: 700 },
    actions: {
      selectSource: function (event, target) { this._onSelectSource(event, target); },
      toggleAll: function (event, target) { this._onToggleAll(event, target); },
      importSelected: function () { this._onImport(); },
      closeDialog: function () { this.close(); }
    }
  };

  static PARTS = {
    body: { template: "modules/bestiary-journal/templates/bulk-import.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.sectionId = options.sectionId;
    this.familyId = options.familyId ?? "";
    this.onImported = options.onImported ?? null;
    this._sourceId = "world";
    this._entries = [];
    this._selected = new Set();
    this._loading = false;
    this._loaded = false;
    this._query = "";
    this._crMin = "";
    this._crMax = "";
    this._copyToWorld = false;
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    if (!this._loaded && !this._loading) await this._loadSource();

    return {
      sources: this._buildSources(),
      sourceId: this._sourceId,
      isCompendium: this._sourceId !== "world",
      copyToWorld: this._copyToWorld,
      entries: this._entries,
      selectedCount: this._selected.size,
      totalCount: this._entries.length,
      loading: this._loading,
      sectionName: section?.name ?? "",
      families: [
        { id: "", name: localize("BESTIARY.Families.None"), selected: !this.familyId },
        ...selectVisibleFamilies(section, true).map(family => ({
          id: family.id,
          name: family.name,
          selected: family.id === this.familyId
        }))
      ],
      query: this._query,
      crMin: this._crMin,
      crMax: this._crMax
    };
  }

  _buildSources() {
    const packs = [...(game.packs ?? [])]
      .filter(pack => pack.documentName === "Actor" && pack.visible !== false)
      .map(pack => ({
        id: pack.collection,
        label: `${pack.metadata.label} (${pack.metadata.packageName ?? pack.metadata.package ?? ""})`.trim(),
        selected: pack.collection === this._sourceId
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    return [
      { id: "world", label: localize("BESTIARY.Import.SourceWorld"), selected: this._sourceId === "world" },
      ...packs
    ];
  }

  async _loadSource() {
    this._loading = true;
    try {
      this._entries = this._sourceId === "world"
        ? this._loadWorldActors()
        : await this._loadPackActors(this._sourceId);
    } catch (error) {
      console.error("Bestiary | Could not read the import source", error);
      ui.notifications.error(localize("BESTIARY.Import.LoadFailed"));
      this._entries = [];
    } finally {
      this._loading = false;
      // Marked loaded even on failure so a broken pack does not loop forever.
      this._loaded = true;
    }
    this._markExisting();
  }

  _loadWorldActors() {
    return (game.actors?.contents ?? [])
      .filter(actor => actor.type === "npc")
      .map(actor => ({
        uuid: actor.uuid,
        name: actor.name,
        img: actor.img,
        cr: actor.system?.details?.cr ?? 0,
        typeKey: actor.system?.details?.type?.value ?? "",
        folder: actor.folder?.name ?? ""
      }));
  }

  async _loadPackActors(packId) {
    const pack = game.packs?.get(packId);
    if (!pack) return [];
    const index = await pack.getIndex({
      fields: ["img", "system.details.cr", "system.details.type.value", "type"]
    });
    return [...index]
      .filter(record => (record.type ?? "npc") === "npc")
      .map(record => ({
        uuid: `Compendium.${packId}.Actor.${record._id}`,
        name: record.name,
        img: record.img || "icons/svg/mystery-man.svg",
        cr: record.system?.details?.cr ?? 0,
        typeKey: record.system?.details?.type?.value ?? "",
        folder: pack.metadata.label
      }));
  }

  /** Entries already present in the target collection are shown but disabled. */
  _markExisting() {
    const section = getBestiaryData().sections.find(item => item.id === this.sectionId);
    const present = new Set((section?.creatures ?? []).map(entry => entry.uuid));
    for (const entry of this._entries) {
      entry.alreadyAdded = present.has(entry.uuid);
      entry.crLabel = formatCR(entry.cr);
      entry.searchText = `${entry.name} ${entry.typeKey} ${entry.folder}`.toLocaleLowerCase();
      entry.selected = this._selected.has(entry.uuid);
    }
    this._entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateControls();
    this._applyFilters();
    playApplicationEntrance(this, ".bulk-import-shell");
  }

  _activateControls() {
    const root = this.element;
    root.querySelector(".bulk-source-select")?.addEventListener("change", event => {
      this._sourceId = event.currentTarget.value;
      this._entries = [];
      this._loaded = false;
      this._selected.clear();
      this.render();
    });
    root.querySelector(".bulk-family-select")?.addEventListener("change", event => {
      this.familyId = event.currentTarget.value;
    });
    root.querySelector(".bulk-copy-toggle")?.addEventListener("change", event => {
      this._copyToWorld = event.currentTarget.checked;
    });
    root.querySelector(".bulk-search-input")?.addEventListener("input", event => {
      this._query = event.currentTarget.value.trim().toLocaleLowerCase();
      this._applyFilters();
    });
    for (const input of root.querySelectorAll("[data-cr-bound]")) {
      input.addEventListener("input", event => {
        if (event.currentTarget.dataset.crBound === "min") this._crMin = event.currentTarget.value;
        else this._crMax = event.currentTarget.value;
        this._applyFilters();
      });
    }
    for (const checkbox of root.querySelectorAll("input[data-entry-uuid]")) {
      checkbox.addEventListener("change", event => {
        const uuid = event.currentTarget.dataset.entryUuid;
        event.currentTarget.checked ? this._selected.add(uuid) : this._selected.delete(uuid);
        this._updateCounter();
      });
    }
  }

  _applyFilters() {
    const min = this._crMin === "" ? -Infinity : Number(this._crMin);
    const max = this._crMax === "" ? Infinity : Number(this._crMax);
    let visible = 0;
    for (const row of this.element.querySelectorAll("[data-entry-row]")) {
      const cr = Number(row.dataset.cr);
      const show = (!this._query || row.dataset.searchText.includes(this._query))
        && cr >= min && cr <= max;
      row.classList.toggle("is-filtered-out", !show);
      if (show) visible += 1;
    }
    const counter = this.element.querySelector(".bulk-visible-count");
    if (counter) counter.textContent = String(visible);
    this._updateCounter();
  }

  _updateCounter() {
    const counter = this.element?.querySelector(".bulk-selected-count");
    if (counter) counter.textContent = String(this._selected.size);
    const button = this.element?.querySelector("[data-action='importSelected']");
    if (button) button.disabled = this._selected.size === 0;
  }

  _onToggleAll(event, target) {
    const select = target.dataset.mode !== "none";
    for (const checkbox of this.element.querySelectorAll("input[data-entry-uuid]")) {
      const row = checkbox.closest("[data-entry-row]");
      if (checkbox.disabled || row?.classList.contains("is-filtered-out")) continue;
      checkbox.checked = select;
      select ? this._selected.add(checkbox.dataset.entryUuid) : this._selected.delete(checkbox.dataset.entryUuid);
    }
    this._updateCounter();
  }

  _onSelectSource(event, target) {
    this._sourceId = target.dataset.sourceId;
    this._entries = [];
    this._loaded = false;
    this._selected.clear();
    this.render();
  }

  async _onImport() {
    if (!this._selected.size) return;
    const chosen = this._entries.filter(entry => this._selected.has(entry.uuid));
    const prepared = this._copyToWorld && this._sourceId !== "world"
      ? await this._copyIntoWorld(chosen)
      : chosen;

    await dispatchBestiaryCommand({
      type: BESTIARY_COMMANDS.ADD_CREATURES,
      sectionId: this.sectionId,
      familyId: this.familyId || null,
      entries: prepared.map(entry => ({
        uuid: entry.uuid,
        label: entry.name,
        thumb: entry.img
      }))
    });

    ui.notifications.info(game.i18n.format("BESTIARY.Import.Done", { count: prepared.length }));
    this.onImported?.();
    this.close();
  }

  async _copyIntoWorld(entries) {
    const created = [];
    for (const entry of entries) {
      try {
        const source = await fromUuid(entry.uuid);
        if (!source) continue;
        const existing = game.actors.find(actor => actor.name === source.name && actor.type === "npc");
        const actor = existing ?? await Actor.create(source.toObject(), { keepId: false });
        if (actor) created.push({ ...entry, uuid: actor.uuid });
      } catch (error) {
        console.warn(`Bestiary | Could not copy ${entry.uuid} into the world`, error);
      }
    }
    return created;
  }
}
