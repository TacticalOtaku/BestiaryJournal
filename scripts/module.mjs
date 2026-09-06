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

const MODULE_ID = "bestiary-journal";
const { ApplicationV2 } = foundry.applications.api;
const bestiaryChatLinks = new Set();

Hooks.once("init", () => {
  console.log("Bestiary Journal | Initializing module");

  registerWorldStores();
  registerWorldOptions();
  registerClientPreferences();
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
    name: "Bestiary Tier Block Config", scope: "world", config: false, type: Object, default: {}
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
  game.settings.register(MODULE_ID, "allowPlayerSharing", {
    name: "BESTIARY.Settings.AllowSharing",
    hint: "BESTIARY.Settings.AllowSharingHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "researchRollEnabled", {
    name: "BESTIARY.Settings.ResearchRoll",
    hint: "BESTIARY.Settings.ResearchRollHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "researchSingleAttempt", {
    name: "BESTIARY.Settings.SingleAttempt",
    hint: "BESTIARY.Settings.SingleAttemptHint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

function registerClientPreferences() {
  game.settings.register(MODULE_ID, "favoriteCreatures", {
    name: "Favorite Creatures", scope: "client", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "libraryViewMode", {
    name: "Library View Mode", scope: "client", config: false, type: String, default: "grid"
  });
  game.settings.register(MODULE_ID, "previewAsUser", {
    name: "Preview As User", scope: "client", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "collapsedFamilies", {
    name: "Collapsed Families", scope: "client", config: false, type: Array, default: []
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
    onDown: () => { game.bestiaryJournal.toggle(); return true; },
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
}

Hooks.once("ready", async () => {
  console.log("Bestiary Journal | Module ready");

  game.bestiaryJournal = {
    mainApp: null,
    open() {
      if (!this.mainApp) this.mainApp = new BestiaryApp();
      this.mainApp.render(true);
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
      app.render(true);
      return app;
    }
  };

  if (game.user.isGM && isAuthorityGm()) await runMigrations();

  game.socket.on(`module.${MODULE_ID}`, async data => {
    if (await handleBestiaryStoreSocket(data)) return;
    if (data.action === "refreshBestiary") refreshBestiaryViews();
  });

  Hooks.on("bestiaryJournalRefresh", () => refreshBestiaryViews());
});

function refreshBestiaryViews() {
  if (game.bestiaryJournal?.mainApp?.rendered) game.bestiaryJournal.mainApp.render();
  for (const app of BestiarySectionView._instances) {
    if (app.rendered) app.refreshFromExternalUpdate();
  }
  for (const app of BestiaryCreatureView._instances) {
    if (app.rendered) app.refreshFromExternalUpdate();
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

Hooks.on("renderSidebarTab", (app, html) => {
  if (app.tabName !== "journal") return;
  if (html.querySelector(".bestiary-sidebar-btn")) return;

  const headerActions = html.querySelector(".header-actions")
    ?? html.querySelector(".directory-header .action-buttons");
  if (!headerActions) return;

  const keyHint = formatKeybinding(game.keybindings.get(MODULE_ID, "openBestiary"));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("bestiary-sidebar-btn");
  btn.dataset.tooltip = keyHint
    ? `${game.i18n.localize("BESTIARY.Title")} (${keyHint})`
    : game.i18n.localize("BESTIARY.Title");
  btn.innerHTML = `<i class="fas fa-book-skull"></i> ${game.i18n.localize("BESTIARY.Title")}`;
  btn.addEventListener("click", () => game.bestiaryJournal.toggle());
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

  render() {
    game.bestiaryJournal?.toggle();
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
