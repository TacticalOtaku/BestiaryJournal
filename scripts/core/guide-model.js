/**
 * Pure data structures and selection helpers for Bestiary Journal onboarding,
 * contextual tips, and the interactive feature guide.
 * Zero Foundry globals: passes runtime facts (role, keybinding label, live tiers) in.
 */

export const GUIDE_TABS = Object.freeze(["quickstart", "gm", "research", "shortcuts"]);

export function visibleGuideTabs(isGM) {
  return isGM ? [...GUIDE_TABS] : GUIDE_TABS.filter((tab) => tab !== "gm");
}

export function normalizeGuideTab(tab, isGM) {
  const allowed = visibleGuideTabs(isGM);
  return allowed.includes(tab) ? tab : allowed[0];
}

export function buildQuickTips({ isGM = false } = {}) {
  if (isGM) {
    return [
      {
        id: "gm-import",
        icon: "fa-layer-group",
        titleKey: "BESTIARY.Guide.TipGmImportTitle",
        bodyKey: "BESTIARY.Guide.TipGmImportBody",
        tab: "gm",
      },
      {
        id: "gm-custom-tiers",
        icon: "fa-stairs",
        titleKey: "BESTIARY.Guide.TipGmTiersTitle",
        bodyKey: "BESTIARY.Guide.TipGmTiersBody",
        tab: "gm",
      },
      {
        id: "gm-preview",
        icon: "fa-user-secret",
        titleKey: "BESTIARY.Guide.TipGmPreviewTitle",
        bodyKey: "BESTIARY.Guide.TipGmPreviewBody",
        tab: "gm",
      },
      {
        id: "gm-board-pins",
        icon: "fa-table-cells",
        titleKey: "BESTIARY.Guide.TipGmBoardTitle",
        bodyKey: "BESTIARY.Guide.TipGmBoardBody",
        tab: "gm",
      },
      {
        id: "gm-chat-search",
        icon: "fa-comment-dots",
        titleKey: "BESTIARY.Guide.TipSharedChatTitle",
        bodyKey: "BESTIARY.Guide.TipSharedChatBody",
        tab: "shortcuts",
      },
    ];
  }

  return [
    {
      id: "player-research",
      icon: "fa-dice-d20",
      titleKey: "BESTIARY.Guide.TipPlayerResearchTitle",
      bodyKey: "BESTIARY.Guide.TipPlayerResearchBody",
      tab: "research",
    },
    {
      id: "player-share",
      icon: "fa-share-nodes",
      titleKey: "BESTIARY.Guide.TipPlayerShareTitle",
      bodyKey: "BESTIARY.Guide.TipPlayerShareBody",
      tab: "research",
    },
    {
      id: "player-notes",
      icon: "fa-comments",
      titleKey: "BESTIARY.Guide.TipPlayerNotesTitle",
      bodyKey: "BESTIARY.Guide.TipPlayerNotesBody",
      tab: "research",
    },
    {
      id: "player-chat-search",
      icon: "fa-comment-dots",
      titleKey: "BESTIARY.Guide.TipSharedChatTitle",
      bodyKey: "BESTIARY.Guide.TipSharedChatBody",
      tab: "shortcuts",
    },
  ];
}

export function buildGuideSteps({ isGM = false } = {}) {
  if (isGM) {
    return [
      {
        step: 1,
        icon: "fa-folder-plus",
        titleKey: "BESTIARY.Guide.StepGm1Title",
        bodyKey: "BESTIARY.Guide.StepGm1Body",
        action: "createCollection",
        actionIcon: "fa-plus",
        actionLabelKey: "BESTIARY.NewCollection",
      },
      {
        step: 2,
        icon: "fa-layer-group",
        titleKey: "BESTIARY.Guide.StepGm2Title",
        bodyKey: "BESTIARY.Guide.StepGm2Body",
        action: null,
      },
      {
        step: 3,
        icon: "fa-stairs",
        titleKey: "BESTIARY.Guide.StepGm3Title",
        bodyKey: "BESTIARY.Guide.StepGm3Body",
        action: "openTierSettings",
        actionIcon: "fa-stairs",
        actionLabelKey: "BESTIARY.Settings.TierMenuLabel",
      },
      {
        step: 4,
        icon: "fa-table-cells",
        titleKey: "BESTIARY.Guide.StepGm4Title",
        bodyKey: "BESTIARY.Guide.StepGm4Body",
        action: "openKnowledgeBoard",
        actionIcon: "fa-table-cells",
        actionLabelKey: "BESTIARY.Board.Title",
      },
    ];
  }

  return [
    {
      step: 1,
      icon: "fa-book-open",
      titleKey: "BESTIARY.Guide.StepPlayer1Title",
      bodyKey: "BESTIARY.Guide.StepPlayer1Body",
      action: null,
    },
    {
      step: 2,
      icon: "fa-dice-d20",
      titleKey: "BESTIARY.Guide.StepPlayer2Title",
      bodyKey: "BESTIARY.Guide.StepPlayer2Body",
      action: null,
    },
    {
      step: 3,
      icon: "fa-share-nodes",
      titleKey: "BESTIARY.Guide.StepPlayer3Title",
      bodyKey: "BESTIARY.Guide.StepPlayer3Body",
      action: null,
    },
    {
      step: 4,
      icon: "fa-comments",
      titleKey: "BESTIARY.Guide.StepPlayer4Title",
      bodyKey: "BESTIARY.Guide.StepPlayer4Body",
      action: null,
    },
  ];
}

