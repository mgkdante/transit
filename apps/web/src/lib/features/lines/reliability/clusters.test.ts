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
		{
			shift: 'am_peak',
			direction_id: 0,
			day_type: 'weekday',
			scheduled_min: 6,
			observed_min: 7.4,
			cov: 0.42,
			bunched_pct: 12,
		},
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

	it('falls back to the first CALENDAR period when the grain is absent', () => {
		// The mapper partitions periods into calendar (day→week→month) groups, so
		// the first calendar period is the day row regardless of contract order.
		const c = toReliabilityClusters(populated, { grain: 'year' });
		expect(c.strip.otpPct).toBe(82); // first calendar period (day)
	});

	it('carries p50 onto the strip (daily grain)', () => {
		const c = toReliabilityClusters(populated);
		expect(c.strip.p50Min).toBe(0.5); // the day period's median delay
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

/* F1 — week/month rows arrive ASC; the strip must pick the MOST-RECENT, not the
   first (oldest). Plus the trend day-only-ascending split, peak/off-peak, and the
   selectedDate picker resolution. */
const granular: RouteReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '10',
	periods: [
		// Daily rows arrive newest→oldest in the contract; the trend must sort ASC.
		{
			grain: 'day',
			date: '2026-06-18',
			otp_pct: 84,
			avg_delay_min: 1.9,
			p50_min: 0.4,
			p90_min: 5.5,
		},
		{
			grain: 'day',
			date: '2026-06-16',
			otp_pct: 80,
			avg_delay_min: 2.4,
			p50_min: 0.6,
			p90_min: 6.4,
		},
		{
			grain: 'day',
			date: '2026-06-17',
			otp_pct: 82,
			avg_delay_min: 2.1,
			p50_min: 0.5,
			p90_min: 6.0,
		},
		// Weekly rows ASC (oldest → newest) — F1: most-recent must win.
		{ grain: 'week', date: '2026-05-25', otp_pct: 70, avg_delay_min: 3.5 },
		{ grain: 'week', date: '2026-06-15', otp_pct: 76, avg_delay_min: 2.9 },
		// Monthly rows ASC.
		{ grain: 'month', date: '2026-05-01', otp_pct: 68, avg_delay_min: 3.9 },
		{ grain: 'month', date: '2026-06-01', otp_pct: 74, avg_delay_min: 3.1 },
		// Granular grains (date:null) — the peak/off-peak source.
		{ grain: 'am_peak', otp_pct: 90, avg_delay_min: 0.7, severe_pct: 4.7 },
		{ grain: 'pm_peak', otp_pct: 75, avg_delay_min: 3.4, severe_pct: 22.6 },
		{ grain: 'midday', otp_pct: 86, avg_delay_min: 1.2, severe_pct: 6 },
		{ grain: 'weekday', otp_pct: 80, avg_delay_min: 2.4, severe_pct: 8 },
		{ grain: 'weekend', otp_pct: 88, avg_delay_min: 1.1, severe_pct: 4 },
	],
};

describe('toReliabilityClusters — F1 most-recent week/month + grain partition', () => {
	it('picks the MOST-RECENT week, not the oldest (F1)', () => {
		const c = toReliabilityClusters(granular, { grain: 'week' });
		expect(c.strip.otpPct).toBe(76); // 2026-06-15, not 2026-05-25 (70)
	});

	it('picks the MOST-RECENT month, not the oldest (F1)', () => {
		const c = toReliabilityClusters(granular, { grain: 'month' });
		expect(c.strip.otpPct).toBe(74); // 2026-06-01, not 2026-05-01 (68)
	});

	it('trend is the dated DAY-grain series only, chronological ascending', () => {
		const c = toReliabilityClusters(granular);
		expect(c.punctuality.trend.map((p) => p.date)).toEqual([
			'2026-06-16',
			'2026-06-17',
			'2026-06-18',
		]);
		// No week/month/shift/daytype rows leak into the trend.
		expect(c.punctuality.trend.every((p) => p.grain === 'day')).toBe(true);
	});

	it('partitions the granular grains into peak/off-peak (shift + day-type)', () => {
		const c = toReliabilityClusters(granular);
		expect(c.punctuality.peakOffPeak.byShift.map((r) => r.grain)).toEqual([
			'am_peak',
			'pm_peak',
			'midday',
		]);
		expect(c.punctuality.peakOffPeak.byDayType.map((r) => r.grain)).toEqual(['weekday', 'weekend']);
		expect(c.punctuality.peakOffPeak.byShift[0].severePct).toBe(4.7);
		expect(c.punctuality.peakOffPeak.isEmpty).toBe(false);
	});

	it('honours selectedDate — resolves the strip to that exact day', () => {
		const c = toReliabilityClusters(granular, { grain: 'day', selectedDate: '2026-06-16' });
		expect(c.strip.otpPct).toBe(80); // the 2026-06-16 day, not the most-recent
	});

	it('default day grain resolves to the MOST-RECENT day', () => {
		const c = toReliabilityClusters(granular, { grain: 'day' });
		expect(c.strip.otpPct).toBe(84); // 2026-06-18 (max date)
	});
});

/* (A) DATE-RANGE — the start+end window aggregates the in-range days: mean OTP +
   avg delay; percentiles null on a multi-day span, exact on a single day; the
   trend zooms to the range; an empty/out-of-window range fabricates nothing. */
describe('toReliabilityClusters — date range', () => {
	it('aggregates a multi-day range: mean OTP + avg delay, null percentiles', () => {
		// In-range days 06-16 (80) / 06-17 (82) / 06-18 (84) → mean OTP = 82.
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-16', end: '2026-06-18' },
		});
		expect(c.strip.otpPct).toBe(82); // round((80+82+84)/3)
		expect(c.strip.avgDelayMin).toBeCloseTo(2.1, 5); // (2.4+2.1+1.9)/3 → 2.1
		// Percentiles are not averageable across days → null on a multi-day range.
		expect(c.strip.p50Min).toBeNull();
		expect(c.strip.p90Min).toBeNull();
	});

	it('carries the aggregate metadata (day count + bounds) for a multi-day range', () => {
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-16', end: '2026-06-18' },
		});
		expect(c.strip.rangeAggregate).toEqual({ days: 3, start: '2026-06-16', end: '2026-06-18' });
	});

	it('zooms the trend to the in-range days only', () => {
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-16', end: '2026-06-17' },
		});
		expect(c.punctuality.trend.map((p) => p.date)).toEqual(['2026-06-16', '2026-06-17']);
	});

	it('a SINGLE-day range (start == end) keeps that day exact, including percentiles', () => {
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-17', end: '2026-06-17' },
		});
		expect(c.strip.otpPct).toBe(82);
		expect(c.strip.avgDelayMin).toBe(2.1);
		expect(c.strip.p50Min).toBe(0.5);
		expect(c.strip.p90Min).toBe(6.0);
		// One exact day is NOT an "average" → no aggregate caption metadata.
		expect(c.strip.rangeAggregate).toBeNull();
		expect(c.punctuality.trend.map((p) => p.date)).toEqual(['2026-06-17']);
	});

	it('normalises an inverted range (start > end) without inverting the window', () => {
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-18', end: '2026-06-16' },
		});
		expect(c.strip.rangeAggregate).toEqual({ days: 3, start: '2026-06-16', end: '2026-06-18' });
	});

	it('falls back to the most-recent day when no day falls inside the range', () => {
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-01-01', end: '2026-01-31' },
		});
		// No in-range day → normal day selection (most-recent), full trend, no aggregate.
		expect(c.strip.otpPct).toBe(84); // 2026-06-18
		expect(c.strip.rangeAggregate).toBeNull();
		expect(c.punctuality.trend).toHaveLength(3);
	});

	it('clips the range to the available days when it overhangs the window', () => {
		// 06-15 has no day row; the range clips to the two in-range days.
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-15', end: '2026-06-17' },
		});
		expect(c.strip.rangeAggregate).toEqual({ days: 2, start: '2026-06-16', end: '2026-06-17' });
		expect(c.strip.otpPct).toBe(81); // round((80+82)/2)
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

