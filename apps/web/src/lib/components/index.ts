// $lib/components — top-level component barrel.
//
// Re-exports the cross-cutting component families so a surface can pull from
// a single import root:
//
//   import { AppShell, MissionControlGrid, StatusDot, Heatmap } from '$lib/components';
//
// Each family owns its own `index.ts`; this file just composes them. The
// star-exports below are flat — every family namespaces its exports with a
// distinct component name, so there are no collisions across barrels.
//
//   brand   — metro-board brand primitives (StatusDot, MetricDisplay, …)
//   shell   — responsive app-shell chrome (AppShell, NavPill, RightPanel, …)
//   layout  — the four responsive grid recipes (MissionControlGrid, …)
//   dataviz — SVG data-viz kit + token helpers (Heatmap, TrendLine, …)
//   edge    — edge-condition primitive (EdgeState)
//   map     — MapLibre stage + null-safe basemap resolver (MapStage, …)
//
// NOTE: ui/* (shadcn-style primitives: button, card, dialog, tabs, …) is
// deliberately NOT re-exported here. Each `ui/<name>` owns its own barrel
// and is import-per-component to keep tree-shaking tight and avoid pulling
// the whole primitive set into every surface — import those directly, e.g.
//   import { Button } from '$lib/components/ui/button';

export * from './brand';
export * from './shell';
export * from './layout';
export * from './dataviz';
export * from './edge';
export * from './map';
