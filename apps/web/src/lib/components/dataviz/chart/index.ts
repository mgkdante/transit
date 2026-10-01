export { default as Chart } from './Chart.svelte';
export type { ChartProps } from './Chart.svelte';

export { default as ChartFrame } from './ChartFrame.svelte';
export type { ChartFrameProps } from './ChartFrame.svelte';

export { default as ChartViewport } from './ChartViewport.svelte';
export type { ChartViewportProps } from './ChartViewport.svelte';

export { default as ChartDatumPopover } from './ChartDatumPopover.svelte';
export type { ChartDatumPopoverProps } from './ChartDatumPopover.svelte';
export { chartDatumPopoverBoundary, createChartDatumPopover } from './useChartDatumPopover.svelte';
export type {
	ChartDatumPopoverAction,
	ChartDatumPopoverController,
	ChartDatumPopoverModel,
	ChartDatumPopoverRow,
} from './useChartDatumPopover.svelte';

export { default as ScrollFrame } from './ScrollFrame.svelte';
export type { ScrollFrameProps } from './ScrollFrame.svelte';

export { categoryGutter } from './axisGutter';
export type { CategoryGutter, CategoryGutterOpts } from './axisGutter';

export {
	MAGNITUDE_KINDS,
	isMagnitudeKind,
	checkAbsoluteDomain,
	chartViewportPolicy,
} from './ChartSpec';
export { shareSegments, stackedShareSpec } from './share';
export type { ShareInput, StackedShareSpecOptions } from './share';
export type {
	AbsoluteDomain,
	ChartKind,
	ChartViewportLayout,
	ChartViewportPolicy,
	ChartSpec,
	MagnitudeKind,
	MagnitudeBarsSpec,
	MagnitudeDatum,
	DotStripSpec,
	DotStripDatum,
	DumbbellSpec,
	DumbbellDatum,
	LineSpec,
	LineSeries,
	TrendSpec,
	TrendDatum,
	SparklineSpec,
	CycleSpec,
	CyclePanelSpec,
	HistogramSpec,
	HistogramBin,
	BulletSpec,
	MetricSpec,
	StackedShareSpec,
	ShareSegment,
	HeatmapSpec,
	HeatmapCell,
	HeatmapTiers,
	HeatmapColTick,
	ServiceSpanSpec,
	ServiceSpanTick,
	AbsenceSpec,
} from './ChartSpec';
