import { generateId, getBestiaryData, setBestiaryData } from "./helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiaryTileEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-tile-editor",
    classes: ["bestiary-journal", "bestiary-app", "bestiary-tile-editor"],
    tag: "form",
    window: {
      title: "BESTIARY.CreateSection",
      icon: "fas fa-plus-circle",
      resizable: false
    },
    position: {
      width: 480,
      height: "auto"
    },
    form: {
      handler: function (event, form, formData) { return this._onFormSubmit(event, form, formData); },
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      pickImage: function (event, target) { this._onPickImage(event, target); }
    }
  };

  static PARTS = {
    form: {
      template: "modules/bestiary-journal/templates/tile-editor.hbs"
    }
  };

  constructor(options = {}) {
    const isEdit = !!options.sectionData;
    super(foundry.utils.mergeObject(options, {
      window: {
        title: isEdit ? "BESTIARY.EditSection" : "BESTIARY.CreateSection"
      }
    }));
    this.sectionData = options.sectionData ?? null;
    this.onSaveCallback = options.onSave ?? null;
    this._selectedImage = this.sectionData?.image ?? "";
  }

  async _prepareContext(options) {
    return {
      section: this.sectionData,
      image: this._selectedImage,
      name: this.sectionData?.name ?? "",
      isEdit: !!this.sectionData,
      isHidden: this.sectionData?.hidden ?? false
    };
  }

  async _onPickImage(event, target) {
    const fp = new FilePicker({
      type: "image",
      current: this._selectedImage,
      callback: (path) => {
        this._selectedImage = path;
        const preview = this.element.querySelector(".tile-editor-preview img");
        if (preview) {
          preview.src = path;
          preview.style.display = path ? "block" : "none";
        }
        const input = this.element.querySelector('input[name="image"]');
        if (input) input.value = path;
      }
    });
    fp.render(true);
  }

  async _onFormSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const bestiaryData = getBestiaryData();

    if (this.sectionData) {
      const section = bestiaryData.sections.find(s => s.id === this.sectionData.id);
      if (section) {
        section.name = data.name || "";
        section.image = data.image || "";
        section.hidden = !!data.hidden;
        section.updatedAt = Date.now();
      }
    } else {
      bestiaryData.sections.push({
        id: generateId(),
        name: data.name || "",
        image: data.image || "",
        hidden: !!data.hidden,
        updatedAt: Date.now(),
        creatures: []
      });
    }

    await setBestiaryData(bestiaryData);
    if (this.onSaveCallback) this.onSaveCallback();
  }
}
