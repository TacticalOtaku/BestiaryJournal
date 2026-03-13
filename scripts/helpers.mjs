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
  for (const [key, val] of Object.entries(sensesData)) {
    if (key === "units" || key === "special") continue;
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

  const features = [], actions = [], bonusActions = [], reactions = [],
        legendaryActions = [], spells = [];

  for (const item of actor.items) {
    const rawDescription = item.system.description?.value ?? "";
    const itemData = { name: item.name, description: rawDescription, img: item.img, _item: item };

    if (item.type === "spell") {
      spells.push({ ...itemData, level: item.system.level, school: item.system.school });
      continue;
    }

    const activation = item.system.activities
      ? Object.values(item.system.activities)?.[0]?.activation?.type
      : item.system.activation?.type;

    switch (activation) {
      case "bonus": bonusActions.push(itemData); break;
      case "reaction": reactions.push(itemData); break;
      case "legendary": legendaryActions.push(itemData); break;
      case "action": case "attack": actions.push(itemData); break;
      default:
        if (item.type === "feat" || item.type === "weapon") {
          if (item.system.type?.value === "legendary") legendaryActions.push(itemData);
          else features.push(itemData);
        } else features.push(itemData);
    }
  }

  const rawBiography = system.details?.biography?.value ?? "";

  if (enrich) {
    const enrichItemList = async (list) =>
      Promise.all(list.map(async (entry) => {
        const enrichedDesc = await enrichText(entry.description, { actor, item: entry._item });
        const { _item, ...rest } = entry;
        return { ...rest, description: enrichedDesc };
      }));

    const [ef, ea, eba, er, ela, es, eb] = await Promise.all([
      enrichItemList(features), enrichItemList(actions), enrichItemList(bonusActions),
      enrichItemList(reactions), enrichItemList(legendaryActions), enrichItemList(spells),
      enrichText(rawBiography, { actor })
    ]);

    return {
      id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img,
      prototypeToken: actor.prototypeToken?.texture?.src ?? actor.img,
      abilities, skills, speeds, speedUnits: movement.units ?? "ft",
      resistances, immunities, vulnerabilities, conditionImmunities,
      senses, senseUnits: sensesData.units ?? "ft", languages,
      cr, xp, creatureType, creatureSubtype, size, alignment, hp, ac,
      features: ef, actions: ea, bonusActions: eba, reactions: er,
      legendaryActions: ela, spells: es, biography: eb
    };
  }

  const strip = (list) => list.map(({ _item, ...rest }) => rest);
  return {
    id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img,
    prototypeToken: actor.prototypeToken?.texture?.src ?? actor.img,
    abilities, skills, speeds, speedUnits: movement.units ?? "ft",
    resistances, immunities, vulnerabilities, conditionImmunities,
    senses, senseUnits: sensesData.units ?? "ft", languages,
    cr, xp, creatureType, creatureSubtype, size, alignment, hp, ac,
    features: strip(features), actions: strip(actions), bonusActions: strip(bonusActions),
    reactions: strip(reactions), legendaryActions: strip(legendaryActions),
    spells: strip(spells), biography: rawBiography
  };
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
