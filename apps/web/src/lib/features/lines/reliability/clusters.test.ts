// clusters.test.ts — the pure mapper's contract:
//   1. an empty contract → every VM `isEmpty`, strip empty, no throw.
//   2. a populated fixture → correct selection (selected-grain strip, busiest-
//      direction CoV, most-recent ramp-in rates) + ramp-in flags set.
//   3. sparse / all-null fields never crash and resolve to honest empties.

import { describe, expect, it } from 'vitest';
import type { RouteReliability, IsoUtc } from '$lib/v1';
import { toReliabilityClusters } from './clusters';

/** Brand a plain string as the IsoUtc the contract requires (matches the codebase fixture idiom). */
const utc = (value: string): IsoUtc => value as IsoUtc;

const empty: RouteReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '161',
};

describe('toReliabilityClusters — empty contract', () => {
	const c = toReliabilityClusters(empty);

	it('flags every VM isEmpty', () => {
		expect(c.strip.isEmpty).toBe(true);
		expect(c.punctuality.isEmpty).toBe(true);
		expect(c.waitRegularity.isEmpty).toBe(true);
		expect(c.serviceDelivered.isEmpty).toBe(true);
		expect(c.crowding.isEmpty).toBe(true);
		expect(c.habits.isEmpty).toBe(true);
	});

	it('nulls every strip headline', () => {
		expect(c.strip.otpPct).toBeNull();
		expect(c.strip.avgDelayMin).toBeNull();
		expect(c.strip.p90Min).toBeNull();
		expect(c.strip.headwayRegularityCov).toBeNull();
		expect(c.strip.cancellationRatePct).toBeNull();
		expect(c.strip.skippedStopRatePct).toBeNull();
	});

	it('crowding mix is null and habits matrix empty', () => {
		expect(c.crowding.mix).toBeNull();
		expect(c.habits.matrix).toEqual([]);
		expect(c.habits.scale).toBeNull();
	});

	it('keeps ramp-in / per-metric flags even when empty', () => {
		expect(c.serviceDelivered.isRampIn).toBe(true);
		expect(c.strip.perMetric.cancellationRatePct).toBe(true);
		expect(c.strip.perMetric.skippedStopRatePct).toBe(true);
	});
});

const populated: RouteReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '161',
	periods: [
		{ grain: 'week', otp_pct: 71, avg_delay_min: 3.2, p50_min: 1.0, p90_min: 8.4, severe_pct: 4 },
		{ grain: 'day', otp_pct: 82, avg_delay_min: 2.1, p50_min: 0.5, p90_min: 6.0, severe_pct: 3 },
		{ grain: 'month', otp_pct: 68, avg_delay_min: 3.9, p50_min: 1.2, p90_min: 9.1, severe_pct: 5 },
	],
	headway: [
		// First row has no CoV; the busiest-direction regularity row carries it.
		{ shift: 'am_peak', scheduled_min: 6, observed_min: 7.2, excess_wait_min: 1.1 },
		{ shift: 'am_peak_dir0', scheduled_min: 6, observed_min: 7.4, cov: 0.42, bunched_pct: 12 },
	],
	service_spans: [
		{ date: '2026-06-17', service_span_min: 1180, first_trip_delay_min: 0.4, trip_count: 240 },
		{ date: '2026-06-18', service_span_min: 1185, last_trip_delay_min: 1.2, trip_count: 244 },
	],
	cancellations: [
		{ grain: 'day', date: '2026-06-16', cancellation_rate_pct: 1.5, canceled_trip_days: 3 },
		{ grain: 'day', date: '2026-06-17', cancellation_rate_pct: 2.4, canceled_trip_days: 6 },
		// most-recent row carries no rate → mapper falls back to the prior row.
		{ grain: 'day', date: '2026-06-18', canceled_trip_days: 0, total_trip_days: 240 },
	],
	skipped_stops: [
		{ date: '2026-06-17', skipped_stop_rate_pct: 0.8, skipped_stop_count: 12 },
		{ date: '2026-06-18', skipped_stop_rate_pct: 1.1, skipped_stop_count: 17 },
	],
	occupancy_mix: { empty: 0.1, many_seats: 0.4, few_seats: 0.3, standing: 0.15, full: 0.05 },
	habits: {
		scale: 'repeat_problem_relative',
		matrix: [
			[null, 0.2, 0.5],
			[0.1, null, 0.9],
		],
	},
	day_of_week: [
		// Out of ISO order on purpose — the mapper must sort Mon→Sun.
		{ day_of_week_iso: 3, avg_delay_min: 2.5, observation_count: 90 },
		{ day_of_week_iso: 1, avg_delay_min: 1.8, observation_count: 100 },
	],
	weak_stops: [
		{ id: 'S1', name: 'Côte-des-Neiges', avg_delay_min: 4.2 },
		{ id: 'S2', name: 'Van Horne' }, // no delay → filtered out
	],
};

