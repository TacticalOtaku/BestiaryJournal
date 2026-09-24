import {
  enrichHtml,
  getDnd5eConfig,
  hasTranslation,
  localize
} from "./foundry-runtime.mjs";

// ── Text enrichment ──

export async function enrichText(text, options = {}) {
  if (!text) return "";
  try {
    const relativeTo = options.item ?? options.actor ?? undefined;
    return await enrichHtml(text, {
      secrets: false, documents: true, links: true, rolls: true,
      embeds: true, relativeTo,
      rollData: options.actor?.getRollData?.() ?? {}
    });
  } catch (e) {
    console.warn("Bestiary: Failed to enrich HTML text", e);
    return text;
  }
}

// ── NPC data extraction ──

export async function extractCreatureData(actor, { enrich = false } = {}) {
  const system = actor.system ?? {};
  const creature = {
    id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img,
    prototypeToken: actor.prototypeToken?.texture?.src ?? actor.img,
    ...extractAbilitiesAndSkills(system),
    ...extractMovement(system),
    ...extractTraitsAndSenses(system),
    ...extractIdentityAndVitals(system),
    ...categorizeActorItems(actor),
    // dnd5e keeps a player-facing biography next to the full one; prefer it
    // when the GM wrote one, otherwise fall back to the main text (its
    // secret blocks are stripped during enrichment).
    biography: system.details?.biography?.public || system.details?.biography?.value || ""
  };
  return enrich
    ? enrichCreatureData(creature, actor)
    : stripCreatureDocuments(creature);
}

function extractAbilitiesAndSkills(system) {
  const dnd5e = getDnd5eConfig();
  const abilities = {};
  for (const [key, ability] of Object.entries(system.abilities ?? {})) {
    const value = _numericValue(ability.value) ?? 10;
    const mod = _numericValue(ability.mod) ?? Math.floor((value - 10) / 2);
    abilities[key] = {
      value,
      mod,
      save: _numericValue(ability.save) ?? mod,
      label: localizeDndLabel("Abilities", dnd5e.abilities, key, key.toUpperCase())
    };
  }

  const skills = {};
  for (const [key, skill] of Object.entries(system.skills ?? {})) {
    if (Number(skill.value ?? 0) <= 0) continue;
    skills[key] = {
      label: localizeDndLabel("Skills", dnd5e.skills, key, key),
      total: skill.total,
      value: skill.value
    };
  }
  return { abilities, skills };
}

function extractMovement(system) {
  const movement = system.attributes?.movement ?? {};
  const speeds = {};
  for (const key of ["walk", "burrow", "climb", "fly", "swim"]) {
    const numeric = Number(movement[key]);
    if (Number.isFinite(numeric) && numeric > 0) speeds[key] = numeric;
  }

  const movementTraits = [];
  if (movement.hover) movementTraits.push(localize("BESTIARY.HoverMovement"));
  if (typeof movement.special === "string" && movement.special.trim()) {
    movementTraits.push(`${localize("BESTIARY.SpeedSpecial")}: ${movement.special.trim()}`);
  }
  const ignoredTerrain = movement.ignoredDifficultTerrain;
  if (ignoredTerrain === true || ignoredTerrain?.size > 0 || ignoredTerrain?.length > 0) {
    movementTraits.push(localize("BESTIARY.IgnoresDifficultTerrain"));
  }
  return { speeds, speedUnits: movement.units ?? "ft", movementTraits };
}

function extractTraitsAndSenses(system) {
  const dnd5e = getDnd5eConfig();
  const sensesData = system.attributes?.senses ?? {};
  const senseRanges = sensesData.ranges ?? {};
  const senses = Object.fromEntries(
    Object.entries(senseRanges).filter(([, value]) => !!value)
  );
  if (sensesData.special) senses.special = sensesData.special;

  return {
    resistances: _traitArray(system.traits?.dr, dnd5e.damageTypes, "DamageTypes"),
    immunities: _traitArray(system.traits?.di, dnd5e.damageTypes, "DamageTypes"),
    vulnerabilities: _traitArray(system.traits?.dv, dnd5e.damageTypes, "DamageTypes"),
    conditionImmunities: _traitArray(system.traits?.ci, dnd5e.conditionTypes, "Conditions"),
    languages: _traitArray(system.traits?.languages, dnd5e.languages, "Languages"),
    senses,
    senseUnits: sensesData.units ?? senseRanges.units ?? "ft"
  };
}

