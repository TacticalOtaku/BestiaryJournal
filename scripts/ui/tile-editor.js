import { BESTIARY_COMMANDS } from "../core/bestiary-domain.js";
import { runCommand } from "../foundry/command-feedback.js";
import { openFilePicker } from "../foundry/foundry-runtime.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Creates and edits both collections and the families nested inside them —
 * the two share the same shape (name, cover, hidden), so they share one form.
 */
export class BestiaryTileEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-tile-editor-{id}",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-tile-editor"],
    tag: "form",
    window: { title: "BESTIARY.CreateSection", icon: "fa-solid fa-plus-circle", resizable: false },
    position: { width: 520, height: "auto" },
    form: {
      handler: function (event, form, formData) { return this._onFormSubmit(event, form, formData); },
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      pickImage: function (event, target) { this._onPickImage(event, target); },
      clearImage: function () { this._onClearImage(); }
    }
  };

  static PARTS = {
    form: { template: "modules/bestiary-journal/templates/tile-editor.hbs" }
  };

  constructor(options = {}) {
    const mode = options.mode === "family" ? "family" : "section";
    const isEdit = !!options.tileData;
    const uniqueId = options.uniqueId ?? foundry.utils.randomID(16);
    super(foundry.utils.mergeObject({ ...options, uniqueId }, {
      window: {
        title: isEdit
          ? (mode === "family" ? "BESTIARY.Families.Edit" : "BESTIARY.EditSection")
          : (mode === "family" ? "BESTIARY.Families.Create" : "BESTIARY.CreateSection")
      }
    }));
    this.mode = mode;
    this.sectionId = options.sectionId ?? null;
    this.tileData = options.tileData ?? null;
    this._selectedImage = this.tileData?.image ?? "";
  }

  async _prepareContext() {
    return {
      isFamily: this.mode === "family",
      image: this._selectedImage,
      name: this.tileData?.name ?? "",
      isEdit: !!this.tileData,
      isHidden: this.tileData?.hidden ?? false,
      nameLabel: this.mode === "family" ? "BESTIARY.Families.Name" : "BESTIARY.SectionName",
      imageLabel: this.mode === "family" ? "BESTIARY.Families.Image" : "BESTIARY.SectionImage",
      hint: this.mode === "family" ? "BESTIARY.Families.Hint" : "BESTIARY.CollectionsHint"
    };
  }

  _onPickImage() {
    openFilePicker({
      type: "image",
      current: this._selectedImage,
      callback: path => this._applyImage(path)
    });
  }

  _onClearImage() {
    this._applyImage("");
  }

  _applyImage(path) {
    this._selectedImage = path ?? "";
    const preview = this.element.querySelector(".tile-editor-preview img");
    if (preview) {
      preview.src = this._selectedImage;
      preview.classList.toggle("is-empty", !this._selectedImage);
    }
    this.element.querySelector(".tile-editor-preview")
      ?.classList.toggle("is-empty", !this._selectedImage);
    const input = this.element.querySelector('input[name="image"]');
    if (input) input.value = this._selectedImage;
  }

  async _onFormSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const patch = {
      name: String(data.name ?? "").trim(),
      image: data.image || "",
      hidden: !!data.hidden
    };

    if (this.mode === "family") {
      await runCommand(this.tileData
        ? {
            type: BESTIARY_COMMANDS.UPDATE_FAMILY,
            sectionId: this.sectionId,
            familyId: this.tileData.id,
            patch
          }
        : {
            type: BESTIARY_COMMANDS.CREATE_FAMILY,
            sectionId: this.sectionId,
            family: patch
          },
      { unchanged: "BESTIARY.Lock.Blocked" });
    } else {
      await runCommand(this.tileData
        ? { type: BESTIARY_COMMANDS.UPDATE_SECTION, sectionId: this.tileData.id, patch }
        : { type: BESTIARY_COMMANDS.CREATE_SECTION, section: patch },
      { unchanged: "BESTIARY.Lock.Blocked" });
    }
  }
}
