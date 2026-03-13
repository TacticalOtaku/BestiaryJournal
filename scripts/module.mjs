import { BestiaryApp } from "./bestiary-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

Hooks.once("init", () => {
  console.log("Bestiary Journal | Initializing module");

  game.settings.register("bestiary-journal", "bestiaryData", {
    name: "Bestiary Data",
    scope: "world",
    config: false,
    type: Object,
    default: { sections: [] }
  });

  game.settings.register("bestiary-journal", "gmOnlyDetailToggle", {
    name: "BESTIARY.Settings.GmOnlyDetailToggle",
    hint: "BESTIARY.Settings.GmOnlyDetailToggleHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false
  });

  game.settings.register("bestiary-journal", "creatureDetailLevels", {
    name: "Creature Detail Levels",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register("bestiary-journal", "creatureCustomDisplay", {
    name: "Creature Custom Display Config",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // ── Settings menu button ──
  // Source: Foundry VTT v13 API — game.settings.registerMenu
  // type must be an ApplicationV2 subclass in v13
  game.settings.registerMenu("bestiary-journal", "openBestiaryMenu", {
    name: "BESTIARY.Settings.OpenBestiary",
    label: "BESTIARY.Settings.OpenBestiaryLabel",
    hint: "BESTIARY.Settings.OpenBestiaryHint",
    icon: "fas fa-book-skull",
    type: BestiarySettingsLauncher,
    restricted: false
  });

  game.keybindings.register("bestiary-journal", "openBestiary", {
    name: "BESTIARY.Keybinding.Open",
    hint: "BESTIARY.Keybinding.OpenHint",
    editable: [{ key: "KeyB", modifiers: ["Shift"] }],
    onDown: () => { game.bestiaryJournal.toggle(); return true; },
    onUp: () => {},
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("not", (a) => !a);
  Handlebars.registerHelper("includes", (arr, val) => {
    if (Array.isArray(arr)) return arr.includes(val);
    return false;
  });
});

Hooks.once("ready", () => {
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
    }
  };

  game.socket.on("module.bestiary-journal", (data) => {
    if (data.action === "refreshCreatureView") {
      for (const app of Object.values(ui.windows)) {
        if (app.constructor.name === "BestiaryCreatureView" && app.actorUuid === data.uuid) {
          app.render();
        }
      }
    }
  });
});

// ── Sidebar button in Journal tab ──
Hooks.on("renderSidebarTab", (app, html, data) => {
  if (app.tabName !== "journal") return;
  if (html.querySelector(".bestiary-sidebar-btn")) return;

  const headerActions = html.querySelector(".header-actions")
    ?? html.querySelector(".directory-header .action-buttons");
  if (!headerActions) return;

  const bindings = game.keybindings.get("bestiary-journal", "openBestiary");
  const keyHint = _formatKeybinding(bindings);

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

/**
 * Settings menu launcher using ApplicationV2.
 *
 * Source: Foundry VTT v13 API — game.settings.registerMenu
 *   "type" must be an Application class. Foundry calls `new Type().render(true)`.
 *   We override render() to open the bestiary instead of showing a form.
 *
 * Source: Foundry VTT v13 API — ApplicationV2
 *   V1 FormApplication is deprecated in v13, removed in v16.
 *   Must use foundry.applications.api.ApplicationV2.
 */
class BestiarySettingsLauncher extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id: "bestiary-settings-launcher",
    window: {
      title: "BESTIARY.Title"
    }
  };

  /** @override */
  async _renderHTML() {
    return document.createElement("div");
  }

  /** @override */
  _replaceHTML(result, content, options) {}

  /**
   * Override render to open the bestiary and immediately close this launcher.
   * @override
   */
  render(force, options) {
    // Open the bestiary
    if (game.bestiaryJournal) {
      game.bestiaryJournal.toggle();
    }
    // Don't actually render this application — return without calling super
    return this;
  }
}

function _formatKeybinding(bindings) {
  if (!bindings?.length) return "";
  const binding = bindings[0];
  const parts = [];
  if (binding.modifiers?.length) {
    for (const mod of binding.modifiers) {
      switch (mod) {
        case "Control": parts.push("Ctrl"); break;
        case "Shift": parts.push("Shift"); break;
        case "Alt": parts.push("Alt"); break;
        default: parts.push(mod);
      }
    }
  }
  let keyLabel = binding.key ?? "";
  if (keyLabel.startsWith("Key")) keyLabel = keyLabel.slice(3);
  else if (keyLabel.startsWith("Digit")) keyLabel = keyLabel.slice(5);
  else if (keyLabel.startsWith("Numpad")) keyLabel = "Num" + keyLabel.slice(6);
  parts.push(keyLabel);
  return parts.join(" + ");
}
