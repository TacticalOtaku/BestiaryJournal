import { buildTierMatrix, getWorldBlockTiers, setWorldBlockTiers } from "../foundry/creature-display.js";
import { defaultBlockTiers, resolveBlockTiers } from "../core/research-model.js";
import { localize } from "../foundry/foundry-runtime.js";
import { playApplicationEntrance } from "./ui-effects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * World defaults for the research ladder: at which tier each block of a
 * creature card becomes readable. Single creatures may still override this.
 */
export class BestiaryTierSettings extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-tier-settings",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-tier-settings"],
    tag: "form",
    window: { title: "BESTIARY.Tier.WorldTitle", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 780, height: 720 },
    form: {
      handler: function (event, form, formData) { return this._onFormSubmit(event, form, formData); },
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      restoreDefaults: function () { this._onRestoreDefaults(); }
    }
  };

  static PARTS = {
    form: { template: "modules/bestiary-journal/templates/tier-settings.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this._draft = null;
  }

  async _prepareContext() {
    this._draft ??= resolveBlockTiers(getWorldBlockTiers(), null);
    return {
      // Highlight what this world changed against the built-in ladder.
      groups: buildTierMatrix(this._draft, this._draft, defaultBlockTiers()),
      hint: localize("BESTIARY.Tier.WorldHint")
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const select of this.element.querySelectorAll("[data-block-tier]")) {
      select.addEventListener("change", event => {
        this._draft[event.currentTarget.dataset.blockTier] = Number(event.currentTarget.value);
      });
    }
    playApplicationEntrance(this, ".tier-settings-shell");
  }

  _onRestoreDefaults() {
    this._draft = defaultBlockTiers();
    this.render();
  }

  async _onFormSubmit() {
    await setWorldBlockTiers(this._draft);
    // The setting's onChange refreshes every client, this one included.
    ui.notifications.info(localize("BESTIARY.Tier.WorldSaved"));
  }
}
