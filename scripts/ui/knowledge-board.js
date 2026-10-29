import { BESTIARY_COMMANDS, getUserTier, isCreatureLocked } from "../core/bestiary-domain.js";
import { RESEARCH_TIERS } from "../core/research-model.js";
import { getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { runCommand } from "../foundry/command-feedback.js";
import { getCreatureDataMany } from "../foundry/creature-cache.js";
import { formatCount, getPlayerUsers, localize } from "../foundry/foundry-runtime.js";
import { playApplicationEntrance } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const ALL = "";

/**
 * The GM's view of what the party knows: one row per creature, one column per player, a tier in each cell.
 * A cell changes one player's tier; the bar above sets one tier for every creature in the selection.
 */
export class BestiaryKnowledgeBoard extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-knowledge-board",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-knowledge-board"],
    window: { title: "BESTIARY.Board.Title", icon: "fa-solid fa-table-cells", resizable: true },
    position: { width: 820, height: 640 },
    actions: {
      applyBulk: function () { this._onApplyBulk(); }
    }
  };

  static PARTS = {
    main: { template: "modules/bestiary-journal/templates/knowledge-board.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this._scope = options.sectionId ?? ALL;
  }

  /** Opens the board, or brings it forward on the given collection. */
  static open(sectionId = ALL) {
    const current = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (current) {
      current._scope = sectionId;
      current.render({ force: true });
      current.bringToFront();
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
    const sections = this._scope ? data.sections.filter(section => section.id === this._scope) : data.sections;
    const uuids = [...new Set(sections.flatMap(section => section.creatures.map(entry => entry.uuid)))];
    const resolved = await getCreatureDataMany(uuids);
    const tierChoice = (tier, selected) => RESEARCH_TIERS.map(definition => ({
      value: definition.value, label: localize(definition.label), selected: definition.value === selected
    }));
    const rows = uuids.filter(uuid => resolved.get(uuid)).map(uuid => {
      const creature = resolved.get(uuid);
      return {
        uuid,
        name: creature.name,
        img: creature.img,
        locked: isCreatureLocked(data, uuid),
        cells: players.map(user => {
          const tier = getUserTier(knowledge, user.id, uuid);
          return { userId: user.id, key: RESEARCH_TIERS[tier].key, options: tierChoice(tier, tier) };
        })
      };
    }).sort((left, right) => left.name.localeCompare(right.name));
    this._rows = rows;
    return {
      players,
      rows,
      scopes: [
        { id: ALL, label: localize("BESTIARY.Board.AllCollections"), selected: !this._scope },
        ...data.sections.map(section => ({ id: section.id, label: section.name, selected: section.id === this._scope }))
      ],
      tierOptions: tierChoice(1, 1)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector(".board-scope")?.addEventListener("change", event => {
      this._scope = event.currentTarget.value;
      this.render();
    });
    for (const select of this.element.querySelectorAll(".board-tier")) {
      select.addEventListener("change", event => {
        const { uuid, userId } = event.currentTarget.dataset;
        runCommand({ type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuids: [uuid], userIds: [userId], tier: Number(event.currentTarget.value), source: "gm" },
          { unchanged: "BESTIARY.Lock.Blocked" });
      });
    }
    playApplicationEntrance(this, ".knowledge-board-shell");
  }

  /** One tier for every unlocked creature in the selection, for the whole party or one player. */
  async _onApplyBulk() {
    const tier = Number(this.element.querySelector(".board-bulk-tier").value);
    const userId = this.element.querySelector(".board-bulk-user").value;
    const userIds = userId ? [userId] : getPlayerUsers().map(user => user.id);
    const uuids = (this._rows ?? []).filter(row => !row.locked).map(row => row.uuid);
    if (!uuids.length || !userIds.length) return;
    const tierLabel = localize(RESEARCH_TIERS[tier].label);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("BESTIARY.Board.Apply") },
      content: `<p>${foundry.utils.escapeHTML(game.i18n.format("BESTIARY.Board.ConfirmBulk", {
        creatures: formatCount("BESTIARY.Count.Creatures", uuids.length), tier: tierLabel
      }))}</p>`,
      yes: { label: localize("BESTIARY.Board.Apply") },
      no: { label: localize("BESTIARY.Cancel") },
      rejectClose: false
    });
    if (!confirmed) return;
    await runCommand({ type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuids, userIds, tier, source: "gm" });
  }
}
