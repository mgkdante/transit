// Data-viz kit barrel — SVG-based, lightweight, no chart library.
//
// DOCTRINE: every component in this kit encodes DATA exclusively with the
// dataviz scale (var(--dataviz-status-*|occupancy-*|severity-*|heatmap-*|
// vehicle-*)). Orange --primary is INTERACTIVE-ONLY and never colours a data
// mark — the single carve-out is Distribution's p50 median AFFORDANCE MARKER
// line. All status marks are glyph + colour (never colour alone).
//
// Import from `$lib/components/dataviz`.

export { default as StatusBadge } from './StatusBadge.svelte';
export type { StatusBadgeProps } from './StatusBadge.svelte';

export { default as Sparkline } from './Sparkline.svelte';
export type { SparklineProps } from './Sparkline.svelte';

export { default as TrendLine } from './TrendLine.svelte';
export type { TrendLineProps } from './TrendLine.svelte';

export { default as Distribution } from './Distribution.svelte';
export type { DistributionProps, DistributionStats } from './Distribution.svelte';

export { default as Heatmap } from './Heatmap.svelte';
export type { HeatmapProps } from './Heatmap.svelte';

export { default as RankedRow } from './RankedRow.svelte';
export type { RankedRowProps } from './RankedRow.svelte';

export { default as SeverityBar } from './SeverityBar.svelte';
export type { SeverityBarProps } from './SeverityBar.svelte';

export { default as StackedBar } from './StackedBar.svelte';
export type { StackedBarProps, StackedSegment } from './StackedBar.svelte';

export { default as ChartTooltip } from './ChartTooltip.svelte';
export type { ChartTooltipProps } from './ChartTooltip.svelte';

export { default as ChartLegend } from './ChartLegend.svelte';
export type { ChartLegendProps, ChartLegendItem } from './ChartLegend.svelte';

// Per-chart tooltip controller (rune factory) + its row/side/args types.
export { createChartTooltip } from './useChartTooltip.svelte';
export type {
	ChartAxis,
	ChartTooltipController,
	ChartTooltipRow,
	ChartTooltipShowArgs,
	ChartTooltipSide,
} from './useChartTooltip.svelte';

// Internal token + glyph helpers (re-exported for consumers building bespoke
// marks that must stay on the dataviz scale).
export {
	tokenSuffix,
	statusVar,
	occupancyVar,
	severityVar,
	heatmapColor,
	STATUS_GLYPH,
	OCCUPANCY_GLYPH,
	OCCUPANCY_NODATA_GLYPH,
	occupancyGlyph,
	STOP_GLYPH,
	HEATMAP_RAMP,
	HEATMAP_NODATA,
} from './tokens';
