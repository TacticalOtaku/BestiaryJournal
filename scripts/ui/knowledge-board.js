import { BESTIARY_COMMANDS, getUserTier, isCreatureLocked } from "../core/bestiary-domain.js";
import { maxResearchTier } from "../core/research-model.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { getWorldResearchTiers, translateTierText } from "../foundry/creature-display.js";
import { runCommand } from "../foundry/command-feedback.js";
import { getCreatureDataMany } from "../foundry/creature-cache.js";
import { confirmDialog, formatCount, getPlayerUsers, localize } from "../foundry/foundry-runtime.js";
import { describeTier } from "../foundry/research.js";
import { playApplicationEntrance } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const ALL = "";
const UNGROUPED = "__ungrouped__";

/**
 * The GM's view of what the party knows: one row per creature, a whole-party
 * quick-set column, and one column per player. Supports search, family filter,
 * and checkbox multi-select for batch updates.
 */
export class BestiaryKnowledgeBoard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bestiary-knowledge-board",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-knowledge-board"],
    window: {
      title: "BESTIARY.Board.Title",
      icon: "fa-solid fa-table-cells",
      resizable: true,
      minimizable: true,
    },
    position: { width: 960, height: 680 },
    actions: {
      applySelected: function () {
        this._onApplySelected();
      },
      applyAll: function () {
        this._onApplyAll();
      },
      clearSelection: function () {
        this._clearSelection();
      },
      clearBoardSearch: function () {
        this._clearSearch();
      },
    },
  };

  static PARTS = {
    main: {
      template: "modules/bestiary-journal/templates/knowledge-board.hbs",
      scrollable: [".knowledge-board-table"],
    },
  };

  constructor(options = {}) {
    super(options);
    this._scope = options.sectionId ?? ALL;
    this._family = ALL;
    this._searchQuery = "";
    this._selectedUuids = new Set();
  }

  /** Opens the board, or brings it forward on the given collection. */
  static open(sectionId = ALL) {
    const current = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (current) {
      if (current._scope !== sectionId) {
        current._scope = sectionId;
        current._family = ALL;
        current._selectedUuids.clear();
      }
      current.render({ force: true });
      if (current.minimized) current.maximize?.();
      current.bringToFront?.();
      return current;
    }
    const board = new this({ sectionId });
    board.render({ force: true });
    return board;
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const knowledge = getBestiaryKnowledge();
    const players = getPlayerUsers();
    const tiers = getWorldResearchTiers();
    const maxTier = maxResearchTier(tiers);
    const sections = this._scope
      ? data.sections.filter((section) => section.id === this._scope)
      : data.sections;
    const families = this._scope ? (sections[0]?.families ?? []) : [];
    if (
      this._family &&
      this._family !== UNGROUPED &&
      !families.some((family) => family.id === this._family)
    ) {
      this._family = ALL;
    }

    const uuids = [
      ...new Set(
        sections.flatMap((section) =>
          section.creatures
            .filter((entry) => {
              if (!this._family) return true;
              if (this._family === UNGROUPED) return !entry.familyId;
              return entry.familyId === this._family;
            })
            .map((entry) => entry.uuid),
        ),
      ),
    ];
    const resolved = await getCreatureDataMany(uuids);
    const tierChoice = (selected) =>
      tiers.map((definition) => ({
        value: definition.value,
        label: translateTierText(definition.label),
        selected: definition.value === selected,
      }));

    const rows = uuids
      .filter((uuid) => resolved.get(uuid))
      .map((uuid) => {
        const creature = resolved.get(uuid);
        const locked = isCreatureLocked(data, uuid);
        const playerTiers = players.map((user) => getUserTier(knowledge, user.id, uuid, maxTier));
        const uniform =
          playerTiers.length > 0 && playerTiers.every((value) => value === playerTiers[0])
            ? playerTiers[0]
            : null;
        const uniformDef = uniform !== null ? (tiers[uniform] ?? tiers[0]) : null;
        return {
          uuid,
          name: creature.name,
          searchText: creature.name.toLocaleLowerCase(),
          img: creature.img,
          locked,
          selected: !locked && this._selectedUuids.has(uuid),
          partyKey: uniformDef?.key ?? "unknown",
          partyColor: uniformDef ? (uniformDef.color ?? uniformDef.key) : "",
          partyIsMixed: uniform === null,
          partyOptions: [
            { value: "", label: localize("BESTIARY.Board.Mixed"), selected: uniform === null },
            ...tierChoice(uniform),
          ],
          cells: players.map((user, index) => {
            const tier = playerTiers[index];
            const definition = tiers[tier] ?? tiers[0];
            return {
              userId: user.id,
              key: definition.key,
              color: definition.color ?? definition.key,
              options: tierChoice(tier),
            };
          }),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    const validUnlocked = new Set(rows.filter((row) => !row.locked).map((row) => row.uuid));
    for (const uuid of [...this._selectedUuids]) {
      if (!validUnlocked.has(uuid)) this._selectedUuids.delete(uuid);
    }
    this._rows = rows;

    const selectedCount = this._selectedUuids.size;
    const unlockedCount = validUnlocked.size;
    return {
      players,
      rows,
      hasFamilies: families.length > 0,
      families: [
        { id: ALL, label: localize("BESTIARY.Board.AllFamilies"), selected: !this._family },
        ...families.map((family) => ({
          id: family.id,
          label: family.name,
          selected: family.id === this._family,
        })),
        ...(families.length
          ? [
              {
                id: UNGROUPED,
                label: localize("BESTIARY.Families.Ungrouped"),
                selected: this._family === UNGROUPED,
              },
            ]
          : []),
      ],
      scopes: [
        { id: ALL, label: localize("BESTIARY.Board.AllCollections"), selected: !this._scope },
        ...data.sections.map((section) => ({
          id: section.id,
          label: section.name,
          selected: section.id === this._scope,
        })),
      ],
      tierOptions: tierChoice(Math.min(1, maxTier)),
      selectedCount,
      unlockedCount,
      applySelectedLabel: game.i18n.format("BESTIARY.Board.ApplySelected", { count: selectedCount }),
      applyAllLabel: game.i18n.format("BESTIARY.Board.ApplyAll", { count: unlockedCount }),
      selectedLabel: game.i18n.format("BESTIARY.Board.SelectedCount", { count: selectedCount }),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector(".board-scope")?.addEventListener("change", (event) => {
      this._scope = event.currentTarget.value;
      this._family = ALL;
      this._selectedUuids.clear();
      this.render();
    });
    this.element.querySelector(".board-family")?.addEventListener("change", (event) => {
      this._family = event.currentTarget.value;
      this._selectedUuids.clear();
      this.render();
    });

    const searchInput = this.element.querySelector(".board-search-input");
    if (searchInput) {
      searchInput.value = this._searchQuery;
      searchInput.addEventListener("input", () => {
        this._searchQuery = searchInput.value.trim().toLocaleLowerCase();
        this._applySearchFilter();
      });
    }

    this.element.querySelector(".board-select-all")?.addEventListener("change", (event) => {
      const checked = event.currentTarget.checked;
      for (const row of this.element.querySelectorAll("tbody tr[data-uuid]")) {
        if (row.classList.contains("is-filtered-out")) continue;
        const checkbox = row.querySelector(".board-row-check");
        if (!checkbox || checkbox.disabled) continue;
        checkbox.checked = checked;
        if (checked) this._selectedUuids.add(row.dataset.uuid);
        else this._selectedUuids.delete(row.dataset.uuid);
        row.classList.toggle("is-selected", checked);
      }
      this._syncSelectionControls();
    });

    for (const checkbox of this.element.querySelectorAll(".board-row-check")) {
      checkbox.addEventListener("change", (event) => {
        const uuid = event.currentTarget.dataset.uuid;
        if (event.currentTarget.checked) this._selectedUuids.add(uuid);
        else this._selectedUuids.delete(uuid);
        event.currentTarget.closest("tr")?.classList.toggle("is-selected", event.currentTarget.checked);
        this._syncSelectionControls();
      });
    }

    for (const select of this.element.querySelectorAll(".board-party-tier")) {
      select.addEventListener("change", (event) => {
        const value = event.currentTarget.value;
        if (value === "") return;
        const uuid = event.currentTarget.dataset.uuid;
        const userIds = getPlayerUsers().map((user) => user.id);
        if (!userIds.length) return;
        runCommand(
          {
            type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
            uuids: [uuid],
            userIds,
            tier: Number(value),
            source: "gm",
            grantedBy: game.user.id,
          },
          { unchanged: "BESTIARY.Lock.Blocked" },
        );
      });
    }

    for (const select of this.element.querySelectorAll(".board-tier")) {
      select.addEventListener("change", (event) => {
        const { uuid, userId } = event.currentTarget.dataset;
        runCommand(
          {
            type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
            uuids: [uuid],
            userIds: [userId],
            tier: Number(event.currentTarget.value),
            source: "gm",
          },
          { unchanged: "BESTIARY.Lock.Blocked" },
        );
      });
    }

    this._applySearchFilter();
    playApplicationEntrance(this, ".knowledge-board-shell");
  }

  _visibleUnlockedUuids() {
    const domRows = [...(this.element?.querySelectorAll("tbody tr[data-uuid]") ?? [])];
    if (domRows.length > 0) {
      return domRows
        .filter((row) => !row.classList.contains("is-filtered-out") && !row.classList.contains("is-locked"))
        .map((row) => row.dataset.uuid);
    }
    const query = this._searchQuery;
    return (this._rows ?? [])
      .filter((row) => !row.locked && (!query || row.searchText.includes(query)))
      .map((row) => row.uuid);
  }

  _clearSearch() {
    const input = this.element?.querySelector(".board-search-input");
    if (!input) return;
    input.value = "";
    this._searchQuery = "";
    this._applySearchFilter();
    input.focus();
  }

  _applySearchFilter() {
    const query = this._searchQuery;
    let shown = 0;
    for (const row of this.element?.querySelectorAll("tbody tr[data-uuid]") ?? []) {
      const match = !query || (row.dataset.searchText ?? "").includes(query);
      row.classList.toggle("is-filtered-out", !match);
      if (match) shown += 1;
    }
    this.element?.querySelector(".board-search-clear")?.classList.toggle("is-visible", !!query);
    const empty = this.element?.querySelector(".board-search-empty");
    if (empty) empty.hidden = shown > 0 || !(this._rows?.length > 0);
    this._syncSelectionControls();
  }

  _syncSelectionControls() {
    const visibleUnlocked = this._visibleUnlockedUuids();
    const visibleSelectedCount = visibleUnlocked.filter((uuid) => this._selectedUuids.has(uuid)).length;
    const selectAll = this.element?.querySelector(".board-select-all");
    if (selectAll) {
      selectAll.disabled = visibleUnlocked.length === 0;
      selectAll.checked = visibleUnlocked.length > 0 && visibleSelectedCount === visibleUnlocked.length;
      selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleUnlocked.length;
    }

    const totalSelected = this._selectedUuids.size;
    this.element
      ?.querySelector(".knowledge-board-controls")
      ?.classList.toggle("has-selection", visibleSelectedCount > 0);
    const applySelected = this.element?.querySelector('[data-action="applySelected"]');
    if (applySelected) {
      applySelected.disabled = visibleSelectedCount === 0;
      applySelected.querySelector("span").textContent = game.i18n.format("BESTIARY.Board.ApplySelected", {
        count: visibleSelectedCount,
      });
    }
    const applyAll = this.element?.querySelector('[data-action="applyAll"]');
    if (applyAll) {
      applyAll.disabled = visibleUnlocked.length === 0;
      applyAll.querySelector("span").textContent = game.i18n.format("BESTIARY.Board.ApplyAll", {
        count: visibleUnlocked.length,
      });
    }
    const clearBtn = this.element?.querySelector('[data-action="clearSelection"]');
    if (clearBtn) clearBtn.hidden = totalSelected === 0;
    const summary = this.element?.querySelector(".board-selection-status");
    if (summary) {
      summary.textContent =
        visibleSelectedCount > 0
          ? game.i18n.format("BESTIARY.Board.SelectedCount", { count: visibleSelectedCount })
          : localize("BESTIARY.Board.SelectHint");
    }
  }

  _clearSelection() {
    this._selectedUuids.clear();
    for (const checkbox of this.element?.querySelectorAll(".board-row-check") ?? []) {
      checkbox.checked = false;
      checkbox.closest("tr")?.classList.remove("is-selected");
    }
    this._syncSelectionControls();
  }

  _bulkTarget() {
    const tier = Number(this.element.querySelector(".board-bulk-tier").value);
    const userId = this.element.querySelector(".board-bulk-user").value;
    const userIds = userId ? [userId] : getPlayerUsers().map((user) => user.id);
    return { tier, userIds };
  }

  async _onApplySelected() {
    const { tier, userIds } = this._bulkTarget();
    const visibleUnlocked = new Set(this._visibleUnlockedUuids());
    const uuids = [...this._selectedUuids].filter((uuid) => visibleUnlocked.has(uuid));
    if (!uuids.length || !userIds.length) return;
    await runCommand({
      type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
      uuids,
      userIds,
      tier,
      source: "gm",
      grantedBy: game.user.id,
    });
    for (const uuid of uuids) this._selectedUuids.delete(uuid);
    for (const checkbox of this.element?.querySelectorAll(".board-row-check") ?? []) {
      if (uuids.includes(checkbox.dataset.uuid)) {
        checkbox.checked = false;
        checkbox.closest("tr")?.classList.remove("is-selected");
      }
    }
    this._syncSelectionControls();
  }

  async _onApplyAll() {
    const { tier, userIds } = this._bulkTarget();
    const uuids = this._visibleUnlockedUuids();
    if (!uuids.length || !userIds.length) return;
    const tierLabel = describeTier(tier).label;
    const confirmed = await confirmDialog({
      title: localize("BESTIARY.Board.Apply"),
      yesLabel: localize("BESTIARY.Board.Apply"),
      content: `<p>${foundry.utils.escapeHTML(
        game.i18n.format("BESTIARY.Board.ConfirmBulk", {
          creatures: formatCount("BESTIARY.Count.Creatures", uuids.length),
          tier: tierLabel,
        }),
      )}</p>`,
    });
    if (!confirmed) return;
    await runCommand({
      type: BESTIARY_COMMANDS.SET_KNOWLEDGE,
      uuids,
      userIds,
      tier,
      source: "gm",
      grantedBy: game.user.id,
    });
  }
}