/* Duplicate-day dedup — the contract can emit two rows for the same local day (a
   late re-publish). The trend must draw that day ONCE and the range mean must
   count it ONCE; the last occurrence (the re-publish) wins. */
describe('toReliabilityClusters — duplicate-day dedup', () => {
	const dupDay: RouteReliability = {
		generated_utc: utc('2026-06-19T02:00:00Z'),
		id: '11',
		periods: [
			{ grain: 'day', date: '2026-06-16', otp_pct: 80, avg_delay_min: 2.0 },
			{ grain: 'day', date: '2026-06-17', otp_pct: 60, avg_delay_min: 5.0 }, // stale first write
			{ grain: 'day', date: '2026-06-17', otp_pct: 90, avg_delay_min: 1.0 }, // re-publish wins
		],
	};

	it('collapses a duplicate day in the trend (one point per date, last write wins)', () => {
		const c = toReliabilityClusters(dupDay);
		expect(c.punctuality.trend.map((p) => p.date)).toEqual(['2026-06-16', '2026-06-17']);
		expect(c.punctuality.trend.find((p) => p.date === '2026-06-17')?.otp_pct).toBe(90);
	});

	it('counts a duplicate day only ONCE in the range mean', () => {
		// 06-16 (80) + deduped 06-17 (90) → round((80+90)/2) = 85.
		// A double-count would give round((80+60+90)/3) ≈ 77.
		const c = toReliabilityClusters(dupDay, {
			grain: 'day',
			dateRange: { start: '2026-06-16', end: '2026-06-17' },
		});
		expect(c.strip.otpPct).toBe(85);
		expect(c.strip.rangeAggregate).toEqual({ days: 2, start: '2026-06-16', end: '2026-06-17' });
	});
});

