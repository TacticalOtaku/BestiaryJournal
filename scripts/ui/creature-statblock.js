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
import { buildImageView } from "../core/image-framing.js";
import { describeTier } from "../foundry/research.js";
import { getDnd5eConfig, localize } from "../foundry/foundry-runtime.js";
import { speedEntries } from "./creature-cards.js";

/**
 * The statblock half of a creature card, already cut down to the viewer's tier: the knowledge lens says
 * whether a block or an item is known. Nothing hidden is returned, except to the GM, who keeps hidden content
 * with a tier control.
 */

/**
 * The creature fields each block reveals. A field missing here never reaches the card, so a field dnd5e adds
 * later stays hidden until it is given a block. Items and the biography go through the content sections.
 */
const BLOCK_FIELDS = Object.freeze({
  name: ["name"],
  type: ["size", "creatureType", "creatureSubtype", "creatureTypeKey"],
  alignment: ["alignment"],
  ac: ["ac"],
  hp: ["hp"],
  cr: ["cr"],
  xp: ["xp"],
  speed: ["speeds", "speedUnits", "movementTraits"],
  abilities: ["abilities"],
  skills: ["skills"],
  senses: ["senses", "senseUnits"],
  languages: ["languages"],
  resistances: ["resistances"],
  immunities: ["immunities"],
  vulnerabilities: ["vulnerabilities"],
  damageModifications: ["damageModifications"],
  conditionImmunities: ["conditionImmunities"]
});

/**
 * Everything the card shows of a creature's statistics, as `viewer` may see it. `isGM` is the GM editing the
 * card (not previewing), who also gets hidden items with their tier controls; `expanded` holds the open
 * section and item keys.
 */
export function buildStatblock(creatureData, lens, entry, { isGM = false, expanded }) {
  const creature = decorateCreature(knownFields(creatureData, lens), creatureData, lens);
  const stats = buildStatEntries(creature);
  const contentSections = buildContentSections(creatureData, lens, entry, isGM, expanded);
  const showBlock = buildBlockVisibility(creature, stats, lens.show);
  return {
    creature,
    image: buildImageView(entry, creatureData, { silhouette: !lens.show("portrait") }),
    ...stats,
    contentSections,
    showBlock,
    showAbilities: lens.show("abilities") && stats.abilityEntries.length > 0,
    damageDefenses: buildDamageDefenses(creature, showBlock),
    showDefenses: showBlock.resistances || showBlock.immunities || showBlock.vulnerabilities
      || showBlock.damageModifications || showBlock.conditionImmunities,
    showVitals: showBlock.ac || showBlock.hp || showBlock.cr || showBlock.xp,
    hasContent: contentSections.length > 0,
    isBlank: !showBlock.ac && !showBlock.hp && !lens.show("abilities") && contentSections.length === 0
  };
}

