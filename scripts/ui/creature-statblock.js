import { formatMod, formatCR, localizeDndLabel, formatDistanceUnit } from "../integrations/dnd5e.js";
import {
  MAX_RESEARCH_TIER,
  isBlockVisible,
  isGmTier,
  isItemVisible,
  itemTierKey,
  requiredTierForItem
} from "../core/research-model.js";
import { localizedTierChoices } from "../foundry/creature-display.js";
import { describeTier } from "../foundry/research.js";
import { getDnd5eConfig, localize } from "../foundry/foundry-runtime.js";
import { speedEntries } from "./creature-cards.js";

/**
 * The statblock half of a creature card, already cut down to the viewer's tier: `show(key)` says
 * whether a block is known. Nothing hidden is returned, except to the GM, who keeps hidden content
 * with a tier control.
 */

const CONTENT_SECTION_DEFS = [
  ["features", "BESTIARY.Features", "fa-wand-magic-sparkles"],
  ["actions", "BESTIARY.Actions", "fa-khanda"],
  ["bonusActions", "BESTIARY.BonusActions", "fa-bolt"],
  ["reactions", "BESTIARY.Reactions", "fa-shield"],
  ["legendaryActions", "BESTIARY.LegendaryActions", "fa-crown"],
  ["spells", "BESTIARY.Spellcasting", "fa-wand-sparkles"],
  ["inventory", "BESTIARY.Inventory", "fa-bag-shopping"]
];

/**
 * Damage defenses as one list of chips, only for blocks the viewer knows:
 * green protects (full shield = immunity, half = resistance, arrow = flat
 * reduction), red hurts (vulnerability, flat increase).
 */
export function buildDamageDefenses(creature, showBlock) {
  const chips = [];
  const add = (block, title, values, chip) => {
    if (!showBlock[block]) return;
    for (const value of values) chips.push({ title: localize(title), ...chip(value) });
  };
  add("immunities", "BESTIARY.Immunities", creature.immunities,
    label => ({ label, kind: "positive", icon: "fa-shield" }));
  add("resistances", "BESTIARY.Resistances", creature.resistances,
    label => ({ label, kind: "positive", icon: "fa-shield-halved" }));
  add("damageModifications", "BESTIARY.DamageModifications", creature.damageModifications,
    ({ text, amount }) => amount < 0
      ? { label: text, kind: "positive", icon: "fa-arrow-down" }
      : { label: text, kind: "danger", icon: "fa-arrow-up" });
  add("vulnerabilities", "BESTIARY.Vulnerabilities", creature.vulnerabilities,
    label => ({ label, kind: "danger", icon: "fa-heart-crack" }));
  return chips;
}

export function decorateCreature(creature, show) {
  const hpRatio = creature.hp.max > 0 ? creature.hp.value / creature.hp.max : 0;
  const knowsName = show("name");
  const typeLabel = [
    creature.size,
    creature.creatureType,
    creature.creatureSubtype ? `(${creature.creatureSubtype})` : ""
  ].filter(Boolean).join(" · ");
  return {
    ...creature,
    displayName: knowsName ? creature.name : localize("BESTIARY.Tier.UnknownName"),
    knowsName,
    crFormatted: formatCR(creature.cr),
    typeLabel: show("type") ? typeLabel : localize("BESTIARY.Tier.UnknownType"),
    showAlignment: show("alignment") && !!creature.alignment,
    lowHp: creature.hp.max > 0 && hpRatio <= 0.25
  };
}

export function buildTierSteps(tier) {
  const current = isGmTier(tier) ? MAX_RESEARCH_TIER : tier;
  return [0, 1, 2, 3].map(value => {
    const definition = describeTier(value);
    return {
      value,
      label: definition.label,
      icon: definition.icon,
      reached: value <= current,
      isCurrent: value === current
    };
  });
}

export function buildStatEntries(creature, tier, blockTiers) {
  const dnd5e = getDnd5eConfig();
  const abilityEntries = Object.entries(creature.abilities)
    .filter(([key]) => isBlockVisible(key, tier, blockTiers))
    .map(([key, ability]) => ({
      key,
      label: localizeDndLabel("AbilityAbbreviations", {}, key, dnd5e.abilities?.[key]?.abbreviation ?? ability.label),
      fullLabel: ability.label,
      value: ability.value,
      mod: formatMod(ability.mod),
      save: formatMod(ability.save)
    }));

  return {
    abilityEntries,
    skillEntries: Object.values(creature.skills)
      .map(skill => ({ label: skill.label, total: formatMod(skill.total) })),
    speedEntries: speedEntries(creature),
    senseEntries: buildSenseEntries(creature, dnd5e)
  };
}

