export function getBestiaryData() {
  return game.settings.get("bestiary-journal", "bestiaryData") ?? { sections: [] };
}

export async function setBestiaryData(data) {
  await game.settings.set("bestiary-journal", "bestiaryData", data);
}

export function generateId() {
  return foundry.utils.randomID(16);
}

export function isGmOnlyDetailToggle() {
  return game.settings.get("bestiary-journal", "gmOnlyDetailToggle") ?? false;
}

const VALID_LEVELS = ["minimal", "standard", "expanded", "custom"];

export function getCreatureDetailLevel(uuid, localLevels) {
  if (isGmOnlyDetailToggle()) {
    const levels = game.settings.get("bestiary-journal", "creatureDetailLevels") ?? {};
    return VALID_LEVELS.includes(levels[uuid]) ? levels[uuid] : "minimal";
  }
  const local = localLevels.get(uuid);
  return VALID_LEVELS.includes(local) ? local : "minimal";
}

export async function setCreatureDetailLevel(uuid, level, localLevels) {
  if (!VALID_LEVELS.includes(level)) {
    console.warn(`Bestiary | Invalid detail level: "${level}"`);
    return;
  }
  console.log(`Bestiary | setCreatureDetailLevel uuid=${uuid} level=${level} gmOnly=${isGmOnlyDetailToggle()}`);
  if (isGmOnlyDetailToggle()) {
    if (!game.user.isGM) return;
    const levels = game.settings.get("bestiary-journal", "creatureDetailLevels") ?? {};
    levels[uuid] = level;
    await game.settings.set("bestiary-journal", "creatureDetailLevels", levels);
    game.socket.emit("module.bestiary-journal", { action: "refreshCreatureView", uuid });
  } else {
    localLevels.set(uuid, level);
  }
}

// ── Custom display config ──

export const DISPLAY_BLOCKS = [
  { key: "abilities", label: "BESTIARY.Abilities" },
  { key: "str", label: "STR", group: "abilities" },
  { key: "dex", label: "DEX", group: "abilities" },
  { key: "con", label: "CON", group: "abilities" },
  { key: "int", label: "INT", group: "abilities" },
  { key: "wis", label: "WIS", group: "abilities" },
  { key: "cha", label: "CHA", group: "abilities" },
  { key: "skills", label: "BESTIARY.Skills" },
  { key: "senses", label: "BESTIARY.Senses" },
  { key: "languages", label: "BESTIARY.Languages" },
  { key: "resistances", label: "BESTIARY.Resistances" },
  { key: "immunities", label: "BESTIARY.Immunities" },
  { key: "vulnerabilities", label: "BESTIARY.Vulnerabilities" },
  { key: "conditionImmunities", label: "BESTIARY.ConditionImmunities" },
  { key: "features", label: "BESTIARY.Features" },
  { key: "actions", label: "BESTIARY.Actions" },
  { key: "inventory", label: "BESTIARY.Inventory" },
  { key: "bonusActions", label: "BESTIARY.BonusActions" },
  { key: "reactions", label: "BESTIARY.Reactions" },
  { key: "legendaryActions", label: "BESTIARY.LegendaryActions" },
  { key: "spells", label: "BESTIARY.Spellcasting" },
  { key: "biography", label: "BESTIARY.Biography" }
];

const ALL_BLOCK_KEYS = DISPLAY_BLOCKS.map(b => b.key);

export function getCreatureCustomDisplay(uuid) {
  const allConfigs = game.settings.get("bestiary-journal", "creatureCustomDisplay") ?? {};
  return allConfigs[uuid] ?? [...ALL_BLOCK_KEYS];
}

export async function setCreatureCustomDisplay(uuid, visibleBlocks) {
  if (!game.user.isGM) return;
  const allConfigs = game.settings.get("bestiary-journal", "creatureCustomDisplay") ?? {};
  allConfigs[uuid] = visibleBlocks;
  await game.settings.set("bestiary-journal", "creatureCustomDisplay", allConfigs);
  game.socket.emit("module.bestiary-journal", { action: "refreshCreatureView", uuid });
}

// ── Text enrichment ──

