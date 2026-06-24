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

// KPI-card family (slice-S3): headline metric cards on the doctrine's KPI spine —
// value = wayfinding voice (via brand/MetricDisplay), signage on the delta only.
export { default as DeltaStat } from './DeltaStat.svelte';
export type { DeltaStatProps } from './DeltaStat.svelte';

export { default as KpiCard } from './KpiCard.svelte';
export type { KpiCardProps } from './KpiCard.svelte';

export { default as BulletKpi } from './BulletKpi.svelte';
export type { BulletKpiProps } from './BulletKpi.svelte';

// Wide two-column "explained" metric card (slice-S6): col1 = (i) + label + value
// (via brand/MetricDisplay), col2 = an always-visible plain-language explanation.
export { default as ExplainedMetricCard } from './ExplainedMetricCard.svelte';
export type { ExplainedMetricCardProps } from './ExplainedMetricCard.svelte';

// Distribution / deviation / discrete-outcome marks (slice-S3).
export { default as StripPlot } from './StripPlot.svelte';
export type { StripPlotProps, StripPlotRow } from './StripPlot.svelte';

export { default as DivergingBar } from './DivergingBar.svelte';
export type { DivergingBarProps } from './DivergingBar.svelte';

// Service-span first→last departure timeline (slice-S7 P3): a horizontal bar on a
// FIXED 24h domain + signed first/last-trip punctuality markers on DELAY_STOP_DOMAIN.
export { default as ServiceSpanTimeline } from './ServiceSpanTimeline.svelte';
export type { ServiceSpanTimelineProps } from './ServiceSpanTimeline.svelte';

export { default as IconArray } from './IconArray.svelte';
export type { IconArrayProps, IconArraySegment } from './IconArray.svelte';

export { default as ChartTooltip } from './ChartTooltip.svelte';
export type { ChartTooltipProps } from './ChartTooltip.svelte';

export { default as ChartReadout } from './ChartReadout.svelte';
export type { ChartReadoutProps } from './ChartReadout.svelte';

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
