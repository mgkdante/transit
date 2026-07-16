import { describe, expect, it } from 'vitest';
import {
	chartViewportPolicy,
	checkAbsoluteDomain,
	isMagnitudeKind,
	MAGNITUDE_KINDS,
	type ChartSpec,
} from './ChartSpec';

// The ChartSpec invariant is the type-system enforcement of Chart Doctrine law #1:
// every cross-view MAGNITUDE mark carries an explicit absolute domain (never /max,
// never d3.extent). `checkAbsoluteDomain` is the runtime echo of that compile-time
// guarantee — it backs the spec gate (P1.3) and dev assertions. These tests lock the
// exact rule: magnitude kinds need a zero-based (or signed-anchored) [lo,hi]; the
// part-to-whole / heatmap / metric / absence kinds are exempt.

const base = { title: 't', locale: 'en' } as const;

describe('chart viewport policy', () => {
	it('keeps simple families fluid, dense families readable, and heatmaps self-managed', () => {
		for (const kind of ['sparkline', 'bullet', 'stacked-share', 'service-span'] as const) {
			expect(chartViewportPolicy(kind)).toEqual({ layout: 'fluid' });
		}

		for (const kind of [
			'trend',
			'histogram',
			'dot-strip',
			'magnitude-bars',
			'dumbbell',
			'line',
		] as const) {
			expect(chartViewportPolicy(kind)).toEqual({ layout: 'dense', mobileMinWidth: '48rem' });
		}

		expect(chartViewportPolicy('heatmap')).toEqual({ layout: 'self-managed' });
	});
});

describe('isMagnitudeKind', () => {
	it('flags exactly the cross-view magnitude kinds', () => {
		expect([...MAGNITUDE_KINDS].sort()).toEqual(
			[
				'bullet',
				'cycle',
				'dot-strip',
				'dumbbell',
				'histogram',
				'line',
				'magnitude-bars',
				'sparkline',
				'trend',
			].sort(),
		);
		for (const k of MAGNITUDE_KINDS) expect(isMagnitudeKind(k)).toBe(true);
		for (const k of ['stacked-share', 'heatmap', 'metric', 'absence'] as const) {
			expect(isMagnitudeKind(k)).toBe(false);
		}
	});
});

describe('checkAbsoluteDomain — magnitude kinds must carry a zero-based domain', () => {
	it('passes a zero-based magnitude-bars spec', () => {
		const spec: ChartSpec = {
			...base,
			kind: 'magnitude-bars',
			mark: 'lollipop',
			domain: [0, 8],
			unit: 'min',
			rowLabel: 'Stop',
			rows: [],
			sort: 'wilson-lower',
			scale: 'severity',
		};
		expect(checkAbsoluteDomain(spec)).toBeNull();
	});

	it('rejects a magnitude mark whose domain is not zero-based', () => {
		const spec: ChartSpec = {
			...base,
			kind: 'dot-strip',
			domain: [5, 100],
			unit: '%',
			points: [],
			scale: 'status',
		};
		expect(checkAbsoluteDomain(spec)).toMatch(/zero-based/);
	});

	it('rejects an inverted domain', () => {
		const spec: ChartSpec = {
			...base,
			kind: 'trend',
			xScale: 'time',
			domain: [100, 0],
			unit: '%',
			label: 'On-time',
			points: [],
			hasBand: false,
			minPointsForLine: 7,
			minN: 30,
		};
		expect(checkAbsoluteDomain(spec)).toMatch(/inverted/);
	});

	it('a magnitude kind missing a domain would be caught (defensive runtime echo)', () => {
		// The compiler already forbids this; the cast proves the runtime guard agrees.
		const spec = { ...base, kind: 'bullet', unit: '%', value: 80 } as unknown as ChartSpec;
		expect(checkAbsoluteDomain(spec)).toMatch(/no absolute/);
	});
});

describe('checkAbsoluteDomain — histogram must straddle zero (signed)', () => {
	it('passes a signed histogram domain', () => {
		const spec: ChartSpec = {
			...base,
			kind: 'histogram',
			domain: [-300, 1800],
			countDomain: [0, 20],
			unit: 'sec',
			bins: [],
		};
		expect(checkAbsoluteDomain(spec)).toBeNull();
	});

	it('rejects a histogram domain that does not straddle zero', () => {
		const spec: ChartSpec = {
			...base,
			kind: 'histogram',
			domain: [0, 1800],
			countDomain: [0, 20],
			unit: 'sec',
			bins: [],
		};
		expect(checkAbsoluteDomain(spec)).toMatch(/straddle 0/);
	});
});

describe('checkAbsoluteDomain — exempt kinds', () => {
	it('part-to-whole, heatmap, metric and absence are exempt (no domain required)', () => {
		const specs: ChartSpec[] = [
			{ ...base, kind: 'stacked-share', scale: 'occupancy', segments: [] },
			{
				...base,
				kind: 'heatmap',
				mode: 'row-relative',
				rowLabels: [],
				colLabels: [],
				cells: [],
			},
			{ ...base, kind: 'metric', value: '80%', label: 'OTP' },
			{ ...base, kind: 'absence', reason: 'no-observations' },
		];
		for (const spec of specs) expect(checkAbsoluteDomain(spec)).toBeNull();
	});
});