function extractIdentityAndVitals(system) {
  const dnd5e = getDnd5eConfig();
  const cr = system.details?.cr ?? 0;
  const creatureTypeKey = system.details?.type?.value ?? "";
  return {
    cr,
    xp: system.details?.xp?.value ?? dnd5e.CR_EXP_LEVELS?.[cr] ?? 0,
    creatureTypeKey,
    creatureType: localizeDndLabel("CreatureTypes", dnd5e.creatureTypes, creatureTypeKey, creatureTypeKey),
    creatureSubtype: system.details?.type?.subtype ?? "",
    size: localizeDndLabel("Sizes", dnd5e.actorSizes, system.traits?.size, system.traits?.size ?? ""),
    alignment: system.details?.alignment ?? "",
    hp: {
      value: system.attributes?.hp?.value ?? 0,
      max: system.attributes?.hp?.max ?? 0,
      formula: system.attributes?.hp?.formula ?? ""
    },
    ac: {
      value: system.attributes?.ac?.value ?? 10,
      label: system.attributes?.ac?.label ?? ""
    }
  };
}

function categorizeActorItems(actor) {
  const buckets = {
    features: [],
    actions: [],
    inventory: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    spells: []
  };
  for (const item of actor.items ?? []) {
    categorizeItem(item, createItemData(item), buckets);
  }
  return buckets;
}

function createItemData(item) {
  return {
    id: item.id,
    uuid: item.uuid,
    name: item.name,
    description: item.system.description?.value ?? "",
    img: item.img,
    _item: item,
    ...extractItemMeta(item)
  };
}

function categorizeItem(item, itemData, buckets) {
  if (item.type === "spell") {
    buckets.spells.push({
      ...itemData,
      level: item.system.level,
      school: item.system.school
    });
    return;
  }

  const activation = _collectionValues(item.system.activities)[0]?.activation?.type;
  if (activation === "bonus") return buckets.bonusActions.push(itemData);
  if (activation === "reaction") return buckets.reactions.push(itemData);
  if (activation === "legendary") return buckets.legendaryActions.push(itemData);
  if (activation === "action" || activation === "attack") return buckets.actions.push(itemData);

  const inventoryTypes = ["equipment", "consumable", "tool", "loot", "container", "backpack", "weapon"];
  if (inventoryTypes.includes(item.type)) return buckets.inventory.push(itemData);
  if (item.type === "feat" && item.system.type?.value === "legendary") {
    return buckets.legendaryActions.push(itemData);
  }
  return buckets.features.push(itemData);
}

async function enrichCreatureData(creature, actor) {
  const listKeys = [
    "features", "actions", "inventory", "bonusActions",
    "reactions", "legendaryActions", "spells"
  ];
  const enrichedLists = await Promise.all(
    listKeys.map(key => enrichItemList(creature[key], actor))
  );
  const result = { ...creature };
  listKeys.forEach((key, index) => { result[key] = enrichedLists[index]; });
  result.biography = await enrichText(creature.biography, { actor });
  return result;
}

function enrichItemList(list, actor) {
  return Promise.all(list.map(async entry => {
    const description = await enrichText(entry.description, {
      actor,
      item: entry._item
    });
    const { _item, ...rest } = entry;
    return { ...rest, description };
  }));
}

function stripCreatureDocuments(creature) {
  const strip = list => list.map(({ _item, ...rest }) => rest);
  return {
    ...creature,
    features: strip(creature.features),
    actions: strip(creature.actions),
    inventory: strip(creature.inventory),
    bonusActions: strip(creature.bonusActions),
    reactions: strip(creature.reactions),
    legendaryActions: strip(creature.legendaryActions),
    spells: strip(creature.spells)
  };
}

function extractItemMeta(item) {
  const system = item.system ?? {};
  const labels = item.labels ?? {};
  const activities = extractItemActivities(item);
  const collector = createMetaCollector();
  const context = { item, system, labels, activities, ...collector };
  const handler = ITEM_META_HANDLERS[item.type] ?? appendDefaultItemMeta;
  handler(context);
  if (!collector.tags.length && activities.length) {
    collector.pushTag(
      "BESTIARY.ItemActivation",
      collectActivationSummary(activities)
    );
  }

  return {
    tags: collector.tags,
    stats: collector.stats,
    activities,
    hasMeta: collector.tags.length > 0
      || collector.stats.length > 0
      || activities.length > 0
  };
}

const ITEM_META_HANDLERS = {
  weapon: appendWeaponMeta,
  equipment: appendEquipmentMeta,
  consumable: appendEquipmentMeta,
  tool: appendEquipmentMeta,
  loot: appendEquipmentMeta,
  container: appendEquipmentMeta,
  backpack: appendEquipmentMeta,
  feat: appendFeatMeta
};

