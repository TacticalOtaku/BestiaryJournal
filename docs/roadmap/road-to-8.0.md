# Road to 8.0 (`BestiaryJournal 0.8.0`)

> [!NOTE]
> **Status:** Wayfinder Planning & Architecture Discovery (Pre-Implementation)
> **Live Decision Map:** [Road to 8.0: BestiaryJournal 0.8.0 Redesign, Portable Identity & Architecture Rebuild](https://github.com/TacticalOtaku/BestiaryJournal/issues/1)
> **Target Release:** `v0.8.0` on branch `road-to-8.0` (`main` stays reserved for `0.7.x` maintenance)

---

## 1. Purpose & Design Thesis

`Road to 8.0` is a clean-slate redesign and architectural rebuild of **BestiaryJournal** for **Foundry VTT v14.367+** and **dnd5e 5.3.3+**. Rather than patching legacy AIM styles and monolithic templates, the presentation layer (`ui/`, `styles/`, `templates/`) is rebuilt from zero while preserving `0.7.1` world data compatibility and strengthening the pure domain core.

Our design direction adapts **Tubik Studio's 7 UI Design Trends of 2026** into a mature, domain-authentic identity — **Editorial Tactical Dossier**:

1. **AI Collaboration, Not Automation ("Copilot in the Margins")** — Non-destructive contextual helpers and inspectors (live Player Knowledge Lens preview, research roll explanations, batch previews) that augment GM/player judgment without hijacking workflows or relying on external LLMs.
2. **Purposeful Motion, Not Decorative Animation** — Remove ornamental cursor spotlights (`.bestiary-spot`) and window entrance choreography; keep micro-motion strictly for trust feedback (research roll verdicts, GM knowledge grants, socket sync confirmation).
3. **Raw Aesthetics: Monospaced Data, Hairline Grids, Structural Honesty** — Replace rounded SaaS card-in-card boxes with open `1px` hairline structural grids, crisp `0–4px` radii, and a tri-font hierarchy (**Display Serif** for creatures/titles + **UI Sans** for readable copy + **Data Monospace** for `CR`, `DC`, `HP`, `AC`, dice formulas, and knowledge tiers).
4. **Inclusive Visuals: Less Entertainment, More Control** — Layered motion controls (`full | reduced | off`), strict OS `prefers-reduced-motion` and `forced-colors` compliance, and zero distracting visual noise.
5. **Fluid Typography (`REM + clamp()`)** — Container-query-driven fluid type and spacing tokens so resizable Foundry windows adapt seamlessly across resolutions without brittle breakpoint overrides.
6. **Crafted, Not Prompted** — Retire AIM's "Nocturne & Parchment" and generic AI-slop SaaS defaults in favor of an authored, **portable Design System Core** reusable across future TacticalOtaku Foundry modules.
7. **Anti-Liquid Glass** — Opaque, high-contrast surfaces (**Dark Graphite Ink** and **Warm Archival Paper**) that automatically follow Foundry's color scheme, with zero translucent blur competing with dense statblocks or controls.

---

## 2. Rebuild Boundaries & Technical Stack

- **Zero Heavy JS Framework:** Thin, modular patched-DOM components over Foundry `ApplicationV2` + native ES modules + modern CSS (`@layer`, `@container`, `REM + clamp()`).
- **Portable Design System Split:**
  - **Portable Design System Core:** Domain-free tokens, grid primitives, tri-font scale, opaque surface roles, controls, tables/ledgers, and motion controls.
  - **Bestiary Theme Adapter:** Maps knowledge tiers (`Unknown`, `Rumors`, `Studied`, `Mastered`, `GM Only`) and bestiary status badges onto the Core, switching automatically between **Dark Graphite Ink** and **Warm Archival Paper** via Foundry's active color scheme (no user-facing accent/theme picker clutter).
- **World State Compatibility:** Existing `0.7.1` world settings (`bestiaryData`, `bestiaryKnowledge`, JournalEntry `note-store`, `researchTiers`) migrate cleanly without data loss. Core domain rules (`GLOSSARY.md`, `ADR 0001`, `ADR 0002`) remain intact.
- **Out of Scope for `0.8.0`:** Non-`dnd5e` system adapters, Foundry `v13` and below, in-module actor/statblock editing, external LLM integrations, and module-level accent/theme override pickers.

---

## 3. Phase 0 — Wayfinder Decision Map (Active)

Implementation begins after the open design, architecture, and prototype decision tickets on the Wayfinder map resolve:

| Track | Decision / Investigation | Type | Dependencies |
| --- | --- | --- | --- |
| Typography & Tokens | [Research: Portable Typography, Color & Fluid clamp() Foundation (Cyrillic + Latin)](https://github.com/TacticalOtaku/BestiaryJournal/issues/2) | `research` | — |
| Runtime & Perf | [Research: Foundry v14 ApplicationV2 Performance, Partial DOM & Store/Artwork Bottlenecks](https://github.com/TacticalOtaku/BestiaryJournal/issues/3) | `research` | — |
| Identity System | [Decision: Portable Design System Contract, Naming & Bestiary Theme Adapter](https://github.com/TacticalOtaku/BestiaryJournal/issues/4) | `grilling` | Foundation Research |
| UX & Flows | [Decision: Consolidated Information Architecture & GM vs Player Workspace Flows](https://github.com/TacticalOtaku/BestiaryJournal/issues/5) | `grilling` | Runtime Research |
| Data & Code Structure | [Decision: Data Caching, Store Indexing & Module Decomposition Architecture](https://github.com/TacticalOtaku/BestiaryJournal/issues/6) | `grilling` | Runtime Research |
| Visual Gate | [Prototype: Interactive Editorial Tactical Dossier (Library/Inspector & Creature Dossier)](https://github.com/TacticalOtaku/BestiaryJournal/issues/7) | `prototype` | Identity System, UX & Flows |
| Execution Lock | [Decision: Finalize Road to 8.0 Staged Implementation & Migration Roadmap](https://github.com/TacticalOtaku/BestiaryJournal/issues/8) | `grilling` | Data & Code Structure, Visual Gate |

---

## 4. Planned Implementation Stages (`Draft — Locked in Final Roadmap Decision`)

> [!IMPORTANT]
> Stage boundaries, vertical-slice details, and exact exit criteria below are a draft spine and will be locked after the interactive prototype and optimization architecture decisions are approved.

### Stage 1 — Portable Design System Core & Bestiary Theme Adapter
- Standalone, domain-agnostic design system directory/package contract (`@layer`, fluid `clamp()` tokens, tri-font Cyrillic+Latin loading, hairline grid & ledger primitives, motion controls).
- Bestiary Theme Adapter with canonical **Dark Graphite Ink** and **Warm Archival Paper** presets synced automatically to Foundry's scheme.
- **Exit gate:** Automated WCAG contrast checks pass for every surface/tier token pair in both themes; zero AIM/cursor-glow leftovers.

### Stage 2 — Optimized Core, Store Indexing & Cache Spine
- Revision-memoized world snapshots and precomputed UUID/collection indices (`bestiary-store.js`, `core/`).
- Lazy/paginated creature data resolution (`creature-cache.js`, `integrations/dnd5e.js`) and streamlined artwork pipeline without eager per-card canvas baking.
- Verified `0.7.1 → 0.8.0` migration and store invariant test coverage.
- **Exit gate:** `npm run check` green; unit benchmarks/assertions verify zero full-world `resolveUuid` scans on Overview render.

### Stage 3 — Consolidated Library & Collection Workspace
- Ground-up workspace UI merging library overview, collections, filtering, and contextual inline inspector/preview (retiring legacy `section-view.js` duplication and 1,597-line template monoliths).
- Distinct GM live/prep affordances vs clean Player Field Codex mode; partial DOM updates on search/filter/sort.
- **Exit gate:** Responsive `@container` layout verified across min-width and desktop sizes in Foundry v14 without full-window flicker.

### Stage 4 — Creature Dossier, Research Rolls & Scoped Notes
- Editorial Tactical Dossier sheet with tri-font statblock hierarchy, monospace metrics, non-destructive "Preview as Player" in the margins, and purposeful research-roll/grant confirmation feedback.
- Scoped JournalEntry notes (`gm`, `party`, `private`) cleanly integrated without cramped narrow-rail tab overflow.
- **Exit gate:** Full GM & Player Knowledge Lens parity (zero leaked blocked attributes above player tier).

### Stage 5 — GM Batch Tools, Knowledge Board & World Tiers
- Rebuilt Knowledge Board matrix, Bulk Import, Bulk Research, and World Tier Settings aligned to the new ledger primitives and reduced-window topology.
- **Exit gate:** All batch actions, tier remapping, and lock guards pass automated and live Foundry tests.

### Stage 6 — External Integrations, Live Check & `v0.8.0` Release Readiness
- Updated chat cards, Actor Directory / NPC sheet / Token HUD integrations, `API.md` parity verification.
- Updated `tools/live-check.js` (verifying tri-font rendering, clipping, horizontal overflow, and accessible labels across both themes).
- Synchronized `README.md`, `README.ru.md`, `CHANGELOG.md`, `docs/architecture.md`, and `module.json` (`0.8.0`) compliant with Foundry VTT Store & AI Content Policy.
