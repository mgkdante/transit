// $lib/components/layout — the four responsive grid recipes.
//
// Single import surface for the layout shells:
//   import { MissionControlGrid, DashboardGrid } from '$lib/components/layout';
//
// Each is snippet-prop based (Svelte 5 runes) and CSS-only responsive against
// the documented lg breakpoint (min-width:1024px), so all four are SSR-correct
// with no media-query JS. They own LAYOUT only — no data marks, no overlay
// chrome — and compose with brand/ui primitives.
//
//   MissionControlGrid — 60 / 300 / 1fr / 360 ops console → single col + detail
//                        bottom-sheet below lg.
//   DashboardGrid      — auto-fit KPI tile field (repeat(auto-fit, minmax(...))).
//   ListDetailGrid     — master/detail two-pane; stacks on mobile.
//   EdgeStateGrid      — fixed three-up triptych; stacks on mobile.
//   RailLayout         — sticky-rail body grid (minmax(13rem,17rem) | 1fr at lg,
//                        single column below; rail sticky at top:5.5rem).
//   ControlsRail       — bordered mono-labelled control panel that collects a
//                        surface's pickers + filter chips into one zone.

export { default as MissionControlGrid } from './MissionControlGrid.svelte';
export { default as DashboardGrid } from './DashboardGrid.svelte';
export { default as ListDetailGrid } from './ListDetailGrid.svelte';
export { default as EdgeStateGrid } from './EdgeStateGrid.svelte';
export { default as RailLayout } from './RailLayout.svelte';
export { default as ControlsRail } from './ControlsRail.svelte';

export { default as Surface } from './Surface.svelte';

export { default as Footer } from './Footer.svelte';