function knownFields(creature, lens) {
  const known = {};
  for (const [block, fields] of Object.entries(BLOCK_FIELDS)) {
    if (!lens.show(block)) continue;
    for (const field of fields) if (field in creature) known[field] = creature[field];
  }
  // Each ability is a block of its own under «abilities».
  if (known.abilities) {
    known.abilities = Object.fromEntries(Object.entries(known.abilities).filter(([key]) => lens.show(key)));
  }
  return known;
}

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
function buildDamageDefenses(creature, showBlock) {
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

function decorateCreature(known, creature, lens) {
  const knowsName = lens.show("name");
  const typeLabel = [
    known.size,
    known.creatureType,
    known.creatureSubtype ? `(${known.creatureSubtype})` : ""
  ].filter(Boolean).join(" · ");
  return {
    ...known,
    displayName: knowsName ? creature.name : localize("BESTIARY.Tier.UnknownName"),
    knowsName,
    crFormatted: "cr" in known ? formatCR(known.cr) : "",
    typeLabel: lens.show("type") ? typeLabel : localize("BESTIARY.Tier.UnknownType"),
    showAlignment: !!known.alignment,
    lowHp: !!known.hp && known.hp.max > 0 && known.hp.value / known.hp.max <= 0.25
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

function buildStatEntries(creature) {
  const dnd5e = getDnd5eConfig();
  const abilityEntries = Object.entries(creature.abilities ?? {})
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
    skillEntries: Object.values(creature.skills ?? {})
      .map(skill => ({ label: skill.label, total: formatMod(skill.total) })),
    speedEntries: speedEntries(creature),
    senseEntries: buildSenseEntries(creature, dnd5e)
  };
}

function buildSenseEntries(creature, dnd5e) {
  const unit = formatDistanceUnit(creature.senseUnits);
  return Object.entries(creature.senses ?? {}).map(([key, value]) => ({
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
function buildContentSections(creature, lens, entry, isGM, expanded) {
  // What players miss even at the top tier; the GM's own view shows everything, so it cannot tell.
  const hiddenForPlayers = key => !isBlockVisible(key, MAX_RESEARCH_TIER, lens.blockTiers);
  const sections = [];
  for (const [key, label, icon] of CONTENT_SECTION_DEFS) {
    const source = creature[key] ?? [];
    if (!source.length) continue;
    const blockVisible = lens.show(key);
    if (!blockVisible && !isGM) continue;

    const items = source
      .filter(item => isGM || lens.showItem(key, item.id ?? item.name))
      .map(item => decorateItem(item, key, lens, entry, isGM, expanded.items));
    if (!items.length) continue;

    sections.push({
      key,
      label: localize(label),
      icon,
      count: items.length,
      expanded: expanded.sections.has(key),
      items,
      isSpells: key === "spells",
      blockHiddenForPlayers: hiddenForPlayers(key),
      hiddenItemCount: items.filter(item => item.hiddenForPlayers).length
    });
  }

  if (creature.biography && (lens.show("biography") || isGM)) {
    sections.push({
      key: "biography",
      label: localize("BESTIARY.Biography"),
      icon: "fa-feather-pointed",
      count: null,
      expanded: expanded.sections.has("biography"),
      isBiography: true,
      biography: creature.biography,
      blockHiddenForPlayers: hiddenForPlayers("biography"),
      items: []
    });
  }
  return sections;
}

/** `override` is this entry's own pick for the GM's control; what players get comes from the lens. */
function decorateItem(item, blockKey, lens, entry, isGM, expandedItems) {
  const itemId = item.id ?? item.name;
  const itemKey = `${blockKey}:${itemId}`;
  const override = entry.itemTiers?.[itemTierKey(blockKey, itemId)];
  const required = requiredTierForItem(blockKey, itemId, lens.blockTiers, lens.itemTiers);
  return {
    ...item,
    itemKey,
    blockKey,
    itemId,
    expanded: expandedItems.has(itemKey),
    primaryActivity: item.activities?.[0] ?? null,
    hasActivity: (item.activities?.length ?? 0) > 0,
    hiddenForPlayers: !isItemVisible(blockKey, itemId, MAX_RESEARCH_TIER, lens.blockTiers, lens.itemTiers),
    requiredTier: required,
    requiredTierLabel: describeTier(required).label,
    tierChoices: isGM
      ? localizedTierChoices(override === undefined ? "" : override, { includeInherit: true })
      : []
  };
}

function buildBlockVisibility(creature, stats, show) {
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
    languages: show("languages") && (creature.languages?.length ?? 0) > 0,
    resistances: show("resistances") && (creature.resistances?.length ?? 0) > 0,
    immunities: show("immunities") && (creature.immunities?.length ?? 0) > 0,
    vulnerabilities: show("vulnerabilities") && (creature.vulnerabilities?.length ?? 0) > 0,
    damageModifications: show("damageModifications") && (creature.damageModifications?.length ?? 0) > 0,
    conditionImmunities: show("conditionImmunities") && (creature.conditionImmunities?.length ?? 0) > 0
  };
}
