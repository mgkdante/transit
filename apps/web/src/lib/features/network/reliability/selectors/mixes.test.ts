import { describe, it, expect } from 'vitest';
import { selectStatusMix } from './statusMix';
import { selectOccupancyMix } from './occupancyMix';
import { selectOccupancyTrend } from './occupancyTrend';
import { selectHeadlineKpis } from './headlineKpis';
import type { StatusDist, OccupancyMix } from '$lib/v1/schemas';
import type { NetworkFile, OccupancyCode, TrendPoint } from '$lib/v1';

const statusLabel = (c: string) => `S:${c}`;
const occLabel = (c: OccupancyCode) => `O:${c}`;

describe('selectStatusMix', () => {
	it('maps the 5 codes by count, null when no dist', () => {
		const dist = { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 } as StatusDist;
		const segs = selectStatusMix(dist, statusLabel);
		expect(segs).toHaveLength(5);
		expect(segs.find((s) => s.code === 'on_time')?.value).toBe(8);
		expect(selectStatusMix(null, statusLabel).every((s) => s.value == null)).toBe(true);
	});
});

describe('selectOccupancyMix', () => {
	it('stands down (hasOccupancy false) on a null mix — never a fabricated even split', () => {
		const vm = selectOccupancyMix(null, occLabel);
		expect(vm.hasOccupancy).toBe(false);
		expect(vm.segments.every((s) => s.value == null)).toBe(true);
	});
	it('carries the 5 band fractions when telemetry exists', () => {
		const mix = {
			empty: 0.1,
			many_seats: 0.4,
			few_seats: 0.3,
			standing: 0.15,
			full: 0.05,
		} as unknown as OccupancyMix;
		const vm = selectOccupancyMix(mix, occLabel);
		expect(vm.hasOccupancy).toBe(true);
		expect(vm.segments).toHaveLength(5);
	});
});

describe('selectOccupancyTrend', () => {
	it('SKIPS days with no telemetry (never an even split)', () => {
		const points: TrendPoint[] = [
			{ date: '2026-06-14', occupancy_mix: null },
			{
				date: '2026-06-15',
				occupancy_mix: {
					empty: 0.1,
					many_seats: 0.4,
					few_seats: 0.3,
					standing: 0.15,
					full: 0.05,
				} as unknown as OccupancyMix,
			},
		];
		const days = selectOccupancyTrend(points, (d) => `L:${d}`, occLabel);
		expect(days).toHaveLength(1);
		expect(days[0].date).toBe('2026-06-15');
		expect(days[0].dateLabel).toBe('L:2026-06-15');
	});
});

describe('selectHeadlineKpis', () => {
	const labels = {
		onTime: 'On-time',
		coverage: 'Coverage',
		delayP50: 'Median delay',
		delayP90: 'Slowest 10%',
		vehicles: 'Vehicles in service',
		notReporting: 'Not reporting',
		pctOrNull: (v: number | null) => (v == null ? null : `${v}%`),
		minOrNull: (v: number | null) => (v == null ? null : `${v} min`),
		fmtCount: (v: number) => String(v),
	};
	const net = {
		vehicles_in_service: 10,
		on_time_pct: 80,
		coverage_pct: 95,
		delay_p50_min: 1,
		delay_p90_min: null,
		non_responding: 3,
	} as NetworkFile;

	it('produces FOUR glance cards (otp/coverage/p50/p90) with the not-reported absence reason', () => {
		const vm = selectHeadlineKpis(net, labels);
		expect(vm.headline).toHaveLength(4);
		expect(vm.headline.map((c) => c.key)).toEqual(['otp', 'coverage', 'p50p90', 'p50p90']);
		expect(vm.headline.every((c) => c.absentReason === 'not-reported')).toBe(true);
		// p90 is null this cycle → the card value is null (renders the styled chip).
		expect(vm.headline[3].value).toBeNull();
	});

	it('moves vehicles + non_responding into the reporting row as required ints (no absence reason)', () => {
		const vm = selectHeadlineKpis(net, labels);
		expect(vm.reporting).toHaveLength(2);
		expect(vm.reporting[0]).toMatchObject({ value: '10', key: 'vehicleCount' });
		expect(vm.reporting[1]).toMatchObject({ value: '3', key: 'silentTrip' });
		expect(vm.reporting.every((c) => c.absentReason === undefined)).toBe(true);
	});
});