describe('toReliabilityClusters — delay_by_crowding (G1)', () => {
	it('keeps the per-band delay cells verbatim on the crowding VM (signal-filtered)', () => {
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T02:00:00Z'),
			id: '11',
			delay_by_crowding: [
				{ band: 'many_seats', avg_delay_min: 1.2, p50_min: 0.4, observation_count: 50 },
				{ band: 'standing', avg_delay_min: 4.5, day_count: 7 },
				// A present-but-null band still has a non-delay signal (day_count) → kept,
				// but the band must show the no-data message for its delay downstream.
				{ band: 'full', avg_delay_min: null, day_count: 3 },
				// An all-null cell carries no signal → dropped.
				{ band: 'empty' },
			],
		};
		const c = toReliabilityClusters(data);
		expect(c.crowding.delayByCrowding.map((d) => d.band)).toEqual([
			'many_seats',
			'standing',
			'full',
		]);
		expect(c.crowding.delayByCrowding.find((d) => d.band === 'standing')?.avg_delay_min).toBe(4.5);
	});

	it('resolves to an empty delayByCrowding when the contract omits it', () => {
		const c = toReliabilityClusters({ generated_utc: utc('2026-06-19T02:00:00Z'), id: '11' });
		expect(c.crowding.delayByCrowding).toEqual([]);
	});
});

/* S7 — the §01 trend follows the SELECTED calendar grain (day/week/month), not
   always day. dayTrend dedupes-by-date + sorts ASC, so it works for any dated grain. */
describe('toReliabilityClusters — grain-aware trend (S7)', () => {
	it('default (day) trend = the dated day series, ASC', () => {
		const c = toReliabilityClusters(granular);
		expect(c.punctuality.trend.map((p) => p.date)).toEqual([
			'2026-06-16',
			'2026-06-17',
			'2026-06-18',
		]);
		expect(c.punctuality.trend.every((p) => p.grain === 'day')).toBe(true);
	});

	it('grain=week → trend is the dated WEEK series, ASC', () => {
		const c = toReliabilityClusters(granular, { grain: 'week' });
		expect(c.punctuality.trend.map((p) => p.date)).toEqual(['2026-05-25', '2026-06-15']);
		expect(c.punctuality.trend.every((p) => p.grain === 'week')).toBe(true);
	});

	it('grain=month → trend is the dated MONTH series, ASC', () => {
		const c = toReliabilityClusters(granular, { grain: 'month' });
		expect(c.punctuality.trend.map((p) => p.date)).toEqual(['2026-05-01', '2026-06-01']);
		expect(c.punctuality.trend.every((p) => p.grain === 'month')).toBe(true);
	});

	it('a date range still zooms the DAY series regardless of grain', () => {
		const c = toReliabilityClusters(granular, {
			grain: 'day',
			dateRange: { start: '2026-06-16', end: '2026-06-17' },
		});
		expect(c.punctuality.trend.map((p) => p.date)).toEqual(['2026-06-16', '2026-06-17']);
	});
});