function createMetaCollector() {
  const tags = [];
  const stats = [];
  return {
    tags,
    stats,
    pushTag(label, value, options = {}) {
      if (value === null || value === undefined || value === "") return;
      tags.push({ label, value: String(value), isAccent: !!options.isAccent });
    },
    pushStat(label, value) {
      if (value === null || value === undefined || value === "") return;
      stats.push({ label, value: String(value) });
    }
  };
}

function appendWeaponMeta({ item, system, labels, activities, pushTag, pushStat }) {
  pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.weaponType));
  pushTag("BESTIARY.ItemRange", labels.range ?? formatRange(system.range));
  pushTag("BESTIARY.ItemDamage", labels.damageTypes ?? collectDamageSummary(activities));
  pushTag("BESTIARY.ItemProperties", joinList(collectWeaponProperties(system)), { isAccent: true });
  pushStat("BESTIARY.ItemQuantity", system.quantity);
  pushStat("BESTIARY.ItemWeight", formatWeight(system.weight, labels.weight));
}

function appendEquipmentMeta({ item, system, labels, pushTag, pushStat }) {
  pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.itemType));
  pushTag("BESTIARY.ItemProperties", joinList(collectEquipmentProperties(item, system)), { isAccent: true });
  pushStat("BESTIARY.ItemQuantity", system.quantity);
  pushStat("BESTIARY.ItemWeight", formatWeight(system.weight, labels.weight));
  pushStat("BESTIARY.ItemUses", formatUses(system.uses));
}

function appendFeatMeta({ item, system, labels, activities, pushTag, pushStat }) {
  pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.featType));
  pushTag("BESTIARY.ItemActivation", labels.activation ?? collectActivationSummary(activities));
  pushTag("BESTIARY.ItemRange", labels.range ?? formatRange(system.range));
  pushTag("BESTIARY.ItemProperties", joinList(collectFeatProperties(system, activities)), { isAccent: true });
  pushStat("BESTIARY.ItemUses", formatUses(system.uses));
}

function appendDefaultItemMeta({ item, system, labels, activities, pushTag, pushStat }) {
  pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.itemType));
  pushTag("BESTIARY.ItemActivation", labels.activation ?? collectActivationSummary(activities));
  pushStat("BESTIARY.ItemUses", formatUses(system.uses));
}

function extractItemActivities(item) {
  const activities = _collectionValues(item.system?.activities);
  return activities.map((activity, index) => {
    const activationType = activity?.activation?.type ?? "";
    const actionType = activity?.actionType ?? activity?.type ?? "";
    const attack = formatActivityAttack(activity);
    const damage = formatActivityDamage(activity);
    const save = formatActivitySave(activity);
    const uses = formatUses(activity?.uses);
    const range = formatRange(activity?.range);
    const target = formatTarget(activity?.target);
    const cost = activity?.activation?.cost;

    return {
      id: activity?.id ?? `${item.id}-activity-${index}`,
      name: activity?.name ?? localizeActivityType(actionType || activationType || "activity"),
      typeLabel: localizeActivityType(actionType || activationType || "activity"),
      activationLabel: localizeActivationType(activationType, cost),
      attack,
      damage,
      save,
      range,
      target,
      uses,
      hasData: [attack, damage, save, range, target, uses].some(Boolean)
    };
  });
}

