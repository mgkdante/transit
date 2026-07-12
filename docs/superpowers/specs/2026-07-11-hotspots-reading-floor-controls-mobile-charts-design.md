# Hotspots reading-floor, controls, and mobile-chart refinement

Date: 2026-07-11
Status: Implemented and operator-approved on 2026-07-12
Surface: `/hotspots` and `/fr/hotspots`

## Goal

Make the Hotspots article easier to scan and operate without changing its data contract or the approved ArticleHeader/card system. The below-floor entries become a real table, the combined rail gains independent disclosures, the time-grain control becomes a compact joined centered 2×2 matrix, and mobile charts gain room to breathe through horizontal scrolling.

## Scope

This refinement changes only Hotspots presentation plus the smallest reusable time-grain control seam needed for consistent future analytical pages. It does not change ranking math, the severe-delay domain, URL parameters, published data, the global header buttons, Metrics, Status, Repeat Offenders, or deployment state.

## Design

### Time-grain control

The Day, Week, Month, and Peak hours choices render as one cohesive joined 2×2 matrix on desktop and mobile.

- The compact matrix is centered within its available rail width, token-driven, and divided into four equal cells.
- Its inner seams are straight. Only the matrix's four outer quarters are rounded.
- The active cell uses Transit orange, primary foreground text, and restrained elevation. Inactive cells remain quiet with clear hover and focus states.
- Every segment retains a 44px minimum target, roving radio focus, arrow-key selection, disabled-state honesty, and reduced-motion behavior.
- The control does not scroll horizontally.
- English displays `Day`, `Week`, `Month`, and `Peak hours`.
- French uses the compact visible label `Pointe` for the fourth cell while preserving `Heures de pointe` as the full accessible meaning and pointer hint.
- The existing top-N control keeps its current compact default treatment. The polished four-cell layout applies only to the time-grain picker.

Implementation boundary: extend the shared `GrainPicker` with an opt-in time-grid variant and optional compact segment label. Existing callers remain unchanged unless they opt in.

### Collapsible filters and contents

The combined rail contains two independently collapsible blocks, both open by default:

1. `View controls` / `Commandes de vue`: time grain, top-N when useful, and the active-window caption.
2. `On this page` / `Sur cette page`: the existing numbered TOC and section counter.

Both blocks use the shared `CollapsibleSection` behavior, stable persistence keys, and the existing chevron/header styling. The exact header actions continue to be only `Collapse all` and `Always start collapsed` (or `Expand all` when collapsed). Collapse/Expand all also controls both rail blocks. The reader may still toggle either rail block independently between global actions.

On mobile, the existing single SurfaceRail pill and sheet remain. Opening the sheet reveals the same two collapsible blocks; no second floating button or standalone TOC pill is introduced.

### Reliable-reading-floor table

Each Lines or Stops card renders below-floor entries as a semantic table beneath the existing explanation.

Columns:

1. `Item` / `Élément`: linked name when a detail route exists, plain text otherwise.
2. `Type / ID` / `Type / ID`: localized entity type plus its stable identifier.
3. `Readings` / `Relevés`: the served observation count, right-aligned and tabular.

The table preserves the existing statement that these entries are not ranked. A missing observation count uses the shared honest no-data treatment rather than a fabricated zero.

At narrow mobile widths the table remains semantic but visually reflows each row: Item first, then labelled Type/ID and Readings values. It does not force the entire card to scroll.

Data boundary: retain `type`, `id`, and `observation_count` when mapping published tray entries into the presentation row. No new API field or derived metric is introduced.

### Mobile chart scrolling

Only the chart viewport inside the Lines and Stops cards scrolls horizontally below the mobile/tablet breakpoint.

- The chart receives a wider minimum canvas so labels, bars, intervals, and the 0-100 severe-delay axis are not compressed.
- The horizontal region is keyboard-focusable, has a localized accessible label, shows a thin scrollbar/overflow cue, and keeps vertical page scrolling intact.
- Card headers, subtitles, captions, the reliable-floor table, and all other prose remain stationary.
- At desktop widths the chart returns to normal full-width rendering with no unnecessary scrollbar.
- The chart's existing screen-reader table and linked rows remain intact.

## State and data flow

- `HotspotsBoard` continues to own grain and top-N state plus URL mirroring.
- The time-grain variant changes presentation only; selection keys and query values remain `day`, `week`, `month`, and `shift`.
- Filter and TOC disclosures persist with locale-free keys and consume the existing quiet-mode close/open signals and bulk state.
- `HotspotSection` receives the same ladder plus a richer tray row containing type, id, and observation count.
- No extra resource fetch, ranking pass, or navigation store is added.

## Accessibility and interaction

- Keep radiogroup and radio semantics, roving tabindex, arrow keys, disabled descriptions, 44px targets, and visible focus.
- Use semantic table elements with column headers and row scope.
- Keep linked item names as real anchors with the current localized accessible labels.
- The chart scroller must be reachable by keyboard and name what sideways scrolling reveals.
- Disclosures expose their existing `aria-expanded` and keyboard behavior through `CollapsibleSection`.
- Reduced motion removes decorative transitions without disabling state changes.

## Testing and verification

Follow strict red-green-refactor:

1. Add failing GrainPicker tests for the opt-in joined 2×2 time-grid variant, compact visible label, full accessible label, and unchanged default variant.
2. Add failing Hotspots tests proving Filters and TOC are independent disclosures, persist under stable keys, and follow Collapse/Expand all.
3. Add failing Hotspots/HotspotSection assertions for semantic table headers, linked Item, localized Type/ID, served Readings, and honest missing count.
4. Add failing mobile-contract assertions for a keyboard-focusable chart scroller with a wider inner canvas while desktop remains unforced.
5. Run the focused Hotspots, GrainPicker, shared disclosure, DetailShell, SurfaceRail, Metrics, and Status regression suites plus `bun run check`.
6. Run Chrome visual checks at 1512px, 768px, and 390px in English/French and light/dark. Verify the joined 2×2 matrix at every target viewport, both rail disclosures, table reflow, chart pan, focus, no page-level horizontal overflow, and parity with Metrics/Status.

## Acceptance criteria

- Four time grains remain one compact joined 2×2 matrix at every supported viewport with no control-level horizontal scrolling.
- Filters and TOC collapse independently and also follow global collapse/expand.
- Below-floor entries render as `Item | Type/ID | Readings` with real served counts.
- Mobile users can pan the graph without moving the rest of the card.
- URL, links, conditional cards, data honesty, bilingual copy, and the approved two header buttons remain unchanged.
- No push or PR occurs before the operator reviews the refreshed dev server.
