import { BESTIARY_COMMANDS, selectVisibleFamilies } from "./bestiary-domain.mjs";
import { dispatchBestiaryCommand, getBestiaryData } from "./bestiary-store.mjs";
import { buildImageView } from "./image-framing.mjs";
import { extractCreatureData } from "./helpers.mjs";
import { resolveResearchConfig, researchSkillOptions } from "./research.mjs";
import { resolveUuid } from "./foundry-runtime.mjs";
import { suggestResearchDc } from "./research-model.mjs";

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
    window: { title: "BESTIARY.Entry.Title", icon: "fas fa-sliders", resizable: false },
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
    this.onSaveCallback = options.onSave ?? null;
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

    if (!this._creature) {
      const actor = await resolveUuid(this.uuid);
      this._creature = actor ? await extractCreatureData(actor) : null;
    }
    this._draft ??= foundry.utils.deepClone(entry);

    const research = resolveResearchConfig(this._draft, this._creature);
    const preview = buildImageView(this._draft, this._creature ?? {});

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
      hasToken: !!this._creature?.prototypeToken,
      fit: this._draft.image.fit,
      isCover: this._draft.image.fit === "cover",
      focusX: this._draft.image.focusX,
      focusY: this._draft.image.focusY,
      preview,
      dc: this._draft.research.dc ?? "",
      dcPlaceholder: suggestResearchDc(this._creature?.cr),
      skills: researchSkillOptions(research.skills),
      hidden: !!this._draft.hidden,
      locked: !!this._draft.locked
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (context.error) return;
    this._activateFocusPicker();
    this.element.querySelector(".entry-family-select")?.addEventListener("change", event => {
      this._draft.familyId = event.currentTarget.value || null;
    });
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
    this.render();
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
    if (image) image.setAttribute("style", preview.imageStyle);
    if (backdrop) backdrop.setAttribute("style", preview.backdropStyle);
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
  }

  async _onFormSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const skills = [].concat(data.skills ?? []).filter(Boolean);
    const wasLocked = !!this.entry?.locked;
    const wantsLocked = !!data.locked;

    if (wasLocked) {
      await dispatchBestiaryCommand({
        type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
        sectionId: this.sectionId,
        uuid: this.uuid,
        locked: false
      });
    }

    await dispatchBestiaryCommand({
      type: BESTIARY_COMMANDS.UPDATE_CREATURE_ENTRY,
      sectionId: this.sectionId,
      uuid: this.uuid,
      patch: {
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
      }
    });

    if (wantsLocked) {
      await dispatchBestiaryCommand({
        type: BESTIARY_COMMANDS.SET_CREATURE_LOCK,
        sectionId: this.sectionId,
        uuid: this.uuid,
        locked: true
      });
    }

    this.onSaveCallback?.();
  }
}
