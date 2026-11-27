import {
  buildGmFeatures,
  buildGuideSteps,
  buildResearchGuideCards,
  buildShortcutCards,
  normalizeGuideTab,
  visibleGuideTabs,
} from "../core/guide-model.js";
import { getWorldResearchTiers, translateTierText } from "../foundry/creature-display.js";
import {
  getDismissedTipBanner,
  getShowOnboardingHints,
  hasSeenGuide,
  setDismissedTipBanner,
  setGuideSeen,
  setShowOnboardingHints,
} from "../foundry/client-preferences.js";
import { localize } from "../foundry/foundry-runtime.js";
import { formatKeybinding } from "../foundry/settings.js";
import { importBestiaryFromFile } from "../foundry/transfer.js";
import { BestiaryKnowledgeBoard } from "./knowledge-board.js";
import { BestiaryTierSettings } from "./tier-settings.js";
import { BestiaryTileEditor } from "./tile-editor.js";
import { activateTablistKeyboard, playApplicationEntrance } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "bestiary-journal";

const TAB_LABELS = {
  quickstart: "BESTIARY.Guide.TabQuickstart",
  gm: "BESTIARY.Guide.TabGm",
  research: "BESTIARY.Guide.TabResearch",
  shortcuts: "BESTIARY.Guide.TabShortcuts",
};

const TAB_ICONS = {
  quickstart: "fa-compass",
  gm: "fa-wand-magic-sparkles",
  research: "fa-book-open",
  shortcuts: "fa-keyboard",
};

/**
 * Interactive onboarding and feature reference window for GMs and players.
 * Shows role-specific quick start steps, the live world tier ladder,
 * granular privacy/notes rules, and keyboard/drag shortcuts.
 */
export class BestiaryGuideApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bestiary-guide",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-guide"],
    tag: "div",
    window: {
      title: "BESTIARY.Guide.Title",
      icon: "fa-solid fa-compass",
      resizable: true,
      minimizable: true,
    },
    position: { width: 840, height: 680 },
    actions: {
      setTab: function (event, target) {
        this._onSetTab(target.dataset.tab);
      },
      runAction: function (event, target) {
        this._onRunAction(target.dataset.guideAction);
      },
      restoreTips: function () {
        this._onRestoreTips();
      },
      finishGuide: function () {
        this.close();
      },
    },
  };

  static PARTS = {
    guide: {
      template: "modules/bestiary-journal/templates/guide.hbs",
      scrollable: [".guide-scroll"],
    },
  };

  static open({ tab = "quickstart" } = {}) {
    const existing = foundry.applications?.instances?.get?.(BestiaryGuideApp.DEFAULT_OPTIONS.id);
    if (existing) {
      if (tab) existing.setTab(tab);
      if (existing.minimized) existing.maximize?.();
      existing.bringToFront?.();
      return existing;
    }
    const app = new BestiaryGuideApp({ tab });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this._tab = normalizeGuideTab(options.tab, !!game?.user?.isGM);
  }

  setTab(tab) {
    this._tab = normalizeGuideTab(tab, !!game?.user?.isGM);
    if (this.rendered) this.render();
  }

  async _prepareContext() {
    const isGM = !!game?.user?.isGM;
    const activeTab = normalizeGuideTab(this._tab, isGM);
    this._tab = activeTab;

    const tabs = visibleGuideTabs(isGM).map((key) => ({
      key,
      icon: TAB_ICONS[key],
      label: localize(TAB_LABELS[key]),
      active: key === activeTab,
    }));

    const keyHint = formatKeybinding(game?.keybindings?.get?.(MODULE_ID, "openBestiary"));
    const tiers = getWorldResearchTiers().map((tier) => ({
      value: tier.value,
      icon: tier.icon,
      color: tier.color,
      label: translateTierText(tier.label),
      hint: translateTierText(tier.hint),
    }));

    return {
      isGM,
      roleBadge: localize(isGM ? "BESTIARY.Guide.RoleGm" : "BESTIARY.Guide.RolePlayer"),
      roleLead: localize(isGM ? "BESTIARY.Guide.LeadGm" : "BESTIARY.Guide.LeadPlayer"),
      tabs,
      isQuickstart: activeTab === "quickstart",
      isGmTab: activeTab === "gm",
      isResearch: activeTab === "research",
      isShortcuts: activeTab === "shortcuts",
      steps: buildGuideSteps({ isGM }).map((step) => ({
        ...step,
        title: localize(step.titleKey),
        body: localize(step.bodyKey),
        actionLabel: step.actionLabelKey ? localize(step.actionLabelKey) : "",
      })),
      gmFeatures: isGM
        ? buildGmFeatures().map((card) => ({
            ...card,
            title: localize(card.titleKey),
            body: localize(card.bodyKey),
            actionLabel: card.actionLabelKey ? localize(card.actionLabelKey) : "",
          }))
        : [],
      tiers,
      researchCards: buildResearchGuideCards({ isGM }).map((card) => ({
        ...card,
        title: localize(card.titleKey),
        body: localize(card.bodyKey),
      })),
      shortcutCards: buildShortcutCards({ keyHint, isGM }).map((card) => ({
        ...card,
        title: localize(card.titleKey),
        body: localize(card.bodyKey),
      })),
      hintsEnabled: getShowOnboardingHints(),
      bannerDismissed: getDismissedTipBanner(),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    void setGuideSeen(true);
    playApplicationEntrance(this, ".guide-shell");

    const tablist = this.element?.querySelector(".guide-tabs");
    activateTablistKeyboard(tablist, (tab) => this._onSetTab(tab.dataset.tab, { focus: true }));

    this.element?.querySelector(".guide-hints-toggle")?.addEventListener("change", async (event) => {
      await setShowOnboardingHints(event.currentTarget.checked);
    });
  }

  _onSetTab(tab, { focus = false } = {}) {
    const next = normalizeGuideTab(tab, !!game?.user?.isGM);
    if (next === this._tab) return;
    this._tab = next;
    void this.render().then(() => {
      if (focus) this.element?.querySelector(`.guide-tabs [data-tab="${next}"]`)?.focus();
    });
  }

  async _onRunAction(action) {
    if (!action) return;
    if (action === "createCollection") {
      if (game.user.isGM) new BestiaryTileEditor({ mode: "section" }).render({ force: true });
    } else if (action === "openTierSettings") {
      if (game.user.isGM) new BestiaryTierSettings().render({ force: true });
    } else if (action === "openKnowledgeBoard") {
      if (game.user.isGM) BestiaryKnowledgeBoard.open();
    } else if (action === "importSnapshot") {
      if (game.user.isGM) await importBestiaryFromFile();
    } else if (action === "openModuleSettings") {
      game.settings?.sheet?.render?.({ force: true });
    }
  }

  async _onRestoreTips() {
    await setShowOnboardingHints(true);
    await setDismissedTipBanner(false);
    ui?.notifications?.info?.(localize("BESTIARY.Guide.BannersRestored"));
    await this.render();
  }
}

/**
 * Opens the interactive onboarding guide once automatically when a user opens
 * Bestiary Journal for the first time and has onboarding hints enabled.
 */
export function maybeShowFirstTimeGuide(ownerApp) {
  if (!ownerApp || ownerApp._autoGuideTriggered) return;
  if (hasSeenGuide() || !getShowOnboardingHints()) return;
  ownerApp._autoGuideTriggered = true;
  setTimeout(() => {
    if (ownerApp.rendered) BestiaryGuideApp.open({ tab: "quickstart" });
  }, 160);
}