export async function enrichText(text, options = {}) {
  if (!text) return "";
  try {
    const TE = foundry.applications.ux.TextEditor.implementation;
    const relativeTo = options.item ?? options.actor ?? undefined;
    return await TE.enrichHTML(text, {
      secrets: false, documents: true, links: true, rolls: true,
      embeds: true, async: true, relativeTo,
      rollData: options.actor?.getRollData?.() ?? {}
    });
  } catch (e) {
    console.warn("Bestiary: Failed to enrich HTML text", e);
    return text;
  }
}

// ── NPC data extraction ──

export async function extractCreatureData(actor, { enrich = false } = {}) {
  const system = actor.system;

  const abilities = {};
  for (const [key, abl] of Object.entries(system.abilities ?? {})) {
    abilities[key] = {
      value: abl.value, mod: abl.mod, save: abl.save,
      label: CONFIG.DND5E.abilities[key]?.label ?? key.toUpperCase()
    };
  }

  const skills = {};
  for (const [key, skill] of Object.entries(system.skills ?? {})) {
    if (skill.value > 0 || skill.total !== skill.ability?.mod) {
      skills[key] = { label: CONFIG.DND5E.skills[key]?.label ?? key, total: skill.total, value: skill.value };
    }
  }

  const speeds = {};
  const movement = system.attributes?.movement ?? {};
  for (const [key, val] of Object.entries(movement)) {
    if (key === "units" || key === "hover") continue;
    if (val) speeds[key] = val;
  }
  if (movement.hover) speeds.hover = true;

  const resistances = _traitArray(system.traits?.dr);
  const immunities = _traitArray(system.traits?.di);
  const vulnerabilities = _traitArray(system.traits?.dv);
  const conditionImmunities = _traitArray(system.traits?.ci);

  const senses = {};
  const sensesData = system.attributes?.senses ?? {};
  const senseRanges = sensesData.ranges ?? {};
  for (const [key, val] of Object.entries(senseRanges)) {
    if (val) senses[key] = val;
  }
  if (sensesData.special) senses.special = sensesData.special;

  const languages = _traitArray(system.traits?.languages);
  const cr = system.details?.cr ?? 0;
  const xp = system.details?.xp?.value ?? CONFIG.DND5E.CR_EXP_LEVELS?.[cr] ?? 0;
  const creatureType = system.details?.type?.value ?? "";
  const creatureSubtype = system.details?.type?.subtype ?? "";
  const size = CONFIG.DND5E.actorSizes?.[system.traits?.size]?.label ?? system.traits?.size ?? "";
  const alignment = system.details?.alignment ?? "";

  const hp = {
    value: system.attributes?.hp?.value ?? 0,
    max: system.attributes?.hp?.max ?? 0,
    formula: system.attributes?.hp?.formula ?? ""
  };
  const ac = {
    value: system.attributes?.ac?.value ?? 10,
    label: system.attributes?.ac?.label ?? ""
  };

  const features = [], actions = [], inventory = [], bonusActions = [], reactions = [],
        legendaryActions = [], spells = [];

  for (const item of actor.items) {
    const rawDescription = item.system.description?.value ?? "";
    const itemMeta = extractItemMeta(item);
    const itemData = {
      name: item.name,
      description: rawDescription,
      img: item.img,
      _item: item,
      ...itemMeta
    };

    if (item.type === "spell") {
      spells.push({ ...itemData, level: item.system.level, school: item.system.school });
      continue;
    }

    const activation = Object.values(item.system.activities ?? {})[0]?.activation?.type;

    switch (activation) {
      case "bonus": bonusActions.push(itemData); break;
      case "reaction": reactions.push(itemData); break;
      case "legendary": legendaryActions.push(itemData); break;
      case "action": case "attack": actions.push(itemData); break;
      default:
        if (["equipment", "consumable", "tool", "loot", "container", "backpack"].includes(item.type)) {
          inventory.push(itemData);
        } else if (item.type === "weapon") {
          inventory.push(itemData);
        } else if (item.type === "feat") {
          if (item.system.type?.value === "legendary") legendaryActions.push(itemData);
          else features.push(itemData);
        } else features.push(itemData);
    }
  }

  const rawBiography = system.details?.biography?.public ?? "";

  if (enrich) {
    const enrichItemList = async (list) =>
      Promise.all(list.map(async (entry) => {
        const enrichedDesc = await enrichText(entry.description, { actor, item: entry._item });
        const { _item, ...rest } = entry;
        return { ...rest, description: enrichedDesc };
      }));

    const [ef, ea, ei, eba, er, ela, es, eb] = await Promise.all([
      enrichItemList(features), enrichItemList(actions), enrichItemList(inventory), enrichItemList(bonusActions),
      enrichItemList(reactions), enrichItemList(legendaryActions), enrichItemList(spells),
      enrichText(rawBiography, { actor })
    ]);

    return {
      id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img,
      prototypeToken: actor.prototypeToken?.texture?.src ?? actor.img,
      abilities, skills, speeds, speedUnits: movement.units ?? "ft",
      resistances, immunities, vulnerabilities, conditionImmunities,
      senses, senseUnits: sensesData.units ?? senseRanges.units ?? "ft", languages,
      cr, xp, creatureType, creatureSubtype, size, alignment, hp, ac,
      features: ef, actions: ea, inventory: ei, bonusActions: eba, reactions: er,
      legendaryActions: ela, spells: es, biography: eb
    };
  }

  const strip = (list) => list.map(({ _item, ...rest }) => rest);
  return {
    id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img,
    prototypeToken: actor.prototypeToken?.texture?.src ?? actor.img,
    abilities, skills, speeds, speedUnits: movement.units ?? "ft",
    resistances, immunities, vulnerabilities, conditionImmunities,
    senses, senseUnits: sensesData.units ?? senseRanges.units ?? "ft", languages,
    cr, xp, creatureType, creatureSubtype, size, alignment, hp, ac,
    features: strip(features), actions: strip(actions), inventory: strip(inventory), bonusActions: strip(bonusActions),
    reactions: strip(reactions), legendaryActions: strip(legendaryActions),
    spells: strip(spells), biography: rawBiography
  };
}

