import { MAX_RESEARCH_TIER, MIN_RESEARCH_TIER, RESEARCH_TIERS } from "./research-model.js";

/**
 * How far a viewer (or the party) got through a set of creatures: how many are
 * known at all, and how many sit on each tier, for the coloured progress bar.
 */
export function tierProgress(tiers) {
  const counts = RESEARCH_TIERS.map(() => 0);
  for (const tier of tiers) counts[Math.max(MIN_RESEARCH_TIER, Math.min(MAX_RESEARCH_TIER, Number(tier) || 0))] += 1;
  return {
    total: tiers.length,
    known: tiers.length - counts[MIN_RESEARCH_TIER],
    segments: RESEARCH_TIERS.map((definition, index) => ({ key: definition.key, count: counts[index] }))
      .filter(segment => segment.count > 0)
  };
}

/** The creatures whose tier rose between two snapshots of one viewer's knowledge ({uuid: tier}). */
export function tierIncreases(before, after) {
  return Object.entries(after ?? {})
    .filter(([uuid, tier]) => tier > (before?.[uuid] ?? MIN_RESEARCH_TIER))
    .map(([uuid, tier]) => ({ uuid, from: before?.[uuid] ?? MIN_RESEARCH_TIER, to: tier }));
}

/** A creature is new to a viewer until they open it, and again whenever they learn more about it. */
export function isNewToViewer(seenTier, tier) {
  return seenTier === undefined || seenTier === null || Number(tier) > Number(seenTier);
}
