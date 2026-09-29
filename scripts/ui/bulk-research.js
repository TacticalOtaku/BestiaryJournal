import { BESTIARY_COMMANDS, selectResearchTargets } from "../core/bestiary-domain.js";
import { describeCommandError, dispatchBestiaryCommand, getBestiaryData } from "../foundry/bestiary-store.js";
import { localize } from "../foundry/foundry-runtime.js";
import { researchSkillOptions } from "../foundry/research.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** GM batch editor. One command persists all selected entries atomically. */
export class BestiaryBulkResearch extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bestiary-bulk-research-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-bulk-research"],
    tag: "form",
    window: { title: "BESTIARY.BulkResearch.Title", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 560, height: "auto" },
    form: {
      handler: function (event, form) { return this._submitSettings(form); },
      closeOnSubmit: false
    }
  };

  static PARTS = { form: { template: "modules/bestiary-journal/templates/bulk-research.hbs" } };

  constructor(options = {}) {
    super({ ...options, uniqueId: options.uniqueId ?? foundry.utils.randomID(16) });
    this.sectionId = options.sectionId;
    this.familyId = options.familyId;
  }

  async _prepareContext() {
    if (!game.user.isGM) throw new Error("This editor is reserved for the Game Master");
    const section = getBestiaryData().sections.find(item => item.id === this.sectionId);
    return {
      sectionName: section?.name ?? "",
      scopes: [
        { value: "section", label: localize("BESTIARY.BulkResearch.Collection"), selected: this.familyId === undefined },
        { value: "family", label: localize("BESTIARY.BulkResearch.Family"), selected: this.familyId !== undefined },
        { value: "all", label: localize("BESTIARY.BulkResearch.All") }
      ],
      families: [
        { id: "", name: localize("BESTIARY.Families.None"), selected: !this.familyId },
        ...(section?.families ?? []).map(family => ({ ...family, selected: family.id === this.familyId }))
      ],
      skills: researchSkillOptions()
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("change", () => this._syncForm());
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._syncForm();
  }

  _selection(form = this.element) {
    return {
      scope: form.querySelector('[name="scope"]').value,
      sectionId: this.sectionId,
      familyId: form.querySelector('[name="familyId"]').value || null
    };
  }

  _syncForm() {
    const form = this.element;
    const selection = this._selection(form);
    const dcMode = form.querySelector('[name="dcMode"]').value;
    const skillsMode = form.querySelector('[name="skillsMode"]').value;
    const dc = form.querySelector('[name="dc"]');
    dc.disabled = dcMode !== "set";
    dc.required = dcMode === "set";
    form.querySelector('[data-dc-value]').hidden = dcMode !== "set";
    form.querySelector('[data-family-field]').hidden = selection.scope !== "family";
    const skills = form.querySelector('[data-skills]');
    skills.hidden = skillsMode !== "set";
    skills.disabled = skillsMode !== "set";
    let targets = [];
    try { targets = selectResearchTargets(getBestiaryData(), selection); } catch { /* A collection may have been deleted. */ }
    const count = targets.filter(target => !target.locked).length;
    form.querySelector('[data-summary]').textContent = game.i18n.format("BESTIARY.BulkResearch.Summary", {
      count, skipped: targets.length - count
    });
    form.querySelector('[type="submit"]').disabled = !count || (dcMode === "keep" && skillsMode === "keep");
  }

  async _submitSettings(form) {
    if (!game.user.isGM || this._saving) return;
    const patch = {};
    const dcMode = form.querySelector('[name="dcMode"]').value;
    const skillsMode = form.querySelector('[name="skillsMode"]').value;
    if (dcMode === "auto") patch.dc = null;
    if (dcMode === "set") {
      const field = form.querySelector('[name="dc"]');
      if (!field.reportValidity()) return;
      patch.dc = Number(field.value);
    }
    if (skillsMode === "auto") patch.skills = [];
    if (skillsMode === "set") {
      patch.skills = [...form.querySelectorAll('[name="skills"]:checked')].map(input => input.value);
      if (!patch.skills.length) {
        ui.notifications.warn(localize("BESTIARY.BulkResearch.PickSkill"));
        return;
      }
    }
    if (!Object.keys(patch).length) return;
    this._saving = true;
    form.querySelector('[type="submit"]').disabled = true;
    try {
      await dispatchBestiaryCommand({ type: BESTIARY_COMMANDS.BULK_UPDATE_RESEARCH, ...this._selection(form), patch });
      ui.notifications.info(localize("BESTIARY.BulkResearch.Done"));
      await this.close();
    } catch (error) {
      ui.notifications.error(describeCommandError(error));
    } finally {
      this._saving = false;
      if (this.element?.querySelector('[name="scope"]')) this._syncForm();
    }
  }
}
