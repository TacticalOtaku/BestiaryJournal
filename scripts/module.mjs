import { BestiaryApp } from "./bestiary-app.mjs";
import { BestiaryCreatureView } from "./creature-view.mjs";
import { BestiarySectionView } from "./section-view.mjs";
import { BestiaryTierSettings } from "./tier-settings.mjs";
import {
  canUserViewBestiaryCreature,
  handleBestiaryStoreSocket,
  isAuthorityGm
} from "./bestiary-store.mjs";
import { runMigrations } from "./migrations.mjs";
import { migrateClientPreferencesToUser } from "./client-preferences.mjs";
import { splitDisplayName } from "./display-names.mjs";

const MODULE_ID = "bestiary-journal";
const { ApplicationV2 } = foundry.applications.api;
const bestiaryChatLinks = new Set();

Hooks.once("init", () => {
  console.log("Bestiary Journal | Initializing module");

  registerWorldStores();
  registerWorldOptions();
  registerPreferences();
  registerMenus();
  registerKeybindings();
  registerHandlebarsHelpers();
});

function registerWorldStores() {
  game.settings.register(MODULE_ID, "bestiaryData", {
    name: "Bestiary Data", scope: "world", config: false, type: Object,
    default: { revision: 0, sections: [] }
  });
  game.settings.register(MODULE_ID, "bestiaryKnowledge", {
    name: "Bestiary Knowledge", scope: "world", config: false, type: Object,
    default: { revision: 0, users: {} }
  });
  game.settings.register(MODULE_ID, "bestiarySocial", {
    name: "Bestiary Comments", scope: "world", config: false, type: Object,
    default: { revision: 0, comments: [], shares: [] }
  });
  game.settings.register(MODULE_ID, "tierBlockConfig", {
    name: "Bestiary Tier Block Config", scope: "world", config: false, type: Object, default: {},
    // Fires on every client, so open cards follow a new world ladder at once.
    onChange: () => scheduleBestiaryRefresh({ changed: { data: true }, uuids: null })
  });
  game.settings.register(MODULE_ID, "dataVersion", {
    name: "Bestiary Data Version", scope: "world", config: false, type: Number, default: 0
  });

  // Legacy stores, kept so the one-time migration can read them.
  game.settings.register(MODULE_ID, "creatureDetailLevels", {
    name: "Legacy Detail Levels", scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "creatureCustomDisplay", {
    name: "Legacy Custom Display", scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "gmOnlyDetailToggle", {
    name: "Legacy GM Only Detail Toggle", scope: "world", config: false, type: Boolean, default: false
  });
}

function registerWorldOptions() {
  // Both options decide which buttons a creature card offers, so open cards
  // redraw as soon as the GM flips them. The authority enforces them anyway.
  const refreshCards = () => scheduleBestiaryRefresh({ changed: { settings: true } });

  game.settings.register(MODULE_ID, "allowPlayerSharing", {
    name: "BESTIARY.Settings.AllowSharing",
    hint: "BESTIARY.Settings.AllowSharingHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: refreshCards
  });
  game.settings.register(MODULE_ID, "researchRollEnabled", {
    name: "BESTIARY.Settings.ResearchRoll",
    hint: "BESTIARY.Settings.ResearchRollHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: refreshCards
  });
  // Only read by the authority when the next roll is judged; nothing to redraw.
  game.settings.register(MODULE_ID, "researchSingleAttempt", {
    name: "BESTIARY.Settings.SingleAttempt",
    hint: "BESTIARY.Settings.SingleAttemptHint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

/**
 * Favorites and collapsed families follow the user across devices ("user"
 * scope). The rest is about this screen and stays per browser ("client").
 */
function registerPreferences() {
  game.settings.register(MODULE_ID, "favoriteCreatures", {
    name: "Favorite Creatures", scope: "user", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "libraryViewMode", {
    name: "Library View Mode", scope: "client", config: false, type: String, default: "grid"
  });
  game.settings.register(MODULE_ID, "previewAsUser", {
    name: "Preview As User", scope: "client", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "collapsedFamilies", {
    name: "Collapsed Families", scope: "user", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "commentChannel", {
    name: "Preferred Comment Channel", scope: "client", config: false, type: String, default: "private"
  });
}

function registerMenus() {
  game.settings.registerMenu(MODULE_ID, "openBestiaryMenu", {
    name: "BESTIARY.Settings.OpenBestiary",
    label: "BESTIARY.Settings.OpenBestiaryLabel",
    hint: "BESTIARY.Settings.OpenBestiaryHint",
    icon: "fas fa-book-skull",
    type: BestiarySettingsLauncher,
    restricted: false
  });
  game.settings.registerMenu(MODULE_ID, "tierSettingsMenu", {
    name: "BESTIARY.Settings.TierMenu",
    label: "BESTIARY.Settings.TierMenuLabel",
    hint: "BESTIARY.Settings.TierMenuHint",
    icon: "fas fa-layer-group",
    type: BestiaryTierSettings,
    restricted: true
  });
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
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("bjEq", (a, b) => a === b);
  Handlebars.registerHelper("bjNe", (a, b) => a !== b);
  Handlebars.registerHelper("bjNot", value => !value);
  Handlebars.registerHelper("bjGt", (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper("bjAnd", (...args) => args.slice(0, -1).every(Boolean));
  Handlebars.registerHelper("bjOr", (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper("bjIncludes", (list, value) => Array.isArray(list) && list.includes(value));
  Handlebars.registerHelper("bjConcat", (...args) => args.slice(0, -1).join(""));
  Handlebars.registerHelper("bjNameParts", splitDisplayName);
  Handlebars.registerHelper("bjFormat", (key, options) => game.i18n.format(key, options?.hash ?? {}));
}

Hooks.once("ready", async () => {
  console.log("Bestiary Journal | Module ready");

  game.bestiaryJournal = {
    mainApp: null,
    open() {
      if (!this.mainApp) this.mainApp = new BestiaryApp();
      this.mainApp.render({ force: true });
    },
    close() {
      if (this.mainApp?.rendered) this.mainApp.close();
    },
    toggle() {
      if (this.mainApp?.rendered) this.close();
      else this.open();
    },
    openCreature(uuid, options = {}) {
      if (!uuid) return;
      if (!canUserViewBestiaryCreature(uuid)) {
        ui.notifications.warn(game.i18n.localize("BESTIARY.CreatureUnavailable"));
        return;
      }
      const current = [...BestiaryCreatureView._instances]
        .find(app => app.actorUuid === uuid && app.rendered);
      if (current) {
        current.bringToFront();
        return current;
      }
      const app = new BestiaryCreatureView({ uuid, ...options });
      app.render({ force: true });
      return app;
    }
  };

  // Listen before migrating, so player requests sent meanwhile are not lost.
  game.socket.on(`module.${MODULE_ID}`, async data => {
    if (await handleBestiaryStoreSocket(data)) return;
    if (data.action === "refreshBestiary") scheduleBestiaryRefresh(data);
  });
  Hooks.on("bestiaryJournalRefresh", payload => scheduleBestiaryRefresh(payload));

  if (game.user.isGM && isAuthorityGm()) await runMigrations();
  // Every user, players included: their favorites move off this browser.
  await migrateClientPreferencesToUser();
});

/**
 * Coalesces bursts of changes (a bulk edit, several players at once) into a
 * single refresh, and merges what they touched so views can skip the rest.
 */
let pendingRefresh = null;
let refreshTimer = null;

function scheduleBestiaryRefresh(payload = {}) {
  const changed = payload.changed ?? { data: true, knowledge: true, social: true };
  const uuids = Array.isArray(payload.uuids) ? payload.uuids : null;
  if (!pendingRefresh) {
    pendingRefresh = { changed: { ...changed }, uuids };
  } else {
    for (const [key, value] of Object.entries(changed)) {
      pendingRefresh.changed[key] = pendingRefresh.changed[key] || value;
    }
    pendingRefresh.uuids = pendingRefresh.uuids && uuids ? [...new Set([...pendingRefresh.uuids, ...uuids])] : null;
  }
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const merged = pendingRefresh;
    pendingRefresh = null;
    refreshBestiaryViews(merged);
  }, 40);
}

function refreshBestiaryViews(payload) {
  const main = game.bestiaryJournal?.mainApp;
  if (main?.rendered) main.refreshFromExternalUpdate(payload);
  for (const app of BestiarySectionView._instances) {
    if (app.rendered) app.refreshFromExternalUpdate(payload);
  }
  for (const app of BestiaryCreatureView._instances) {
    if (app.rendered) app.refreshFromExternalUpdate(payload);
  }
  refreshBestiaryChatLinks();
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const flaggedUuid = message.getFlag(MODULE_ID, "creatureUuid");
  for (const link of html.querySelectorAll("a.bestiary-creature-link")) {
    const uuid = link.dataset.bestiaryCreatureUuid || flaggedUuid;
    if (!uuid) continue;
    link.dataset.bestiaryCreatureUuid = uuid;
    bestiaryChatLinks.add(link);
    refreshBestiaryChatLink(link);
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      game.bestiaryJournal?.openCreature(uuid);
    });
  }
});

function refreshBestiaryChatLink(link) {
  const canView = canUserViewBestiaryCreature(link.dataset.bestiaryCreatureUuid);
  link.classList.toggle("is-disabled", !canView);
  if (canView) {
    link.removeAttribute("aria-disabled");
    link.removeAttribute("title");
    delete link.dataset.tooltip;
  } else {
    const unavailable = game.i18n.localize("BESTIARY.CreatureUnavailable");
    link.setAttribute("aria-disabled", "true");
    link.title = unavailable;
    link.dataset.tooltip = unavailable;
  }
}

function refreshBestiaryChatLinks() {
  for (const link of bestiaryChatLinks) {
    if (!link.isConnected) {
      bestiaryChatLinks.delete(link);
      continue;
    }
    refreshBestiaryChatLink(link);
  }
}

/**
 * Sidebar tabs are ApplicationV2 since v13, so the hook is named after the
 * directory class and `html` is a plain element.
 */
Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".bestiary-sidebar-btn")) return;

  const headerActions = root.querySelector(".header-actions")
    ?? root.querySelector(".directory-header .action-buttons");
  if (!headerActions) return;

  const keyHint = formatKeybinding(game.keybindings.get(MODULE_ID, "openBestiary"));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("bestiary-sidebar-btn");
  btn.dataset.tooltip = keyHint
    ? `${game.i18n.localize("BESTIARY.Title")} (${keyHint})`
    : game.i18n.localize("BESTIARY.Title");
  const icon = document.createElement("i");
  icon.className = "fas fa-book-skull";
  btn.append(icon, document.createTextNode(` ${game.i18n.localize("BESTIARY.Title")}`));
  btn.addEventListener("click", () => game.bestiaryJournal?.toggle());
  headerActions.appendChild(btn);
});

/** Opens the bestiary from the module settings menu instead of a form. */
class BestiarySettingsLauncher extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "bestiary-settings-launcher",
    window: { title: "BESTIARY.Title" }
  };

  async _renderHTML() {
    return document.createElement("div");
  }

  _replaceHTML() {}

  /** The settings button always brings the bestiary up, never closes it. */
  render() {
    game.bestiaryJournal?.open();
    return this;
  }
}

function formatKeybinding(bindings) {
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
