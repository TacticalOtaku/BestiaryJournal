import { selectVisibleCreatureEntries } from "../core/bestiary-domain.js";
import { PARTY_VIEWER, createKnowledgeLens, playerEntryContexts, viewerTier } from "../core/knowledge-lens.js";
import { isNewToViewer, tierProgress } from "../core/knowledge-progress.js";
import { getFavoriteCreatureUuids } from "../foundry/client-preferences.js";
import { getCreatureDataMany } from "../foundry/creature-cache.js";
import { getWorldBlockTiers } from "../foundry/creature-display.js";
import { getPlayerUsers } from "../foundry/foundry-runtime.js";
import { describeTier } from "../foundry/research.js";
import { buildCreatureCard, sortByKnownName } from "./creature-cards.js";
import { buildPartyBadge } from "./knowledge-ui.js";

/**
 * The creature rows of the library and of a collection window, as the viewer knows them, with their count and
 * progress. One collection gives its own rows; several give one row per creature.
 */

const MODULE_ID = "bestiary-journal";

export const UNGROUPED_ID = "__ungrouped__";
/** Where a player sees creatures whose name they do not know: their family would hint at what they are. */
export const UNIDENTIFIED_ID = "__unidentified__";

/** Everything the rows read from the world, gathered once per render; `snapshot` is `{ data, knowledge }`. */
export async function rowInputs(sections, { data, knowledge }) {
  const viewer = { id: game.user.id, isGM: game.user.isGM };
  const uuids = new Set(sections.flatMap(section => selectVisibleCreatureEntries(section, viewer).map(entry => entry.uuid)));
  return {
    data,
    knowledge,
    worldTiers: getWorldBlockTiers(),
    viewer,
    players: getPlayerUsers(),
    seenTiers: viewer.isGM ? {} : game.settings.get(MODULE_ID, "seenTiers") ?? {},
    favorites: getFavoriteCreatureUuids(),
    creatures: await getCreatureDataMany([...uuids])
  };
}

export function buildCreatureRows(sections, inputs) {
  const { data, knowledge, worldTiers, viewer, players, seenTiers, favorites, creatures } = inputs;
  const byUuid = new Map();
  for (const section of sections) {
    for (const entry of selectVisibleCreatureEntries(section, viewer)) {
      const seen = byUuid.get(entry.uuid);
      if (seen) {
        seen.collections.push(section.name);
        seen.addedAt = Math.max(seen.addedAt, entry.addedAt ?? 0);
      } else {
        byUuid.set(entry.uuid, { entry, section, collections: [section.name], addedAt: entry.addedAt ?? 0 });
      }
    }
  }

  const rows = [];
  for (const [uuid, { entry, section, collections, addedAt }] of byUuid) {
    const creature = creatures.get(uuid) ?? null;
    // A deleted actor stays listed for the GM to clean up; players neither see nor count it.
    if (!creature && !viewer.isGM) continue;
    const lens = createKnowledgeLens({
      tier: viewerTier(knowledge, viewer, uuid),
      worldTiers,
      entries: playerEntryContexts(data, uuid).map(context => context.entry)
    });
    const card = buildCreatureCard({ uuid, entry, creature, lens, searchExtra: collections });
    rows.push({
      ...card,
      // Also the data-family-id on the card: the real family must not reach the page while the name is hidden.
      familyId: !viewer.isGM && !card.knowsName ? UNIDENTIFIED_ID : entry.familyId ?? UNGROUPED_ID,
      isHidden: !!entry.hidden,
      isLocked: !!entry.locked || !!section.locked,
      addedAt,
      collectionLabel: collections.join(", "),
      isFavorite: favorites.has(uuid),
      viewerTier: lens.tier,
      // The GM follows the party, at the tier every player has reached; with no players there is nothing to follow.
      progressTier: !viewer.isGM ? lens.tier : players.length ? viewerTier(knowledge, PARTY_VIEWER, uuid, players) : null,
      isNew: !viewer.isGM && isNewToViewer(seenTiers[uuid], lens.tier),
      tierBadge: viewer.isGM ? buildPartyBadge(knowledge, uuid, players) : describeTier(lens.tier)
    });
  }
  return sortByKnownName(rows);
}

/** How many rows there are and how far the viewer got; a deleted actor is nothing to learn. */
export function summarizeRows(rows) {
  const progress = tierProgress(rows.filter(row => !row.isMissing && row.progressTier !== null).map(row => row.progressTier));
  return { count: rows.length, progress: progress.total ? progress : null };
}
