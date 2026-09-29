import { BESTIARY_COMMANDS, selectVisibleFamilies } from "../core/bestiary-domain.js";
import { getBestiaryData } from "../foundry/bestiary-store.js";
import { runCommand } from "../foundry/command-feedback.js";
import { getCreatureData } from "../foundry/creature-cache.js";
import { buildImageView } from "../core/image-framing.js";
import { researchSkillOptions, skillLabel } from "../foundry/research.js";
import { localize } from "../foundry/foundry-runtime.js";
import { suggestResearchDc, suggestResearchSkill } from "../core/research-model.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Per-entry settings a GM controls: which family it belongs to, how the art is
 * framed, the identification DC, and the visibility/lock flags.
 */
export class BestiaryEntryEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-entry-editor-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-entry-editor"],
    tag: "form",
    window: { title: "BESTIARY.Entry.Title", icon: "fa-solid fa-sliders", resizable: false },
    position: { width: 620, height: "auto" },
    form: {
      handler: function (event, form, formData) { return this._onFormSubmit(event, form, formData); },
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      setImageSource: function (event, target) { this._onSetImageSource(event, target); },
      setFit: function (event, target) { this._onSetFit(event, target); },
      centerFocus: function () { this._setFocus(50, 50); },
      suggestDc: function () { this._onSuggestDc(); }
    }
  };

  static PARTS = {
    form: { template: "modules/bestiary-journal/templates/entry-editor.hbs" }
  };

  constructor(options = {}) {
    const uniqueId = options.uniqueId ?? foundry.utils.randomID(16);
    super({ ...options, uniqueId });
    this.sectionId = options.sectionId;
    this.uuid = options.uuid;
    this._draft = null;
    this._creature = null;
  }

  get entry() {
    const section = getBestiaryData().sections.find(item => item.id === this.sectionId);
    return section?.creatures.find(item => item.uuid === this.uuid) ?? null;
  }

  async _prepareContext() {
    const data = getBestiaryData();
    const section = data.sections.find(item => item.id === this.sectionId);
    const entry = this.entry;
    if (!entry) return { error: true };

    this._creature ??= await getCreatureData(this.uuid);
    this._draft ??= foundry.utils.deepClone(entry);

    const preview = buildImageView(this._draft, this._creature ?? {});
    const tokenSrc = this._creature?.prototypeToken;

    return {
      error: false,
      name: this._creature?.name ?? this._draft.label ?? this.uuid,
      sectionName: section?.name ?? "",
      families: [
        { id: "", name: game.i18n.localize("BESTIARY.Families.None"), selected: !this._draft.familyId },
        ...selectVisibleFamilies(section, true).map(family => ({
          id: family.id,
          name: family.name,
          selected: family.id === this._draft.familyId
        }))
      ],
      imageSource: this._draft.image.source,
      isPortraitSource: this._draft.image.source === "portrait",
      hasToken: !!tokenSrc && tokenSrc !== this._creature?.img,
      fit: this._draft.image.fit,
      isCover: this._draft.image.fit === "cover",
      focusX: this._draft.image.focusX,
      focusY: this._draft.image.focusY,
      preview,
      dc: this._draft.research.dc ?? "",
      dcPlaceholder: suggestResearchDc(this._creature?.cr),
      // Only explicit picks are ticked; with none, the automatic skill applies
      // and saving must not quietly pin it.
      skills: researchSkillOptions(this._draft.research.skills ?? []),
      autoSkillLabel: game.i18n.format("BESTIARY.Research.SkillsAuto", {
        skill: skillLabel(suggestResearchSkill(this._creature?.creatureTypeKey))
      }),
      hidden: !!this._draft.hidden,
      locked: !!this._draft.locked
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (context.error) return;
    this._activateFocusPicker();
    // Every field writes through to the draft, so nothing typed is lost if
    // the form has to be drawn again.
    this.element.addEventListener("change", () => this._captureForm());
  }

  _captureForm() {
    const form = this.element;
    if (!this._draft || !form?.querySelector) return;
    const value = name => form.querySelector(`[name="${name}"]`);
    this._draft.familyId = value("familyId")?.value || null;
    const dc = value("dc")?.value;
    this._draft.research.dc = dc === "" || dc === undefined ? null : Number(dc);
    this._draft.research.skills = [...form.querySelectorAll('[name="skills"]:checked')].map(input => input.value);
    this._draft.hidden = !!value("hidden")?.checked;
    this._draft.locked = !!value("locked")?.checked;
  }

  /** Click or drag on the preview to place the focal point. */
  _activateFocusPicker() {
    const stage = this.element.querySelector(".entry-focus-stage");
    if (!stage) return;
    let dragging = false;

    const apply = event => {
      const bounds = stage.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 100;
      const y = ((event.clientY - bounds.top) / bounds.height) * 100;
      this._setFocus(x, y);
    };

    stage.addEventListener("pointerdown", event => {
      dragging = true;
      stage.setPointerCapture(event.pointerId);
      apply(event);
    });
    stage.addEventListener("pointermove", event => { if (dragging) apply(event); });
    stage.addEventListener("pointerup", event => {
      dragging = false;
      stage.releasePointerCapture(event.pointerId);
    });
    stage.addEventListener("pointercancel", () => { dragging = false; });
  }

  _setFocus(x, y) {
    const focusX = Math.max(0, Math.min(100, Math.round(x)));
    const focusY = Math.max(0, Math.min(100, Math.round(y)));
    this._draft.image.focusX = focusX;
    this._draft.image.focusY = focusY;
    this._draft.image.fit = "cover";
    this._syncPreview();
  }

  _onSetImageSource(event, target) {
    this._draft.image.source = target.dataset.source === "token" ? "token" : "portrait";
    for (const button of this.element.querySelectorAll("[data-source]")) {
      button.classList.toggle("is-active", button.dataset.source === this._draft.image.source);
    }
    this._syncPreview();
  }

  _onSetFit(event, target) {
    this._draft.image.fit = target.dataset.fit === "cover" ? "cover" : "contain";
    this._syncPreview();
  }

  _syncPreview() {
    const preview = buildImageView(this._draft, this._creature ?? {});
    const frame = this.element.querySelector(".entry-focus-stage .bestiary-frame");
    const image = this.element.querySelector(".entry-focus-stage .bestiary-frame img");
    const backdrop = this.element.querySelector(".entry-focus-stage .bestiary-frame-backdrop");
    const dot = this.element.querySelector(".entry-focus-dot");

    if (frame) frame.className = preview.frameClass;
    if (image) {
      image.setAttribute("style", preview.imageStyle);
      if (image.getAttribute("src") !== preview.src) image.src = preview.src;
    }
    if (backdrop) {
      backdrop.setAttribute("style", preview.backdropStyle);
      backdrop.hidden = !preview.useBackdrop;
    } else if (preview.useBackdrop && frame) {
      const layer = document.createElement("div");
      layer.className = "bestiary-frame-backdrop";
      layer.setAttribute("style", preview.backdropStyle);
      frame.prepend(layer);
    }
    if (dot) {
      dot.style.left = `${preview.focusX}%`;
      dot.style.top = `${preview.focusY}%`;
      dot.classList.toggle("is-active", preview.fit === "cover");
    }
    for (const button of this.element.querySelectorAll("[data-fit]")) {
      button.classList.toggle("is-active", button.dataset.fit === preview.fit);
    }
  }

  _onSuggestDc() {
    const input = this.element.querySelector('input[name="dc"]');
    if (input) input.value = String(suggestResearchDc(this._creature?.cr));
    this._captureForm();
  }

  async _onFormSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const skills = [].concat(data.skills ?? []).filter(Boolean);
    const wasLocked = !!this.entry?.locked;
    const wantsLocked = !!data.locked;
    const patch = {
      familyId: data.familyId || null,
      hidden: !!data.hidden,
      image: {
        source: this._draft.image.source,
        fit: this._draft.image.fit,
        focusX: this._draft.image.focusX,
        focusY: this._draft.image.focusY
      },
      research: {
        dc: data.dc === "" || data.dc === null || data.dc === undefined ? null : Number(data.dc),
        skills
      }
    };

    // A locked entry refuses edits, so lift the lock around the update and
    // put it back even if the update itself is rejected.
    if (wasLocked && !await this._setLock(false)) return;
    const result = await runCommand({
      type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
      sectionId: this.sectionId,
      uuid: this.uuid,
      patch
    });
    if (wantsLocked) await this._setLock(true);
    if (result && !result.changed) ui.notifications.warn(localize("BESTIARY.Lock.Blocked"));
  }

  async _setLock(locked) {
    const result = await runCommand({
      type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
      sectionId: this.sectionId,
      uuid: this.uuid,
      locked
    });
    return !!result;
  }
}
