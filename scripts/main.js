import { BestiaryCreatureView } from "./ui/creature-view.js";
import { BestiarySectionView } from "./ui/section-view.js";
import { BestiaryTierSettings } from "./ui/tier-settings.js";
import { handleBestiaryStoreSocket, isAuthorityGm } from "./foundry/bestiary-store.js";
import { runMigrations } from "./foundry/migrations.js";
import { registerSharingClock } from "./foundry/sharing-window.js";
import { registerEncounterReveal } from "./foundry/encounter.js";
import { migrateClientPreferencesToUser } from "./foundry/client-preferences.js";
import { splitDisplayName } from "./core/display-names.js";
import { SILHOUETTE_PLACEHOLDER } from "./core/image-framing.js";
import { formatCount } from "./foundry/foundry-runtime.js";
import { registerThemeRoot } from "./foundry/theme-root.js";
import { announceKnowledge, startKnowledgeWatch } from "./foundry/knowledge-watch.js";
import { registerBestiarySettings } from "./foundry/settings.js";
import { refreshBestiaryChatLinks, registerBestiaryChatLinks } from "./foundry/chat-links.js";
import { registerJournalDirectoryIntegration } from "./foundry/journal-directory.js";
import { registerNoteStoreHooks } from "./foundry/note-store.js";
import { registerActorIntegration } from "./ui/actor-integration.js";
import { createApi } from "./ui/api.js";
import { BestiaryKnowledgeBoard } from "./ui/knowledge-board.js";
import { log } from "./core/logger.js";

const MODULE_ID = "bestiary-journal";
const { ApplicationV2 } = foundry.applications.api;

Hooks.once("init", () => {
  registerBestiarySettings({
    onTierConfigChange: () => scheduleBestiaryRefresh({ changed: { data: true }, uuids: null }),
    onRefreshCards: () => scheduleBestiaryRefresh({ changed: { settings: true } }),
  });
  registerMenus();
  registerHandlebarsHelpers();
  registerThemeRoot();
  registerActorIntegration();
  registerBestiaryChatLinks();
  registerJournalDirectoryIntegration();
  registerImageFallback();
  log.debug("Initialized");
});

function registerMenus() {
  game.settings.registerMenu(MODULE_ID, "openBestiaryMenu", {
    name: "BESTIARY.Settings.OpenBestiary",
    label: "BESTIARY.Settings.OpenBestiaryLabel",
    hint: "BESTIARY.Settings.OpenBestiaryHint",
    icon: "fa-solid fa-book-skull",
    type: BestiarySettingsLauncher,
    restricted: false,
  });
  game.settings.registerMenu(MODULE_ID, "tierSettingsMenu", {
    name: "BESTIARY.Settings.TierMenu",
    label: "BESTIARY.Settings.TierMenuLabel",
    hint: "BESTIARY.Settings.TierMenuHint",
    icon: "fa-solid fa-layer-group",
    type: BestiaryTierSettings,
    restricted: true,
  });
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("bjEq", (a, b) => a === b);
  Handlebars.registerHelper("bjNe", (a, b) => a !== b);
  Handlebars.registerHelper("bjNot", (value) => !value);
  Handlebars.registerHelper("bjGt", (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper("bjAnd", (...args) => args.slice(0, -1).every(Boolean));
  Handlebars.registerHelper("bjOr", (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper("bjIncludes", (list, value) => Array.isArray(list) && list.includes(value));
  Handlebars.registerHelper("bjConcat", (...args) => args.slice(0, -1).join(""));
  Handlebars.registerHelper("bjNameParts", splitDisplayName);
  Handlebars.registerHelper("bjFormat", (key, options) => game.i18n.format(key, options?.hash ?? {}));
  Handlebars.registerHelper("bjCount", (key, count) => formatCount(key, count));
}

Hooks.once("ready", async () => {
  log.debug("Ready");

  game.bestiaryJournal = createApi();
  game.modules.get(MODULE_ID).api = game.bestiaryJournal;

  // Listen before migrating, so player requests sent meanwhile are not lost.
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    if (await handleBestiaryStoreSocket(data)) return;
    // Through the hook, so other modules hear every change on every client (API.md).
    if (data.action === "refreshBestiary") Hooks.callAll("bestiaryJournalRefresh", data);
  });
  Hooks.on("bestiaryJournalRefresh", (payload) => scheduleBestiaryRefresh(payload));
  registerNoteStoreHooks();
  registerSharingClock(isAuthorityGm);
  registerEncounterReveal(isAuthorityGm);

  if (game.user.isGM && isAuthorityGm()) await runMigrations();
  // Every user, players included: their favorites move off this browser.
  await migrateClientPreferencesToUser();
  await startKnowledgeWatch();
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
    pendingRefresh.uuids =
      pendingRefresh.uuids && uuids ? [...new Set([...pendingRefresh.uuids, ...uuids])] : null;
  }
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const merged = pendingRefresh;
    pendingRefresh = null;
    refreshBestiaryViews(merged);
  }, 40);
}

function refreshBestiaryViews(payload) {
  if (payload.changed?.knowledge) announceKnowledge();
  const main = game.bestiaryJournal?.mainApp;
  if (main?.rendered) main.refreshFromExternalUpdate(payload);
  for (const app of BestiarySectionView._instances) {
    if (app.rendered) app.refreshFromExternalUpdate(payload);
  }
  for (const app of BestiaryCreatureView._instances) {
    if (app.rendered) app.refreshFromExternalUpdate(payload);
  }
  const board = foundry.applications.instances.get(BestiaryKnowledgeBoard.DEFAULT_OPTIONS.id);
  if (board?.rendered && (payload.changed?.knowledge || payload.changed?.data || payload.changed?.creatures))
    board.render();
  refreshBestiaryChatLinks();
}

/** Art that fails to load (a broken compendium path) shows the silhouette, not the browser's broken-image glyph. */
function registerImageFallback() {
  document.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.closest(".bestiary-app") || img.dataset.bestiaryFallback)
        return;
      img.dataset.bestiaryFallback = "true";
      img.src = SILHOUETTE_PLACEHOLDER;
    },
    true,
  );
}

/** Opens the bestiary from the module settings menu instead of a form. */
class BestiarySettingsLauncher extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "bestiary-settings-launcher",
    window: { title: "BESTIARY.Title" },
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
