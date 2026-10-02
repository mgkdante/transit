import type { AbsenceReasonKey } from '$lib/site/absence';
import type { Locale } from '$lib/i18n/config';
import type { OccupancyCode, SeverityCode, StatusCode } from '$lib/v1/schemas';
import type { ChartDatumPopoverModel } from './useChartDatumPopover.svelte';

export type AbsoluteDomain = readonly [number, number];

export type ChartKind =
	| 'magnitude-bars'
	| 'dot-strip'
	| 'dumbbell'
	| 'line'
	| 'trend'
	| 'sparkline'
	| 'cycle'
	| 'histogram'
	| 'bullet'
	| 'metric'
	| 'stacked-share'
	| 'heatmap'
	| 'service-span'
	| 'absence';

export type ChartViewportLayout = 'fluid' | 'dense' | 'self-managed' | 'none';

export interface ChartViewportPolicy {
	readonly layout: ChartViewportLayout;
	readonly mobileMinWidth?: string;
}

const FLUID_VIEWPORT = { layout: 'fluid' } as const satisfies ChartViewportPolicy;
const DENSE_VIEWPORT = {
	layout: 'dense',
	mobileMinWidth: '48rem',
} as const satisfies ChartViewportPolicy;
const SELF_MANAGED_VIEWPORT = {
	layout: 'self-managed',
} as const satisfies ChartViewportPolicy;
const NO_VIEWPORT = { layout: 'none' } as const satisfies ChartViewportPolicy;

const CHART_VIEWPORT_POLICIES = {
	'magnitude-bars': DENSE_VIEWPORT,
	'dot-strip': DENSE_VIEWPORT,
	dumbbell: DENSE_VIEWPORT,
	line: DENSE_VIEWPORT,
	trend: DENSE_VIEWPORT,
	sparkline: FLUID_VIEWPORT,
	cycle: NO_VIEWPORT,
	histogram: DENSE_VIEWPORT,
	bullet: FLUID_VIEWPORT,
	metric: NO_VIEWPORT,
	'stacked-share': FLUID_VIEWPORT,
	heatmap: SELF_MANAGED_VIEWPORT,
	'service-span': FLUID_VIEWPORT,
	absence: NO_VIEWPORT,
} as const satisfies Record<ChartKind, ChartViewportPolicy>;

export function chartViewportPolicy(kind: ChartKind): ChartViewportPolicy {
	return CHART_VIEWPORT_POLICIES[kind];
}

export const MAGNITUDE_KINDS = [
	'magnitude-bars',
	'dot-strip',
	'dumbbell',
	'line',
	'trend',
	'sparkline',
	'cycle',
	'histogram',
	'bullet',
] as const satisfies readonly ChartKind[];

export type MagnitudeKind = (typeof MAGNITUDE_KINDS)[number];

interface ChartSpecBase {
	readonly title: string;
	readonly caption?: string;
	readonly locale: Locale;
}

export interface MagnitudeDatum {
	readonly key: string;
	readonly label: string;
	readonly value: number | null;
	readonly n?: number | null;
	readonly wilsonLo?: number | null;
	readonly wilsonHi?: number | null;
	readonly severity?: SeverityCode;
	readonly status?: StatusCode;
	readonly href?: string;
	readonly tapPopover?: ChartDatumPopoverModel;
	readonly note?: string;
	readonly absentReason?: AbsenceReasonKey;
}

export interface MagnitudeBarsSpec extends ChartSpecBase {
	readonly kind: 'magnitude-bars';
	readonly mark: 'bar' | 'lollipop';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly rowLabel: string;
	readonly xLabel?: string;
	readonly rows: readonly MagnitudeDatum[];
	readonly sort: 'wilson-lower' | 'given';
	readonly scale: 'status' | 'severity' | 'occupancy';
	readonly ciLabel?: string;
}

export interface DotStripDatum {
	readonly key: string;
	readonly group: string;
	readonly value: number | null;
	readonly status?: StatusCode;
	readonly severity?: SeverityCode;
	readonly n?: number | null;
	readonly absentReason?: AbsenceReasonKey;
}