/* S7 §04 — grain-aware crowding mix + weekday/weekend split from the new
   occupancy_by_grain / occupancy_by_dow contract fields (PR-DB). */
describe('toReliabilityClusters — occupancy_by_grain / occupancy_by_dow (S7)', () => {
	const crowdingGrains: RouteReliability = {
		generated_utc: utc('2026-06-19T02:00:00Z'),
		id: '12',
		occupancy_by_grain: [
			{ grain: 'day', mix: { empty: 0, many_seats: 1, few_seats: 0, standing: 0, full: 0 } },
			{
				grain: 'week',
				mix: { empty: 0.1, many_seats: 0.4, few_seats: 0.3, standing: 0.15, full: 0.05 },
			},
			// honest absence — a window with no band telemetry carries mix: null.
			{ grain: 'month', mix: null },
		],
		occupancy_by_dow: [
			{ day_of_week_iso: 1, mix: { empty: 0, many_seats: 0.8, few_seats: 0.2, standing: 0, full: 0 } },
			{ day_of_week_iso: 5, mix: { empty: 0, many_seats: 0.6, few_seats: 0.4, standing: 0, full: 0 } },
			{ day_of_week_iso: 6, mix: { empty: 0.5, many_seats: 0.5, few_seats: 0, standing: 0, full: 0 } },
		],
	};

	it('selects the grain-scoped mix for the requested grain', () => {
		expect(toReliabilityClusters(crowdingGrains, { grain: 'day' }).crowding.mixByGrain?.many_seats).toBe(1);
		expect(toReliabilityClusters(crowdingGrains, { grain: 'week' }).crowding.mixByGrain?.many_seats).toBe(0.4);
	});

	it('honest-null mixByGrain when the selected grain has no telemetry', () => {
		expect(toReliabilityClusters(crowdingGrains, { grain: 'month' }).crowding.mixByGrain).toBeNull();
	});

	it('aggregates weekday (ISO 1-5) and weekend (ISO 6-7) from occupancy_by_dow', () => {
		const ww = toReliabilityClusters(crowdingGrains).crowding.weekdayWeekend;
		expect(ww).not.toBeNull();
		// weekday = unweighted mean of ISO 1 + ISO 5: many_seats (0.8+0.6)/2 = 0.7, few_seats (0.2+0.4)/2 = 0.3
		expect(ww?.weekday?.many_seats).toBeCloseTo(0.7, 5);
		expect(ww?.weekday?.few_seats).toBeCloseTo(0.3, 5);
		// weekend = ISO 6 only
		expect(ww?.weekend?.empty).toBe(0.5);
	});

	it('null mixByGrain + weekdayWeekend when the fields are absent', () => {
		const c = toReliabilityClusters({ generated_utc: utc('2026-06-19T02:00:00Z'), id: '11' });
		expect(c.crowding.mixByGrain).toBeNull();
		expect(c.crowding.weekdayWeekend).toBeNull();
	});
});

describe('toReliabilityClusters — by_shift_daytype crosstab (G1)', () => {
	it('keeps the sparse crosstab cells verbatim on the punctuality VM', () => {
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T02:00:00Z'),
			id: '11',
			by_shift_daytype: [
				{ shift: 'am_peak', day_type: 'weekday', otp_pct: 88, avg_delay_min: 1.1 },
				{ shift: 'pm_peak', day_type: 'weekday', otp_pct: 74, severe_pct: 9 },
				// SPARSE: am_peak/weekend, midday/*, evening/*, night/* are simply absent.
				// An all-null cell carries no signal → dropped (not present-but-blank).
				{ shift: 'night', day_type: 'weekend' },
			],
		};
		const c = toReliabilityClusters(data);
		expect(c.punctuality.byShiftDaytype.map((x) => `${x.shift}|${x.day_type}`)).toEqual([
			'am_peak|weekday',
			'pm_peak|weekday',
		]);
		expect(c.punctuality.isEmpty).toBe(false);
	});

	it('resolves to an empty byShiftDaytype when the contract omits it', () => {
		const c = toReliabilityClusters({ generated_utc: utc('2026-06-19T02:00:00Z'), id: '11' });
		expect(c.punctuality.byShiftDaytype).toEqual([]);
	});
});
