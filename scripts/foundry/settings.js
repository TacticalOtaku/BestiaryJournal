import { SHARING_WINDOWS } from "../core/bestiary-domain.js";
import { setDebugLogging } from "../core/logger.js";
import { ACCENTS, COVER_SIZES, DENSITIES, MOTION_LEVELS, THEMES } from "../core/theme.js";
import { restampAll } from "./theme-root.js";

const MODULE_ID = "bestiary-journal";

export function registerBestiarySettings({ onTierConfigChange, onRefreshCards } = {}) {
  registerWorldStores({ onTierConfigChange });
  registerWorldOptions({ onRefreshCards });
  registerPreferences();
  registerKeybindings();
}

function registerWorldStores({ onTierConfigChange }) {
  game.settings.register(MODULE_ID, "bestiaryData", {
    name: "Bestiary Data",
    scope: "world",
    config: false,
    type: Object,
    default: { revision: 0, sections: [] },
  });
  game.settings.register(MODULE_ID, "bestiaryKnowledge", {
    name: "Bestiary Knowledge",
    scope: "world",
    config: false,
    type: Object,
    default: { revision: 0, users: {} },
  });
  game.settings.register(MODULE_ID, "bestiarySocial", {
    name: "Bestiary Comments",
    scope: "world",
    config: false,
    type: Object,
    default: { revision: 0, comments: [] },
  });
  game.settings.register(MODULE_ID, "tierBlockConfig", {
    name: "Bestiary Tier Block Config",
    scope: "world",
    config: false,
    type: Object,
    default: {},
    // Fires on every client, so open cards follow a new world ladder at once.
    onChange: () => onTierConfigChange?.(),
  });
  game.settings.register(MODULE_ID, "dataVersion", {
    name: "Bestiary Data Version",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });
  game.settings.register(MODULE_ID, "migrationBackup", {
    name: "Bestiary Migration Recovery",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Legacy stores, kept so the one-time migration can read them.
  game.settings.register(MODULE_ID, "creatureDetailLevels", {
    name: "Legacy Detail Levels",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(MODULE_ID, "creatureCustomDisplay", {
    name: "Legacy Custom Display",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(MODULE_ID, "gmOnlyDetailToggle", {
    name: "Legacy GM Only Detail Toggle",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}

function registerWorldOptions({ onRefreshCards }) {
  const refreshCards = () => onRefreshCards?.();

  game.settings.register(MODULE_ID, "allowPlayerSharing", {
    name: "BESTIARY.Settings.AllowSharing",
    hint: "BESTIARY.Settings.AllowSharingHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshCards,
  });
  game.settings.register(MODULE_ID, "sharingWindow", {
    name: "BESTIARY.Settings.SharingWindow",
    hint: "BESTIARY.Settings.SharingWindowHint",
    scope: "world",
    config: true,
    type: String,
    default: "outOfCombat",
    choices: Object.fromEntries(
      SHARING_WINDOWS.map((mode) => [mode, `BESTIARY.Settings.SharingWindow_${mode}`]),
    ),
  });
  // When each player last rested and fought; written by the authoritative GM only.
  game.settings.register(MODULE_ID, "sharingClock", {
    scope: "world",
    config: false,
    type: Object,
    default: { revision: 0, users: {} },
  });
  game.settings.register(MODULE_ID, "researchRollEnabled", {
    name: "BESTIARY.Settings.ResearchRoll",
    hint: "BESTIARY.Settings.ResearchRollHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshCards,
  });
  game.settings.register(MODULE_ID, "encounterReveal", {
    name: "BESTIARY.Settings.EncounterReveal",
    hint: "BESTIARY.Settings.EncounterRevealHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, "encounterRevealOnUnhide", {
    name: "BESTIARY.Settings.EncounterRevealOnUnhide",
    hint: "BESTIARY.Settings.EncounterRevealOnUnhideHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  // Only read by the authority when the next roll is judged; nothing to redraw.
  game.settings.register(MODULE_ID, "researchSingleAttempt", {
    name: "BESTIARY.Settings.SingleAttempt",
    hint: "BESTIARY.Settings.SingleAttemptHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, "includeCustomSkills", {
    name: "BESTIARY.Settings.IncludeCustomSkills",
    hint: "BESTIARY.Settings.IncludeCustomSkillsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: refreshCards,
  });
}

/**
 * Favorites and collapsed families follow the user across devices ("user"
 * scope). The rest is about this screen and stays per browser ("client").
 */
function registerPreferences() {
  game.settings.register(MODULE_ID, "favoriteCreatures", {
    name: "Favorite Creatures",
    scope: "user",
    config: false,
    type: Array,
    default: [],
  });
  game.settings.register(MODULE_ID, "libraryViewMode", {
    name: "Library View Mode",
    scope: "client",
    config: false,
    type: String,
    default: "grid",
  });
  game.settings.register(MODULE_ID, "previewAsUser", {
    name: "Preview As User",
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  // Tier at which the player last opened each creature ({uuid: tier}); null until their first run seeds it.
  game.settings.register(MODULE_ID, "seenTiers", {
    name: "Seen Creatures",
    scope: "user",
    config: false,
    type: Object,
    default: null,
  });
  game.settings.register(MODULE_ID, "collapsedFamilies", {
    name: "Collapsed Families",
    scope: "user",
    config: false,
    type: Array,
    default: [],
  });
  game.settings.register(MODULE_ID, "commentChannel", {
    name: "Preferred Comment Channel",
    scope: "client",
    config: false,
    type: String,
    default: "private",
  });
  // The window look follows the user (AIM keeps the same split): theme, accent and density per user, motion per
  // device. Like AIM, they are set in the window itself (the library's look drawer), not in Foundry's settings.
  const lookChoices = (values, prefix) =>
    Object.fromEntries(values.map((value) => [value, `BESTIARY.Settings.${prefix}_${value}`]));
  game.settings.register(MODULE_ID, "uiTheme", {
    name: "BESTIARY.Settings.Theme",
    hint: "BESTIARY.Settings.ThemeHint",
    scope: "user",
    config: false,
    type: String,
    default: "auto",
    choices: lookChoices(THEMES, "Theme"),
    onChange: restampAll,
  });
  game.settings.register(MODULE_ID, "uiAccent", {
    name: "BESTIARY.Settings.Accent",
    hint: "BESTIARY.Settings.AccentHint",
    scope: "user",
    config: false,
    type: String,
    default: "brass",
    choices: lookChoices(ACCENTS, "Accent"),
    onChange: restampAll,
  });
  game.settings.register(MODULE_ID, "uiMotion", {
    name: "BESTIARY.Settings.Motion",
    hint: "BESTIARY.Settings.MotionHint",
    scope: "client",
    config: false,
    type: String,
    default: "full",
    choices: lookChoices(MOTION_LEVELS, "Motion"),
    onChange: restampAll,
  });
  game.settings.register(MODULE_ID, "uiDensity", {
    name: "BESTIARY.Settings.Density",
    hint: "BESTIARY.Settings.DensityHint",
    scope: "user",
    config: false,
    type: String,
    default: "comfortable",
    choices: lookChoices(DENSITIES, "Density"),
    onChange: restampAll,
  });
  game.settings.register(MODULE_ID, "uiCoverSize", {
    name: "BESTIARY.Settings.CoverSize",
    hint: "BESTIARY.Settings.CoverSizeHint",
    scope: "client",
    config: false,
    type: String,
    default: "medium",
    choices: lookChoices(COVER_SIZES, "CoverSize"),
    onChange: restampAll,
  });
  game.settings.register(MODULE_ID, "debug", {
    name: "BESTIARY.Settings.Debug",
    hint: "BESTIARY.Settings.DebugHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: setDebugLogging,
  });
  setDebugLogging(game.settings.get(MODULE_ID, "debug"));
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "openBestiary", {
    name: "BESTIARY.Keybinding.Open",
    hint: "BESTIARY.Keybinding.OpenHint",
    editable: [{ key: "KeyB", modifiers: ["Shift"] }],
    onDown: () => {
      if (!game.bestiaryJournal) return false;
      game.bestiaryJournal.toggle();
      return true;
    },
    onUp: () => {},
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });
}

export function formatKeybinding(bindings) {
  if (!bindings?.length) return "";
  const binding = bindings[0];
  const parts = [];
  for (const mod of binding.modifiers ?? []) {
    if (mod === "Control") parts.push("Ctrl");
    else parts.push(mod);
  }
  let keyLabel = binding.key ?? "";
  if (keyLabel.startsWith("Key")) keyLabel = keyLabel.slice(3);
  else if (keyLabel.startsWith("Digit")) keyLabel = keyLabel.slice(5);
  else if (keyLabel.startsWith("Numpad")) keyLabel = `Num${keyLabel.slice(6)}`;
  parts.push(keyLabel);
  return parts.join(" + ");
}