export interface DotStripSpec extends ChartSpecBase {
	readonly kind: 'dot-strip';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly points: readonly DotStripDatum[];
	readonly medianRef?: number | null;
	readonly scale: 'status' | 'severity';
}

export interface TrendDatum {
	readonly x: number | string;
	readonly xLabel: string;
	readonly y: number | null;
	readonly y2?: number | null;
	readonly bandLo?: number | null;
	readonly bandHi?: number | null;
	readonly n?: number | null;
}

export interface TrendSpec extends ChartSpecBase {
	readonly kind: 'trend';
	readonly xScale: 'time' | 'band';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly label: string;
	readonly colorVar?: string;
	readonly points: readonly TrendDatum[];
	readonly hasBand: boolean;
	readonly target?: number | null;
	readonly secondary?: {
		readonly domain: AbsoluteDomain;
		readonly unit: string;
		readonly label: string;
	};
	readonly minPointsForLine: number;
	readonly minN: number;
}

export interface SparklineSpec extends ChartSpecBase {
	readonly kind: 'sparkline';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly label: string;
	readonly values: readonly (number | null)[];
	readonly xLabels?: readonly string[];
	readonly colorVar?: string;
	readonly showLast?: boolean;
	readonly width?: number | '100%';
	readonly height?: number;
}

export interface CyclePanelSpec {
	readonly key: string;
	readonly label: string;
	readonly points: readonly (number | null)[];
	readonly mean: number | null;
	readonly severe?: number | null;
	readonly n?: number | null;
	readonly absentReason?: AbsenceReasonKey;
}

export interface CycleSpec extends ChartSpecBase {
	readonly kind: 'cycle';
	readonly domain: AbsoluteDomain;
	readonly severeDomain: AbsoluteDomain;
	readonly unit: string;
	readonly panels: readonly CyclePanelSpec[];
}

export interface HistogramBin {
	readonly lo: number | null;
	readonly hi: number | null;
	readonly count: number;
}

export interface HistogramSpec extends ChartSpecBase {
	readonly kind: 'histogram';
	readonly domain: AbsoluteDomain;
	readonly countDomain: AbsoluteDomain;
	readonly unit: string;
	readonly xLabel?: string;
	readonly yLabel?: string;
	readonly bins: readonly HistogramBin[];
	readonly medianRef?: number | null;
	readonly p90Ref?: number | null;
}

export interface BulletSpec extends ChartSpecBase {
	readonly kind: 'bullet';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly value: number | null;
	readonly target?: number | null;
	readonly bands?: readonly number[];
	readonly n?: number | null;
	readonly absentReason?: AbsenceReasonKey;
	readonly tone?: 'good' | 'warn' | 'bad' | 'neutral';
	readonly xLabel?: string;
	readonly targetLabel?: string;
}

export interface MetricSpec extends ChartSpecBase {
	readonly kind: 'metric';
	readonly value: string | null;
	readonly label: string;
	readonly explanation?: string;
	readonly absentReason?: AbsenceReasonKey;
}

export interface ShareSegment {
	readonly key: string;
	readonly label: string;
	readonly share: number;
	readonly occupancy?: OccupancyCode;
	readonly status?: StatusCode;
	readonly glyph?: string;
	readonly href?: string;
}

export interface StackedShareSpec extends ChartSpecBase {
	readonly kind: 'stacked-share';
	readonly scale: 'status' | 'occupancy';
	readonly segments: readonly ShareSegment[];
	readonly legend?: boolean;
	readonly size?: 'sm' | 'md';
}

export interface HeatmapCell {
	readonly value: number | null;
	readonly absentReason?: AbsenceReasonKey;
}

export interface HeatmapTiers {
	readonly tierLabels: readonly string[];
	readonly noDataLabel: string;
	readonly worstGlyph?: string;
}

export interface HeatmapColTick {
	readonly index: number;
	readonly label: string;
}