function buildSenseEntries(creature, dnd5e) {
  const unit = formatDistanceUnit(creature.senseUnits);
  return Object.entries(creature.senses).map(([key, value]) => ({
    label: key === "special"
      ? localize("BESTIARY.SpecialSenses")
      : localizeDndLabel("Senses", dnd5e.senses, key, key),
    value: typeof value === "number" ? `${value} ${unit}` : value
  }));
}

/**
 * Builds one accordion per content block. Items the viewer may not see are
 * dropped entirely; the GM instead keeps them with a tier control so the
 * hidden ones stay obvious. `expanded` holds the open section and item keys.
 */
export function buildContentSections(creature, tier, blockTiers, entry, isGM, expanded) {
  const sections = [];
  for (const [key, label, icon] of CONTENT_SECTION_DEFS) {
    const source = creature[key] ?? [];
    if (!source.length) continue;
    const blockVisible = isBlockVisible(key, tier, blockTiers);
    if (!blockVisible && !isGM) continue;

    const items = source
      .filter(item => isGM || isItemVisible(key, item.id ?? item.name, tier, blockTiers, entry.itemTiers))
      .map(item => decorateItem(item, key, blockTiers, entry, isGM, expanded.items));
    if (!items.length) continue;

    sections.push({
      key,
      label: localize(label),
      icon,
      count: items.length,
      expanded: expanded.sections.has(key),
      items,
      isSpells: key === "spells",
      blockHiddenForPlayers: !blockVisible,
      hiddenItemCount: items.filter(item => item.hiddenForPlayers).length
    });
  }

  if (creature.biography && (isBlockVisible("biography", tier, blockTiers) || isGM)) {
    sections.push({
      key: "biography",
      label: localize("BESTIARY.Biography"),
      icon: "fa-feather-pointed",
      count: null,
      expanded: expanded.sections.has("biography"),
      isBiography: true,
      biography: creature.biography,
      blockHiddenForPlayers: !isBlockVisible("biography", tier, blockTiers),
      items: []
    });
  }
  return sections;
}

function decorateItem(item, blockKey, blockTiers, entry, isGM, expandedItems) {
  const itemId = item.id ?? item.name;
  const itemKey = `${blockKey}:${itemId}`;
  const override = entry.itemTiers?.[itemTierKey(blockKey, itemId)];
  const required = requiredTierForItem(blockKey, itemId, blockTiers, entry.itemTiers);
  return {
    ...item,
    itemKey,
    blockKey,
    itemId,
    expanded: expandedItems.has(itemKey),
    primaryActivity: item.activities?.[0] ?? null,
    hasActivity: (item.activities?.length ?? 0) > 0,
    hiddenForPlayers: !isItemVisible(blockKey, itemId, MAX_RESEARCH_TIER, blockTiers, entry.itemTiers),
    requiredTier: required,
    requiredTierLabel: describeTier(required).label,
    tierChoices: isGM
      ? localizedTierChoices(override === undefined ? "" : override, { includeInherit: true })
      : []
  };
}

export function buildBlockVisibility(creature, stats, show) {
  return {
    portrait: show("portrait"),
    name: show("name"),
    type: show("type"),
    ac: show("ac"),
    hp: show("hp"),
    cr: show("cr"),
    xp: show("xp"),
    speed: show("speed") && stats.speedEntries.length > 0,
    skills: show("skills") && stats.skillEntries.length > 0,
    senses: show("senses") && stats.senseEntries.length > 0,
    languages: show("languages") && creature.languages.length > 0,
    resistances: show("resistances") && creature.resistances.length > 0,
    immunities: show("immunities") && creature.immunities.length > 0,
    vulnerabilities: show("vulnerabilities") && creature.vulnerabilities.length > 0,
    damageModifications: show("damageModifications") && creature.damageModifications.length > 0,
    conditionImmunities: show("conditionImmunities") && creature.conditionImmunities.length > 0
  };
}
