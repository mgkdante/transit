// $lib/components/layout — responsive grids and page-shell recipes.
//
// Single import surface for the layout shells:
//   import { DashboardGrid, RailLayout } from '$lib/components/layout';
//
// The responsive recipes are snippet-prop based (Svelte 5 runes) and CSS-only,
// so they stay SSR-correct without media-query JS. They own layout only — no
// data marks or overlay chrome — and compose with brand/ui primitives.
//
//   DashboardGrid      — auto-fit KPI tile field (repeat(auto-fit, minmax(...))).
//   RailLayout         — sticky-rail body grid (minmax(13rem,17rem) | 1fr at lg,
//                        single column below; rail sticky at top:5.5rem).
//   ControlsRail       — bordered mono-labelled control panel that collects a
//                        surface's pickers + filter chips into one zone.
//   ArticleSectionStack — shared independent-card rhythm for article disclosures.

export { default as DashboardGrid } from './DashboardGrid.svelte';
export { default as RailLayout } from './RailLayout.svelte';
export { default as ControlsRail } from './ControlsRail.svelte';

export { default as Surface } from './Surface.svelte';

export { default as DetailShell } from './DetailShell.svelte';
export type { DetailShellCombinedRailConfig, DetailShellProps } from './DetailShell.svelte';
export { default as ReliabilityRailLayout } from './ReliabilityRailLayout.svelte';
export type { ReliabilityRailLayoutProps } from './ReliabilityRailLayout.svelte';
export { default as ArticleHeader } from './ArticleHeader.svelte';
export type { ArticleHeaderProps, ArticleMetaEntry } from './ArticleHeader.svelte';
export { articleCopy, type ArticleCopy, type ArticleCopyOptions } from './articleCopy';
export { default as ArticleSectionStack } from './ArticleSectionStack.svelte';
export type { ArticleSectionStackProps } from './ArticleSectionStack.svelte';
export { default as ArticleSummaryLane } from './ArticleSummaryLane.svelte';
export type { ArticleSummaryLaneProps } from './ArticleSummaryLane.svelte';
export { default as BlueprintListingHeader } from './BlueprintListingHeader.svelte';
export type { BlueprintListingHeaderProps } from './BlueprintListingHeader.svelte';
export { default as ListingHeaderStats } from './ListingHeaderStats.svelte';
export type { ListingHeaderStat, ListingHeaderStatsProps } from './ListingHeaderStats.svelte';
export { default as ListingPageShell } from './ListingPageShell.svelte';
export type { ListingPageShellProps } from './ListingPageShell.svelte';

export { default as Footer } from './Footer.svelte';