function extractItemMeta(item) {
  const system = item.system ?? {};
  const labels = item.labels ?? {};
  const activities = extractItemActivities(item);
  const tags = [];
  const stats = [];

  const pushTag = (label, value, options = {}) => {
    if (value === null || value === undefined || value === "") return;
    tags.push({
      label,
      value: String(value),
      isAccent: !!options.isAccent
    });
  };

  const pushStat = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    stats.push({ label, value: String(value) });
  };

  if (item.type === "weapon") {
    pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.weaponType));
    pushTag("BESTIARY.ItemRange", labels.range ?? formatRange(system.range));
    pushTag("BESTIARY.ItemDamage", labels.damageTypes ?? collectDamageSummary(activities));
    pushTag("BESTIARY.ItemProperties", joinList(collectWeaponProperties(system)), { isAccent: true });
    pushStat("BESTIARY.ItemQuantity", system.quantity);
    pushStat("BESTIARY.ItemWeight", formatWeight(system.weight));
  } else if (["equipment", "consumable", "tool", "loot", "container", "backpack"].includes(item.type)) {
    pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.itemType));
    pushTag("BESTIARY.ItemProperties", joinList(collectEquipmentProperties(item, system)), { isAccent: true });
    pushStat("BESTIARY.ItemQuantity", system.quantity);
    pushStat("BESTIARY.ItemWeight", formatWeight(system.weight));
    pushStat("BESTIARY.ItemUses", formatUses(system.uses));
  } else if (item.type === "feat") {
    pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.featType));
    pushTag("BESTIARY.ItemActivation", labels.activation ?? collectActivationSummary(activities));
    pushTag("BESTIARY.ItemRange", labels.range ?? formatRange(system.range));
    pushTag("BESTIARY.ItemProperties", joinList(collectFeatProperties(system, activities)), { isAccent: true });
    pushStat("BESTIARY.ItemUses", formatUses(system.uses));
  } else {
    pushTag("BESTIARY.ItemType", localizeItemType(item.type, system.type?.value ?? labels.itemType));
    pushTag("BESTIARY.ItemActivation", labels.activation ?? collectActivationSummary(activities));
    pushStat("BESTIARY.ItemUses", formatUses(system.uses));
  }

  if (!tags.length && activities.length) {
    pushTag("BESTIARY.ItemActivation", collectActivationSummary(activities));
  }

  return {
    tags,
    stats,
    activities,
    hasMeta: tags.length > 0 || stats.length > 0 || activities.length > 0
  };
}

