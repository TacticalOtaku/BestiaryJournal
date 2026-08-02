const MODULE_ID = "bestiary-journal";
const SOCKET_NAME = `module.${MODULE_ID}`;
const VALID_LEVELS = ["minimal", "standard", "expanded", "custom"];

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

const ALL_BLOCK_KEYS = DISPLAY_BLOCKS.map(block => block.key);

export function isGmOnlyDetailToggle() {
  return game.settings.get(MODULE_ID, "gmOnlyDetailToggle") ?? false;
}

export function getCreatureDetailLevel(uuid, localLevels) {
  if (isGmOnlyDetailToggle()) {
    const levels = game.settings.get(MODULE_ID, "creatureDetailLevels") ?? {};
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
  if (!isGmOnlyDetailToggle()) {
    localLevels.set(uuid, level);
    return;
  }
  if (!game.user.isGM) return;

  const levels = {
    ...(game.settings.get(MODULE_ID, "creatureDetailLevels") ?? {})
  };
  levels[uuid] = level;
  await game.settings.set(MODULE_ID, "creatureDetailLevels", levels);
  game.socket.emit(SOCKET_NAME, { action: "refreshCreatureView", uuid });
}

export function getCreatureCustomDisplay(uuid) {
  const allConfigs = {
    ...(game.settings.get(MODULE_ID, "creatureCustomDisplay") ?? {})
  };
  return allConfigs[uuid] ?? [...ALL_BLOCK_KEYS];
}

export async function setCreatureCustomDisplay(uuid, visibleBlocks) {
  if (!game.user.isGM) return;
  const allConfigs = {
    ...(game.settings.get(MODULE_ID, "creatureCustomDisplay") ?? {})
  };
  allConfigs[uuid] = visibleBlocks.filter(block => ALL_BLOCK_KEYS.includes(block));
  await game.settings.set(MODULE_ID, "creatureCustomDisplay", allConfigs);
  game.socket.emit(SOCKET_NAME, { action: "refreshCreatureView", uuid });
}
