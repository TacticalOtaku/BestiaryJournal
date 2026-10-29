import { getEntryContexts, getUserTier, isCreatureEntryVisible, isSectionVisible } from "./bestiary-domain.js";
import {
  GM_TIER,
  MIN_RESEARCH_TIER,
  isBlockVisible,
  isItemVisible,
  requiredTierForItem,
  resolveBlockTiers
} from "./research-model.js";

/** The viewer of a public post: all players together. */
export const PARTY_VIEWER = Object.freeze({ id: "", isGM: false, isParty: true });

/**
 * A viewer's knowledge tier of one creature. The party knows only what its least-informed player does, and a
 * world without players knows nothing, so a public post never shows more than the party knows.
 */
export function viewerTier(knowledge, viewer, uuid, players = []) {
  if (viewer?.isGM) return GM_TIER;
  if (viewer?.isParty) {
    return players.length
      ? Math.min(...players.map(user => getUserTier(knowledge, user.id, uuid)))
      : MIN_RESEARCH_TIER;
  }
  return getUserTier(knowledge, viewer?.id, uuid);
}

/** The (collection, entry) pairs players can see: the ones whose reveal thresholds count. */
export function playerEntryContexts(data, uuid) {
  return getEntryContexts(data, uuid)
    .filter(({ section, entry }) => isSectionVisible(section, PARTY_VIEWER)
      && isCreatureEntryVisible(entry, section, PARTY_VIEWER));
}

/**
 * Reveal thresholds of a creature that sits in several collections: per block and per item, the lowest among
 * the entries players can see (docs/adr/0001). With no entry the world thresholds apply.
 */
function mergeRevealThresholds(worldTiers, entries) {
  const resolved = entries.map(entry => ({
    blocks: resolveBlockTiers(worldTiers, entry?.blockTiers),
    items: entry?.itemTiers ?? {}
  }));
  if (!resolved.length) return { blockTiers: resolveBlockTiers(worldTiers, null), itemTiers: {} };

  const blockTiers = {};
  for (const key of Object.keys(resolved[0].blocks)) {
    blockTiers[key] = Math.min(...resolved.map(({ blocks }) => blocks[key]));
  }
  // An entry without an override for an item still reveals it at its own block threshold.
  const itemTiers = {};
  for (const key of new Set(resolved.flatMap(({ items }) => Object.keys(items)))) {
    const split = key.indexOf(":");
    const blockKey = key.slice(0, split);
    const itemId = key.slice(split + 1);
    itemTiers[key] = Math.min(...resolved.map(({ blocks, items }) => requiredTierForItem(blockKey, itemId, blocks, items)));
  }
  return { blockTiers, itemTiers };
}

/**
 * What one viewer knows about one creature. Every page asks the lens what to show, so a block or an item
 * appears on all of them at the same tier.
 */
export function createKnowledgeLens({ tier, worldTiers, entries = [] }) {
  const { blockTiers, itemTiers } = mergeRevealThresholds(worldTiers, entries);
  const show = blockKey => isBlockVisible(blockKey, tier, blockTiers);
  return {
    tier,
    blockTiers,
    itemTiers,
    show,
    showItem: (blockKey, itemId) => isItemVisible(blockKey, itemId, tier, blockTiers, itemTiers),
    knowsName: show("name"),
    // An automatic DC follows CR and an automatic skill the creature type: known once those are.
    knowsDc: config => !!config?.isDcExplicit || show("cr"),
    knowsSkill: config => !!config?.isSkillsExplicit || show("type")
  };
}
