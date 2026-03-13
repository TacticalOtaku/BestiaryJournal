import { getBestiaryData, setBestiaryData } from "./helpers.mjs";
import { BestiaryTileEditor } from "./tile-editor.mjs";
import { BestiarySectionView } from "./section-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BestiaryApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "bestiary-main",
    classes: ["bestiary-journal", "bestiary-main"],
    tag: "div",
    window: {
      title: "BESTIARY.Title",
      icon: "fas fa-book-skull",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 920,
      height: 680
    },
    actions: {
      createSection: function (event, target) { this._onCreateSection(event, target); },
      openSection: function (event, target) { this._onOpenSection(event, target); },
      editSection: function (event, target) { this._onEditSection(event, target); },
      deleteSection: function (event, target) { this._onDeleteSection(event, target); },
      toggleSectionVisibility: function (event, target) { this._onToggleSectionVisibility(event, target); }
    }
  };

  static PARTS = {
    main: {
      template: "modules/bestiary-journal/templates/bestiary-main.hbs"
    }
  };

  async _prepareContext(options) {
    const data = getBestiaryData();
    const isGM = game.user.isGM;

    const sections = data.sections
      .filter(s => isGM || !s.hidden)
      .map(s => ({
        ...s,
        creatureCount: (s.creatures ?? []).filter(c => isGM || !c.hidden).length,
        displayImage: s.image || "icons/svg/book.svg",
        isHidden: !!s.hidden
      }));

    return {
      sections,
      isGM,
      noSections: sections.length === 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateContextMenus();
  }

  _activateContextMenus() {
    if (!game.user.isGM) return;
    const tiles = this.element.querySelectorAll(".bestiary-tile[data-section-id]");
    for (const tile of tiles) {
      tile.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const sectionId = tile.dataset.sectionId;
        const isHidden = tile.dataset.hidden === "true";
        const menuItems = [
          {
            name: game.i18n.localize("BESTIARY.EditSection"),
            icon: '<i class="fas fa-edit"></i>',
            callback: () => this._editSectionById(sectionId)
          },
          {
            name: isHidden
              ? game.i18n.localize("BESTIARY.ShowToPlayers")
              : game.i18n.localize("BESTIARY.HideFromPlayers"),
            icon: isHidden
              ? '<i class="fas fa-eye"></i>'
              : '<i class="fas fa-eye-slash"></i>',
            callback: () => this._toggleSectionVisibilityById(sectionId)
          },
          {
            name: game.i18n.localize("BESTIARY.DeleteSection"),
            icon: '<i class="fas fa-trash"></i>',
            callback: () => this._deleteSectionById(sectionId)
          }
        ];
        this._showContextMenu(event, menuItems);
      });
    }
  }

  _showContextMenu(event, items) {
    document.querySelectorAll(".bestiary-context-menu").forEach(el => el.remove());
    const menu = document.createElement("nav");
    menu.classList.add("bestiary-context-menu");
    menu.style.position = "fixed";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.style.zIndex = "10000";

    const ol = document.createElement("ol");
    ol.classList.add("context-items");
    for (const item of items) {
      const li = document.createElement("li");
      li.classList.add("context-item");
      li.innerHTML = `${item.icon} <span>${item.name}</span>`;
      li.addEventListener("click", () => { menu.remove(); item.callback(); });
      ol.appendChild(li);
    }
    menu.appendChild(ol);
    document.body.appendChild(menu);
    const close = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", close); }
    };
    setTimeout(() => document.addEventListener("click", close), 10);
  }

  // ── Action handlers ──

  _onCreateSection(event, target) {
    new BestiaryTileEditor({ onSave: () => this.render() }).render(true);
  }

  _onOpenSection(event, target) {
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (!sectionId) return;
    new BestiarySectionView({ sectionId }).render(true);
  }

  _onEditSection(event, target) {
    event.stopPropagation();
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this._editSectionById(sectionId);
  }

  _onDeleteSection(event, target) {
    event.stopPropagation();
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this._deleteSectionById(sectionId);
  }

  _onToggleSectionVisibility(event, target) {
    event.stopPropagation();
    const sectionId = target.closest("[data-section-id]")?.dataset.sectionId;
    if (sectionId) this._toggleSectionVisibilityById(sectionId);
  }

  // ── Internal methods ──

  _editSectionById(sectionId) {
    const data = getBestiaryData();
    const section = data.sections.find(s => s.id === sectionId);
    if (!section) return;
    new BestiaryTileEditor({ sectionData: section, onSave: () => this.render() }).render(true);
  }

  async _deleteSectionById(sectionId) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BESTIARY.DeleteSection") },
      content: `<p>${game.i18n.localize("BESTIARY.ConfirmDelete")}</p>`,
      yes: { default: true }
    });
    if (!confirmed) return;
    const data = getBestiaryData();
    data.sections = data.sections.filter(s => s.id !== sectionId);
    await setBestiaryData(data);
    this.render();
  }

  async _toggleSectionVisibilityById(sectionId) {
    const data = getBestiaryData();
    const section = data.sections.find(s => s.id === sectionId);
    if (!section) return;
    section.hidden = !section.hidden;
    await setBestiaryData(data);
    this.render();
  }
}