function _collectionValues(collection) {
  if (!collection) return [];
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function formatActivityAttack(activity) {
  const attack = activity?.attack ?? {};
  const bonus = attack?.bonus ?? attack?.value ?? attack?.modifier;
  const ability = attack?.ability;
  const parts = [];
  if (bonus !== null && bonus !== undefined && bonus !== "") {
    const num = Number(bonus);
    parts.push(Number.isFinite(num) ? formatMod(num) : String(bonus));
  }
  if (ability) parts.push(String(ability).toUpperCase());
  return parts.join(" ");
}

function formatActivityDamage(activity) {
  const damage = activity?.damage;
  if (!damage) return "";

  const parts = [];
  const damageParts = Array.isArray(damage?.parts) ? damage.parts : [];
  for (const part of damageParts) {
    if (!part) continue;
    const formula = part.formula ?? part.number ?? "";
    const type = part.type ?? part.damageType ?? "";
    const formatted = [formula, localizeDamageType(type)].filter(Boolean).join(" ");
    if (formatted) parts.push(formatted);
  }

  if (!parts.length) {
    const value = damage?.formula ?? damage?.value ?? damage?.base?.formula;
    if (value) parts.push(String(value));
  }

  return parts.join(", ");
}

function formatActivitySave(activity) {
  const save = activity?.save;
  if (!save) return "";
  const dc = save.dc?.value ?? save.dc ?? "";
  const ability = save.ability ?? save.type ?? "";
  const pieces = [];
  if (ability) pieces.push(localizeAbilityShort(ability));
  if (dc !== "") pieces.push(`DC ${dc}`);
  return pieces.join(" ");
}

function formatRange(range) {
  if (!range) return "";
  const value = range.value ?? range.reach ?? "";
  const long = range.long ?? "";
  const units = normalizeUnit(range.units ?? range.unit ?? "");
  if (!value && !long) return "";
  if (value && long) return `${value}/${long}${units ? ` ${units}` : ""}`;
  return `${value || long}${units ? ` ${units}` : ""}`;
}

function formatTarget(target) {
  if (!target) return "";
  const value = target.value ?? target.count ?? "";
  const type = target.type ?? target.template?.type ?? "";
  if (!value && !type) return "";
  return [value, localizeTargetType(type)].filter(Boolean).join(" ");
}

function formatUses(uses) {
  if (!uses) return "";
  const spent = uses.spent ?? 0;
  const max = uses.max ?? uses.value ?? "";
  if (max === "" || max === null || max === undefined || !Number(max)) return "";
  return `${Math.max(Number(max) - Number(spent || 0), 0)}/${max}`;
}

function formatWeight(weight, fallback = "") {
  if (weight === null || weight === undefined || weight === "") return _labelText(fallback);
  if (typeof weight === "number" || typeof weight === "string") return String(weight);

  if (typeof weight === "object") {
    const value = _numericValue(weight.value ?? weight.amount ?? weight.weight);
    const unitKey = _traitKey(weight.units ?? weight.unit ?? weight.type).toLowerCase();
    const unit = _weightUnitLabel(unitKey);
    if (value !== null && unit) return `${value} ${unit}`;

    const fallbackText = _labelText(fallback);
    if (fallbackText) return fallbackText;
    if (value !== null) return String(value);

    return _labelText(weight.label ?? weight.name);
  }

  return "";
}

function _weightUnitLabel(unit) {
  if (["lb", "lbs", "pound", "pounds"].includes(unit)) return localize("BESTIARY.UnitPounds");
  if (["kg", "kgs", "kilogram", "kilograms"].includes(unit)) return localize("BESTIARY.UnitKilograms");
  if (["ton", "tons"].includes(unit)) return localize("BESTIARY.UnitTons");
  return unit;
}

function collectDamageSummary(activities) {
  return joinList(activities.map(a => a.damage).filter(Boolean));
}

function collectActivationSummary(activities) {
  return joinList(activities.map(a => a.activationLabel).filter(Boolean));
}

function collectWeaponProperties(system) {
  const props = [];
  for (const [key, enabled] of Object.entries(system.properties ?? {})) {
    if (!enabled) continue;
    props.push(localizeProperty(key));
  }
  return props;
}

function collectEquipmentProperties(item, system) {
  const props = [];
  if (system.armor?.value) props.push(`${localize("BESTIARY.AC")} ${system.armor.value}`);
  if (system.armor?.type) props.push(localizeItemType(item.type, system.armor.type));
  if (system.equipped) props.push(localize("BESTIARY.ItemEquipped"));
  if (system.attuned) props.push(localize("BESTIARY.ItemAttuned"));
  if (system.rarity) props.push(localizeRarity(system.rarity));
  return props;
}

function collectFeatProperties(system, activities) {
  const props = [];
  if (system.requirements) props.push(system.requirements);
  const activationSummary = collectActivationSummary(activities);
  if (activationSummary) props.push(activationSummary);
  return props;
}

function joinList(values) {
  return values.filter(Boolean).join(", ");
}

function localizeItemType(baseType, subtype) {
  const dnd5e = getDnd5eConfig();
  if (subtype) {
    const configMap = {
      weapon: dnd5e.weaponTypes,
      equipment: dnd5e.equipmentTypes,
      consumable: dnd5e.consumableTypes,
      tool: dnd5e.toolTypes,
      loot: dnd5e.miscEquipmentTypes,
      feat: dnd5e.featureTypes
    };
    const localized = configMap[baseType]?.[subtype]?.label ?? configMap[baseType]?.[subtype];
    if (localized) return localized;
  }
  const key = `TYPES.Item.${baseType}`;
  return hasTranslation(key) ? localize(key) : baseType;
}

function localizeActivityType(type) {
  const map = {
    action: "BESTIARY.ActivityAction",
    attack: "BESTIARY.ActivityAttack",
    bonus: "BESTIARY.ActivityBonus",
    reaction: "BESTIARY.ActivityReaction",
    legendary: "BESTIARY.ActivityLegendary",
    save: "BESTIARY.ActivitySave",
    utility: "BESTIARY.ActivityUtility",
    heal: "BESTIARY.ActivityHeal",
    summon: "BESTIARY.ActivitySummon",
    enchant: "BESTIARY.ActivityEnchant",
    cast: "BESTIARY.ActivityCast",
    activity: "BESTIARY.Activity"
  };
  return localize(map[type] ?? map.activity);
}

function localizeActivationType(type, cost) {
  if (!type || type === "none") return "";
  const map = {
    action: "BESTIARY.ActivityAction",
    bonus: "BESTIARY.ActivityBonus",
    reaction: "BESTIARY.ActivityReaction",
    legendary: "BESTIARY.ActivityLegendary"
  };
  // The module's own wording for the common types, the system's labels
  // (already localized by dnd5e) for everything else.
  const label = map[type]
    ? localize(map[type])
    : _labelText(getDnd5eConfig().activityActivationTypes?.[type]?.label) || type;
  return cost && cost > 1 ? `${cost} ${label}` : label;
}

function localizeDamageType(type) {
  if (!type) return "";
  const damageTypes = getDnd5eConfig().damageTypes;
  return damageTypes?.[type]?.label ?? damageTypes?.[type] ?? type;
}

function localizeTargetType(type) {
  if (!type) return "";
  const targetTypes = getDnd5eConfig().targetTypes;
  return targetTypes?.[type]?.label ?? targetTypes?.[type] ?? type;
}

function localizeAbilityShort(ability) {
  const abilities = getDnd5eConfig().abilities;
  return abilities?.[ability]?.abbreviation ?? abilities?.[ability]?.label ?? String(ability).toUpperCase();
}

function localizeProperty(key) {
  const properties = getDnd5eConfig().itemProperties;
  return properties?.[key]?.label ?? properties?.[key] ?? key;
}

function localizeRarity(rarity) {
  return getDnd5eConfig().itemRarity?.[rarity] ?? rarity;
}

export function formatDistanceUnit(unit) {
  if (!unit) return "";
  const map = {
    ft: localize("BESTIARY.UnitFeet"),
    mi: localize("BESTIARY.UnitMiles"),
    m: localize("BESTIARY.UnitMeters")
  };
  return map[unit] ?? unit;
}

function normalizeUnit(unit) {
  return formatDistanceUnit(unit);
}

function _traitArray(trait, config = {}, category = "") {
  if (!trait) return [];
  const result = new Set();
  if (trait.value) {
    for (const value of trait.value) {
      const key = _traitKey(value);
      const fallback = _labelText(value?.label ?? value?.name ?? key);
      const label = localizeDndLabel(category, config, key, fallback);
      if (label) result.add(label);
    }
  }
  if (typeof trait.custom === "string") {
    for (const custom of trait.custom.split(";")) {
      const value = custom.trim();
      if (value) result.add(value);
    }
  }
  return [...result];
}

function _traitKey(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const key = value.value ?? value.key ?? value.id ?? value.type ?? value.name;
  return typeof key === "object" ? _traitKey(key) : String(key ?? "");
}

function _labelText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return hasTranslation(text) ? localize(text) : text;
  }
  if (typeof value === "object") {
    return _labelText(value.label ?? value.name ?? value.value ?? value.key ?? value.id);
  }
  return "";
}

function _numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (value && typeof value === "object") {
    for (const key of ["total", "value", "mod", "bonus"]) {
      if (!(key in value)) continue;
      const numeric = _numericValue(value[key]);
      if (numeric !== null) return numeric;
    }
  }
  return null;
}

export function localizeConfigLabel(config, key, fallback = "") {
  if (!key) return _labelText(fallback);
  const configured = config?.get?.(key) ?? config?.[key];
  return _labelText(configured?.label ?? configured?.name ?? configured) || _labelText(fallback);
}

export function localizeDndLabel(category, config, key, fallback = "") {
  const moduleKey = category && key ? `BESTIARY.Data.${category}.${key}` : "";
  if (moduleKey && hasTranslation(moduleKey)) return localize(moduleKey);
  return localizeConfigLabel(config, key, fallback);
}

export function formatMod(mod) { return mod >= 0 ? `+${mod}` : `${mod}`; }

export function formatCR(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}
