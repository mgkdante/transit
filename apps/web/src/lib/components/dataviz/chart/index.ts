export { default as Chart } from './Chart.svelte';

export { chartDatumPopoverBoundary, createChartDatumPopover } from './useChartDatumPopover.svelte';
export type { ChartDatumPopoverModel } from './useChartDatumPopover.svelte';

export { default as ScrollFrame } from './ScrollFrame.svelte';

export type {
	AbsoluteDomain,
	ChartSpec,
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
	HistogramSpec,
	HistogramBin,
	StackedShareSpec,
	HeatmapSpec,
	ServiceSpanSpec,
	ServiceSpanTick,
	AbsenceSpec,
} from './ChartSpec';