describe('toReliabilityClusters — populated fixture', () => {
	it('selects the requested grain for the strip (default day)', () => {
		const c = toReliabilityClusters(populated);
		expect(c.strip.grain).toBe('day');
		expect(c.strip.otpPct).toBe(82);
		expect(c.strip.avgDelayMin).toBe(2.1);
		expect(c.strip.p90Min).toBe(6.0);
		expect(c.strip.isEmpty).toBe(false);
	});

	it('honours an explicit grain option', () => {
		const c = toReliabilityClusters(populated, { grain: 'month' });
		expect(c.strip.grain).toBe('month');
		expect(c.strip.otpPct).toBe(68);
		expect(c.strip.p90Min).toBe(9.1);
	});

	it('falls back to the first period when the grain is absent', () => {
		const c = toReliabilityClusters(populated, { grain: 'year' });
		expect(c.strip.otpPct).toBe(71); // first period (week)
	});

	it('pulls the busiest-direction CoV (first row carrying cov)', () => {
		const c = toReliabilityClusters(populated);
		expect(c.strip.headwayRegularityCov).toBe(0.42);
	});

	it('takes the most-recent ramp-in rates (skipping a null-rate tail row)', () => {
		const c = toReliabilityClusters(populated);
		expect(c.strip.cancellationRatePct).toBe(2.4); // 06-18 had no rate → 06-17
		expect(c.strip.skippedStopRatePct).toBe(1.1);
	});

	it('marks ramp-in metrics on the strip + service cluster', () => {
		const c = toReliabilityClusters(populated);
		expect(c.strip.perMetric.cancellationRatePct).toBe(true);
		expect(c.strip.perMetric.skippedStopRatePct).toBe(true);
		expect(c.serviceDelivered.isRampIn).toBe(true);
		expect(c.serviceDelivered.isEmpty).toBe(false);
	});

	it('sorts day-of-week Mon→Sun and drops signalless weekday rows', () => {
		const c = toReliabilityClusters(populated);
		expect(c.punctuality.dayOfWeek.map((d) => d.day_of_week_iso)).toEqual([1, 3]);
	});

	it('drops weak stops without a delay value', () => {
		const c = toReliabilityClusters(populated);
		expect(c.punctuality.weakStops.map((w) => w.id)).toEqual(['S1']);
	});

	it('passes occupancy mix through when shares are present', () => {
		const c = toReliabilityClusters(populated);
		expect(c.crowding.isEmpty).toBe(false);
		expect(c.crowding.mix?.many_seats).toBe(0.4);
	});

	it('keeps the habits matrix verbatim (null cells preserved)', () => {
		const c = toReliabilityClusters(populated);
		expect(c.habits.isEmpty).toBe(false);
		expect(c.habits.scale).toBe('repeat_problem_relative');
		expect(c.habits.matrix[0][0]).toBeNull();
		expect(c.habits.matrix[1][2]).toBe(0.9);
	});

	it('keeps only signal-carrying headway / span / cancellation / skipped rows', () => {
		const c = toReliabilityClusters(populated);
		expect(c.waitRegularity.headway).toHaveLength(2);
		expect(c.serviceDelivered.serviceSpans).toHaveLength(2);
		expect(c.serviceDelivered.cancellations).toHaveLength(3);
		expect(c.serviceDelivered.skippedStops).toHaveLength(2);
	});
});

describe('toReliabilityClusters — null fields never crash', () => {
	it('treats a zeroed occupancy mix as empty (no fake bar)', () => {
		const c = toReliabilityClusters({
			...empty,
			occupancy_mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 0 },
		});
		expect(c.crowding.isEmpty).toBe(true);
		expect(c.crowding.mix).toBeNull();
	});

	it('treats an explicit null occupancy mix as empty', () => {
		const c = toReliabilityClusters({ ...empty, occupancy_mix: null });
		expect(c.crowding.isEmpty).toBe(true);
	});

	it('treats an all-null habits matrix as empty but keeps the scale', () => {
		const c = toReliabilityClusters({
			...empty,
			habits: {
				scale: 'repeat_problem_relative',
				matrix: [
					[null, null],
					[null, null],
				],
			},
		});
		expect(c.habits.isEmpty).toBe(true);
		expect(c.habits.scale).toBe('repeat_problem_relative');
	});

	it('drops signalless periods, headway, spans and ramp-in rows', () => {
		const c = toReliabilityClusters({
			...empty,
			periods: [{ grain: 'day' }],
			headway: [{ shift: 'am_peak' }],
			service_spans: [{ date: '2026-06-18' }],
			cancellations: [{ grain: 'day', date: '2026-06-18' }],
			skipped_stops: [{ date: '2026-06-18' }],
			day_of_week: [{ day_of_week_iso: 1 }],
			weak_stops: [{ id: 'S1' }],
		});
		expect(c.punctuality.isEmpty).toBe(true);
		expect(c.waitRegularity.isEmpty).toBe(true);
		expect(c.serviceDelivered.isEmpty).toBe(true);
		expect(c.strip.isEmpty).toBe(true);
	});

	it('does not throw when habits is present but matrix is undefined', () => {
		const c = toReliabilityClusters({
			...empty,
			habits: { scale: 'repeat_problem_relative' },
		});
		expect(c.habits.isEmpty).toBe(true);
		expect(c.habits.matrix).toEqual([]);
	});
});
