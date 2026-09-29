import { BESTIARY_COMMANDS, selectVisibleFamilies } from "../core/bestiary-domain.js";
import { getBestiaryData } from "../foundry/bestiary-store.js";
import { runCommand } from "../foundry/command-feedback.js";
import { formatCR } from "../integrations/dnd5e.js";
import { localize } from "../foundry/foundry-runtime.js";
import { playApplicationEntrance } from "./ui-effects.js";
import { log } from "../core/logger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Mass import of NPC cards into a collection, sourced from the world's actor
 * directory or from any compendium the user can browse. Compendium entries are
 * linked by UUID by default; "copy into world" is offered for GMs who want
 * editable actors.
 */
export class BestiaryBulkImport extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-bulk-import-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-bulk-import"],
    tag: "div",
    window: { title: "BESTIARY.Import.Title", icon: "fa-solid fa-layer-group", resizable: true },
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
    super({ ...options, uniqueId: options.uniqueId ?? foundry.utils.randomID(16) });
    this.sectionId = options.sectionId;
    this.familyId = options.familyId ?? "";
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
    // Big compendiums take a moment: show the spinner, load, then redraw.
    if (!this._loaded && !this._loading) {
      this._loadSource().then(() => { if (this.rendered) this.render(); });
    }

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
      log.error("Could not read the import source", error);
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
    if (!this._selected.size || this._importing) return;
    this._importing = true;
    const button = this.element?.querySelector("[data-action='importSelected']");
    if (button) button.disabled = true;
    try {
      const chosen = this._entries.filter(entry => this._selected.has(entry.uuid));
      const prepared = this._copyToWorld && this._sourceId !== "world"
        ? await this._copyIntoWorld(chosen)
        : chosen;
      const present = new Set(getBestiaryData().sections
        .find(item => item.id === this.sectionId)?.creatures.map(entry => entry.uuid) ?? []);
      const fresh = prepared.filter(entry => !present.has(entry.uuid));
      if (!fresh.length) {
        ui.notifications.info(localize("BESTIARY.Import.NothingNew"));
        return;
      }

      const result = await runCommand({
        type: BESTIARY_COMMANDS.ADD_CREATURES,
        sectionId: this.sectionId,
        familyId: this.familyId || null,
        entries: fresh.map(entry => ({ uuid: entry.uuid, label: entry.name, thumb: entry.img }))
      }, { unchanged: "BESTIARY.Lock.Blocked" });
      if (!result?.changed) return;
      ui.notifications.info(game.i18n.format("BESTIARY.Import.Done", { count: fresh.length }));
      this.close();
    } finally {
      this._importing = false;
      if (this.rendered) this._updateCounter();
    }
  }

  /**
   * Copies compendium actors the way the core "Import" does, keeping the link
   * to their source. An actor already imported from the same entry is reused
   * instead of duplicated — matched by source, never by a coincidental name.
   */
  async _copyIntoWorld(entries) {
    const created = [];
    for (const entry of entries) {
      try {
        const existing = game.actors.find(actor =>
          (actor._stats?.compendiumSource ?? actor.flags?.core?.sourceId) === entry.uuid);
        if (existing) {
          created.push({ ...entry, uuid: existing.uuid });
          continue;
        }
        const source = await fromUuid(entry.uuid);
        if (!source) continue;
        const actor = await Actor.implementation.create(game.actors.fromCompendium(source, { clearFolder: true }));
        if (actor) created.push({ ...entry, uuid: actor.uuid });
      } catch (error) {
        log.warn(`Could not copy ${entry.uuid} into the world`, error);
      }
    }
    return created;
  }
}