export function buildGmFeatures() {
  return [
    {
      icon: "fa-wand-magic-sparkles",
      titleKey: "BESTIARY.Guide.GmCardPopulateTitle",
      bodyKey: "BESTIARY.Guide.GmCardPopulateBody",
      action: null,
    },
    {
      icon: "fa-stairs",
      titleKey: "BESTIARY.Guide.GmCardCustomTiersTitle",
      bodyKey: "BESTIARY.Guide.GmCardCustomTiersBody",
      action: "openTierSettings",
      actionIcon: "fa-stairs",
      actionLabelKey: "BESTIARY.Settings.TierMenuLabel",
    },
    {
      icon: "fa-eye-slash",
      titleKey: "BESTIARY.Guide.GmCardGranularTitle",
      bodyKey: "BESTIARY.Guide.GmCardGranularBody",
      action: null,
    },
    {
      icon: "fa-user-secret",
      titleKey: "BESTIARY.Guide.GmCardPreviewTitle",
      bodyKey: "BESTIARY.Guide.GmCardPreviewBody",
      action: null,
    },
    {
      icon: "fa-shield-halved",
      titleKey: "BESTIARY.Guide.GmCardEncounterTitle",
      bodyKey: "BESTIARY.Guide.GmCardEncounterBody",
      action: "openModuleSettings",
      actionIcon: "fa-gear",
      actionLabelKey: "BESTIARY.Guide.OpenModuleSettings",
    },
    {
      icon: "fa-table-cells",
      titleKey: "BESTIARY.Guide.GmCardBoardTitle",
      bodyKey: "BESTIARY.Guide.GmCardBoardBody",
      action: "openKnowledgeBoard",
      actionIcon: "fa-table-cells",
      actionLabelKey: "BESTIARY.Board.Title",
    },
    {
      icon: "fa-sliders",
      titleKey: "BESTIARY.Guide.GmCardBulkResearchTitle",
      bodyKey: "BESTIARY.Guide.GmCardBulkResearchBody",
      action: null,
    },
    {
      icon: "fa-file-export",
      titleKey: "BESTIARY.Guide.GmCardTransferTitle",
      bodyKey: "BESTIARY.Guide.GmCardTransferBody",
      action: "importSnapshot",
      actionIcon: "fa-file-import",
      actionLabelKey: "BESTIARY.Transfer.Import",
    },
  ];
}

export function buildResearchGuideCards({ isGM = false } = {}) {
  return [
    {
      icon: "fa-dice-d20",
      titleKey: "BESTIARY.Guide.ResearchCardRollTitle",
      bodyKey: isGM ? "BESTIARY.Guide.ResearchCardRollBodyGm" : "BESTIARY.Guide.ResearchCardRollBodyPlayer",
    },
    {
      icon: "fa-share-nodes",
      titleKey: "BESTIARY.Guide.ResearchCardShareTitle",
      bodyKey: "BESTIARY.Guide.ResearchCardShareBody",
    },
    {
      icon: "fa-user-lock",
      titleKey: "BESTIARY.Guide.ResearchCardNotesTitle",
      bodyKey: "BESTIARY.Guide.ResearchCardNotesBody",
    },
    {
      icon: "fa-thumbtack",
      titleKey: "BESTIARY.Guide.ResearchCardFeedTitle",
      bodyKey: "BESTIARY.Guide.ResearchCardFeedBody",
    },
  ];
}

export function buildShortcutCards({ keyHint = "Shift + B", isGM = false } = {}) {
  const cards = [
    {
      icon: "fa-keyboard",
      badge: keyHint || "Shift + B",
      titleKey: "BESTIARY.Guide.ShortcutOpenTitle",
      bodyKey: "BESTIARY.Guide.ShortcutOpenBody",
    },
    {
      icon: "fa-magnifying-glass",
      badge: "/ · Esc",
      titleKey: "BESTIARY.Guide.ShortcutSearchTitle",
      bodyKey: "BESTIARY.Guide.ShortcutSearchBody",
    },
    {
      icon: "fa-comment-dots",
      badge: "@Bestiary",
      titleKey: "BESTIARY.Guide.ShortcutChatLinkTitle",
      bodyKey: "BESTIARY.Guide.ShortcutChatLinkBody",
    },
    {
      icon: "fa-palette",
      badge: null,
      titleKey: "BESTIARY.Guide.ShortcutLookTitle",
      bodyKey: "BESTIARY.Guide.ShortcutLookBody",
    },
  ];
  if (isGM) {
    cards.push({
      icon: "fa-code",
      badge: "game.bestiaryJournal",
      titleKey: "BESTIARY.Guide.ShortcutApiTitle",
      bodyKey: "BESTIARY.Guide.ShortcutApiBody",
    });
  }
  return cards;
}