function extractItemActivities(item) {
  const activities = item.system?.activities ? Object.values(item.system.activities) : [];
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
  if (max === "" || max === null || max === undefined || max === 0) return "";
  return `${Math.max(Number(max) - Number(spent || 0), 0)}/${max}`;
}

function formatWeight(weight) {
  if (weight === null || weight === undefined || weight === "") return "";
  return String(weight);
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
  if (system.armor?.value) props.push(`${game.i18n.localize("BESTIARY.AC")} ${system.armor.value}`);
  if (system.armor?.type) props.push(localizeItemType(item.type, system.armor.type));
  if (system.equipped) props.push(game.i18n.localize("BESTIARY.ItemEquipped"));
  if (system.attuned) props.push(game.i18n.localize("BESTIARY.ItemAttuned"));
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
  if (subtype) {
    const configMap = {
      weapon: CONFIG.DND5E.weaponTypes,
      equipment: CONFIG.DND5E.equipmentTypes,
      consumable: CONFIG.DND5E.consumableTypes,
      tool: CONFIG.DND5E.toolTypes,
      loot: CONFIG.DND5E.miscEquipmentTypes,
      feat: CONFIG.DND5E.featureTypes
    };
    const localized = configMap[baseType]?.[subtype]?.label ?? configMap[baseType]?.[subtype];
    if (localized) return localized;
  }
  return game.i18n.localize(`TYPES.Item.${baseType}`) || baseType;
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
  return game.i18n.localize(map[type] ?? map.activity);
}

function localizeActivationType(type, cost) {
  if (!type) return "";
  const map = {
    action: "BESTIARY.ActivityAction",
    attack: "BESTIARY.ActivityAttack",
    bonus: "BESTIARY.ActivityBonus",
    reaction: "BESTIARY.ActivityReaction",
    legendary: "BESTIARY.ActivityLegendary",
    minute: "DND5E.TimeMinutePl",
    hour: "DND5E.TimeHourPl",
    day: "DND5E.TimeDayPl"
  };
  const label = game.i18n.localize(map[type] ?? type);
  return cost && cost > 1 ? `${cost} ${label}` : label;
}

function localizeDamageType(type) {
  if (!type) return "";
  return CONFIG.DND5E.damageTypes?.[type]?.label ?? CONFIG.DND5E.damageTypes?.[type] ?? type;
}

function localizeTargetType(type) {
  if (!type) return "";
  return CONFIG.DND5E.targetTypes?.[type]?.label ?? CONFIG.DND5E.targetTypes?.[type] ?? type;
}

function localizeAbilityShort(ability) {
  return CONFIG.DND5E.abilities?.[ability]?.abbreviation ?? CONFIG.DND5E.abilities?.[ability]?.label ?? String(ability).toUpperCase();
}

function localizeProperty(key) {
  return CONFIG.DND5E.itemProperties?.[key]?.label ?? CONFIG.DND5E.itemProperties?.[key] ?? key;
}

function localizeRarity(rarity) {
  return CONFIG.DND5E.itemRarity?.[rarity] ?? rarity;
}

function normalizeUnit(unit) {
  if (!unit) return "";
  const map = {
    ft: game.i18n.localize("DND5E.DistFt"),
    mi: game.i18n.localize("DND5E.DistMi"),
    m: "m"
  };
  return map[unit] ?? unit;
}

function _traitArray(trait) {
  if (!trait) return [];
  const result = [];
  if (trait.value) for (const v of trait.value) result.push(v);
  if (trait.custom) for (const c of trait.custom.split(";")) { const t = c.trim(); if (t) result.push(t); }
  return result;
}

export function formatMod(mod) { return mod >= 0 ? `+${mod}` : `${mod}`; }

export function formatCR(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}
