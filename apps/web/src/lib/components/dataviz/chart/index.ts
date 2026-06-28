// The LayerChart-backed chart layer (S7). One spec type + one renderer.
//
// A selector emits a `ChartSpec`; `<Chart spec />` renders it. The magnitude marks ride
// LayerChart on an absolute domain the SELECTOR supplies (this layer stays
// domain-agnostic, so `components/` never imports `features/`). Scoped in practice to the
// lines/reliability surface (D1) — other surfaces keep the raw-SVG dataviz primitives.

export { default as Chart } from './Chart.svelte';
export type { ChartProps } from './Chart.svelte';

export { default as ChartFrame } from './ChartFrame.svelte';
export type { ChartFrameProps } from './ChartFrame.svelte';

export { default as ScrollFrame } from './ScrollFrame.svelte';
export type { ScrollFrameProps } from './ScrollFrame.svelte';

export { MAGNITUDE_KINDS, isMagnitudeKind, checkAbsoluteDomain } from './ChartSpec';
export type {
	AbsoluteDomain,
	ChartKind,
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