export interface HeatmapSpec extends ChartSpecBase {
	readonly kind: 'heatmap';
	readonly mode: 'absolute' | 'row-relative';
	readonly domain?: AbsoluteDomain;
	readonly rowLabels: readonly string[];
	readonly colLabels: readonly string[];
	readonly cells: readonly (readonly HeatmapCell[])[];
	readonly tiers?: HeatmapTiers;
	readonly valueLabel?: string;
	readonly rowAxisLabel?: string;
	readonly colAxisLabel?: string;
	readonly fullRowLabels?: readonly string[];
	readonly colTicks?: readonly HeatmapColTick[];
}

export interface ServiceSpanTick {
	readonly min: number;
	readonly label: string;
}

export interface ServiceSpanSpec extends ChartSpecBase {
	readonly kind: 'service-span';
	readonly domain: AbsoluteDomain;
	readonly elapsedMin: number;
	readonly firstClock: string;
	readonly lastClock: string;
	readonly firstDelayMin: number | null;
	readonly lastDelayMin: number | null;
	readonly spanLabel: string | null;
	readonly tripsLabel: string | null;
	readonly firstLabel: string;
	readonly lastLabel: string;
	readonly firstDelayLabel: string;
	readonly lastDelayLabel: string;
	readonly noDataLabel: string;
	readonly hourTicks: readonly ServiceSpanTick[];
}

export interface AbsenceSpec extends ChartSpecBase {
	readonly kind: 'absence';
	readonly reason: AbsenceReasonKey;
	readonly params?: Record<string, string | number>;
	readonly variant?: 'inline' | 'block';
}

export interface DumbbellDatum {
	readonly key: string;
	readonly label: string;
	readonly scheduled: number | null;
	readonly observed: number | null;
	readonly excess?: number | null;
	readonly severity?: SeverityCode;
	readonly note?: string;
	readonly absentReason?: AbsenceReasonKey;
}

export interface DumbbellSpec extends ChartSpecBase {
	readonly kind: 'dumbbell';
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly xLabel?: string;
	readonly rows: readonly DumbbellDatum[];
	readonly scale: 'status' | 'severity' | 'occupancy';
	readonly scheduledLabel: string;
	readonly observedLabel: string;
}

export interface LineSeries {
	readonly key: string;
	readonly label: string;
	readonly points: readonly (number | null)[];
	readonly colorVar?: string;
	readonly dashed?: boolean;
	readonly area?: boolean;
}

export interface LineSpec extends ChartSpecBase {
	readonly kind: 'line';
	readonly xLabels: readonly string[];
	readonly domain: AbsoluteDomain;
	readonly unit: string;
	readonly xLabel?: string;
	readonly yLabel?: string;
	readonly series: readonly LineSeries[];
	readonly target?: number | null;
}

export type ChartSpec =
	| MagnitudeBarsSpec
	| DotStripSpec
	| DumbbellSpec
	| LineSpec
	| TrendSpec
	| SparklineSpec
	| CycleSpec
	| HistogramSpec
	| BulletSpec
	| MetricSpec
	| StackedShareSpec
	| HeatmapSpec
	| ServiceSpanSpec
	| AbsenceSpec;

export function isMagnitudeKind(kind: ChartKind): kind is MagnitudeKind {
	return (MAGNITUDE_KINDS as readonly ChartKind[]).includes(kind);
}

export function checkAbsoluteDomain(spec: ChartSpec): string | null {
	if (!isMagnitudeKind(spec.kind)) return null;
	const domain = (spec as { domain?: AbsoluteDomain }).domain;
	if (!domain || domain.length !== 2) {
		return `${spec.kind} "${spec.title}" is a magnitude mark but carries no absolute [lo,hi] domain`;
	}
	const [lo, hi] = domain;
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
		return `${spec.kind} "${spec.title}" domain has a non-finite bound [${lo}, ${hi}]`;
	}
	if (lo > hi) {
		return `${spec.kind} "${spec.title}" domain is inverted [${lo}, ${hi}]`;
	}
	if (spec.kind === 'histogram') {
		if (!(lo < 0 && hi > 0)) {
			return `histogram "${spec.title}" must straddle 0 (signed), got [${lo}, ${hi}]`;
		}
		return null;
	}
	if (lo !== 0) {
		return `${spec.kind} "${spec.title}" must be zero-based (lo === 0), got [${lo}, ${hi}]`;
	}
	return null;
}
