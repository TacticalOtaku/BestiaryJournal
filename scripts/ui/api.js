import { BESTIARY_COMMANDS, getEntryContexts, getUserTier } from "../core/bestiary-domain.js";
import { canUserViewBestiaryCreature, dispatchBestiaryCommand, getBestiaryData, getBestiaryKnowledge } from "../foundry/bestiary-store.js";
import { getPlayerUsers } from "../foundry/foundry-runtime.js";
import { BestiaryApp } from "./bestiary-app.js";
import { BestiaryCreatureView } from "./creature-view.js";
import { BestiaryKnowledgeBoard } from "./knowledge-board.js";
import { BestiarySectionView } from "./section-view.js";

/** The section a caller named by id or by its exact name. */
function findSectionRef(sectionRef) {
  const sections = getBestiaryData().sections;
  return sections.find(section => section.id === sectionRef) ?? sections.find(section => section.name === sectionRef) ?? null;
}

/**
 * The public face of the module, for macros and other modules: `game.bestiaryJournal`, also
 * `game.modules.get("bestiary-journal").api`. Writes go through the authoritative GM like every other
 * change, so they reject (BestiaryCommandError) where the caller has no right to them. See API.md.
 */
export function createApi() {
  return {
    mainApp: null,

    open() {
      if (!this.mainApp) this.mainApp = new BestiaryApp();
      this.mainApp.render({ force: true });
    },
    close() {
      if (this.mainApp?.rendered) this.mainApp.close();
    },
    toggle() {
      if (this.mainApp?.rendered) this.close();
      else this.open();
    },

    /** Opens a creature's card; `options.sectionId` picks the collection, `options.rail` the side tab. */
    openCreature(uuid, options = {}) {
      if (!uuid) return;
      if (!canUserViewBestiaryCreature(uuid)) {
        ui.notifications.warn(game.i18n.localize("BESTIARY.CreatureUnavailable"));
        return;
      }
      const current = [...BestiaryCreatureView._instances].find(app => app.actorUuid === uuid && app.rendered);
      if (current) {
        current.bringToFront();
        return current;
      }
      const app = new BestiaryCreatureView({ uuid, ...options });
      app.render({ force: true });
      return app;
    },

    /** Opens a collection by id or by name. */
    openCollection(sectionRef) {
      const section = findSectionRef(sectionRef);
      if (!section) return null;
      const app = new BestiarySectionView({ sectionId: section.id });
      app.render({ force: true });
      return app;
    },

    /** GM: the party knowledge board, optionally on one collection. */
    openKnowledgeBoard(sectionRef) {
      return BestiaryKnowledgeBoard.open(sectionRef ? findSectionRef(sectionRef)?.id ?? "" : "");
    },

    /** Whether the actor has an entry in any collection. */
    isInBestiary(uuid) {
      return getEntryContexts(getBestiaryData(), uuid).length > 0;
    },

    /** Whether the current user may open the creature. */
    canView(uuid) {
      return canUserViewBestiaryCreature(uuid);
    },

    /** A user's tier for a creature: 0 unknown … 3 mastered. */
    getTier(uuid, userId = game.user.id) {
      return getUserTier(getBestiaryKnowledge(), userId, uuid);
    },

    /** GM: sets the tier of one or many creatures for some players, or for the whole party with "party". */
    grantKnowledge(uuids, userIds, tier) {
      const players = userIds === "party" ? getPlayerUsers().map(user => user.id) : [].concat(userIds);
      return dispatchBestiaryCommand({
        type: BESTIARY_COMMANDS.SET_KNOWLEDGE, uuids: [].concat(uuids), userIds: players, tier: Number(tier), source: "gm"
      });
    },

    /** GM: adds an actor to a collection named by id or by name. */
    async addToCollection(uuid, sectionRef) {
      const section = findSectionRef(sectionRef);
      const actor = await fromUuid(uuid);
      if (!section || !actor) return { changed: false };
      return dispatchBestiaryCommand({
        type: BESTIARY_COMMANDS.ADD_CREATURE, sectionId: section.id, uuid: actor.uuid, label: actor.name, thumb: actor.img
      });
    }
  };
}
