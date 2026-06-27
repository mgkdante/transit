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
		// grain='week' windows §03 to the last 7 days, which spans the whole 06-16..06-18
		// fixture — so this isolates the SIGNAL filtering from the grain windowing below.
		const c = toReliabilityClusters(populated, { grain: 'week' });
		expect(c.waitRegularity.headway).toHaveLength(2);
		expect(c.serviceDelivered.serviceSpans).toHaveLength(2);
		expect(c.serviceDelivered.cancellations).toHaveLength(3);
		expect(c.serviceDelivered.skippedStops).toHaveLength(2);
	});

	it('windows §03 service-delivered to the grain the rail selects (S7 backbone)', () => {
		// day grain → only the LATEST dated row of each ramp-in history survives, so the
		// section RESPONDS to the filter (was: always the full ~30-day history).
		const day = toReliabilityClusters(populated, { grain: 'day' });
		expect(day.serviceDelivered.cancellations).toHaveLength(1);
		expect(day.serviceDelivered.cancellations[0].date).toBe('2026-06-18');
		expect(day.serviceDelivered.skippedStops).toHaveLength(1);
		expect(day.serviceDelivered.serviceSpans).toHaveLength(1);
		// week grain → the last 7 days spans the whole 3-day fixture → all rows return.
		expect(
			toReliabilityClusters(populated, { grain: 'week' }).serviceDelivered.cancellations,
		).toHaveLength(3);
		// an explicit date range narrows it to the rows inside [start, end].
		const ranged = toReliabilityClusters(populated, {
			grain: 'day',
			dateRange: { start: '2026-06-17', end: '2026-06-18' },
		});
		expect(ranged.serviceDelivered.cancellations).toHaveLength(2);
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

	it('grain=week → the DAILY series WINDOWED to the last 7 days (folded daily detail, S7)', () => {
		const c = toReliabilityClusters(granular, { grain: 'week' });
		// The daily span (06-16..06-18) is inside the last 7 days → the trend keeps the
		// DAILY points, NOT the coarse weekly aggregate (which was 2 dots spanning a month).
		expect(c.punctuality.trend.map((p) => p.date)).toEqual([
			'2026-06-16',
			'2026-06-17',
			'2026-06-18',
		]);
		expect(c.punctuality.trend.every((p) => p.grain === 'day')).toBe(true);
	});

	it('grain=month → the DAILY series WINDOWED to the last 30 days (not 2 monthly dots, S7)', () => {
		const c = toReliabilityClusters(granular, { grain: 'month' });
		expect(c.punctuality.trend.map((p) => p.date)).toEqual([
			'2026-06-16',
			'2026-06-17',
			'2026-06-18',
		]);
		expect(c.punctuality.trend.every((p) => p.grain === 'day')).toBe(true);
	});

	it('week vs month window the daily series differently (last 7 vs last 30 days, S7)', () => {
		// 10 consecutive daily points (06-09..06-18) → week keeps the last 7, month keeps all.
		const days = Array.from({ length: 10 }, (_, i) => ({
			grain: 'day' as const,
			date: `2026-06-${String(9 + i).padStart(2, '0')}`,
			otp_pct: 80 + i,
		}));
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T02:00:00Z'),
			id: '99',
			periods: days,
		};
		const week = toReliabilityClusters(data, { grain: 'week' });
		const month = toReliabilityClusters(data, { grain: 'month' });
		expect(week.punctuality.trend).toHaveLength(7);
		expect(month.punctuality.trend).toHaveLength(10);
		expect(week.punctuality.trend[0].date).toBe('2026-06-12'); // 7 days back from 06-18
		expect(month.punctuality.trend[0].date).toBe('2026-06-09'); // all of them
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
			{
				day_of_week_iso: 1,
				mix: { empty: 0, many_seats: 0.8, few_seats: 0.2, standing: 0, full: 0 },
			},
			{
				day_of_week_iso: 5,
				mix: { empty: 0, many_seats: 0.6, few_seats: 0.4, standing: 0, full: 0 },
			},
			{
				day_of_week_iso: 6,
				mix: { empty: 0.5, many_seats: 0.5, few_seats: 0, standing: 0, full: 0 },
			},
		],
	};

	it('selects the grain-scoped mix for the requested grain', () => {
		expect(
			toReliabilityClusters(crowdingGrains, { grain: 'day' }).crowding.mixByGrain?.many_seats,
		).toBe(1);
		expect(
			toReliabilityClusters(crowdingGrains, { grain: 'week' }).crowding.mixByGrain?.many_seats,
		).toBe(0.4);
	});

	it('honest-null mixByGrain when the selected grain has no telemetry', () => {
		expect(
			toReliabilityClusters(crowdingGrains, { grain: 'month' }).crowding.mixByGrain,
		).toBeNull();
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

	it('exposes the RAW per-ISO-weekday mix on a fixed Mon→Sun (1..7) frame (P11)', () => {
		const bw = toReliabilityClusters(crowdingGrains).crowding.byWeekday;
		expect(bw).not.toBeNull();
		// Always the full 7-day frame, ISO ascending, regardless of contract sparsity.
		expect(bw?.map((d) => d.iso)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		// Present weekdays keep their mix VERBATIM (not the weekday/weekend mean).
		expect(bw?.find((d) => d.iso === 1)?.mix?.many_seats).toBe(0.8);
		expect(bw?.find((d) => d.iso === 5)?.mix?.few_seats).toBe(0.4);
		expect(bw?.find((d) => d.iso === 6)?.mix?.empty).toBe(0.5);
		// A weekday the contract omits → honest mix:null (not a fabricated zero mix).
		expect(bw?.find((d) => d.iso === 2)?.mix).toBeNull();
		expect(bw?.find((d) => d.iso === 7)?.mix).toBeNull();
	});

	it('keeps a present-but-null weekday mix as honest null on the frame (P11)', () => {
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T02:00:00Z'),
			id: '12',
			occupancy_by_dow: [{ day_of_week_iso: 3, mix: null }],
		};
		const bw = toReliabilityClusters(data).crowding.byWeekday;
		expect(bw?.length).toBe(7);
		expect(bw?.find((d) => d.iso === 3)?.mix).toBeNull();
	});

	it('null byWeekday when occupancy_by_dow is absent (P11)', () => {
		const c = toReliabilityClusters({ generated_utc: utc('2026-06-19T02:00:00Z'), id: '11' });
		expect(c.crowding.byWeekday).toBeNull();
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

/* S7-B windowable §1/§2/§4: the periods_by_grain / habits_by_grain / headway_by_grain /
   weak_stops_by_grain companions feed §1/§2/§4 for the selected grain, with an honest scalar
   fallback (and the per-section windowed flag) when the windowed array is absent (pre-deploy). */
describe('toReliabilityClusters — *_by_grain windowable §1/§2/§4 (S7-B)', () => {
	const windowed: RouteReliability = {
		generated_utc: utc('2026-06-19T02:00:00Z'),
		id: '51',
		// SCALAR whole-history values — DISTINCT from the windowed ones so a read can be attributed.
		day_of_week: [{ day_of_week_iso: 1, avg_delay_min: 9, severe_pct: 9, observation_count: 90 }],
		weak_stops: [{ id: 'scalar-stop', name: 'Scalar', avg_delay_min: 5 }],
		headway: [{ shift: 'am_peak', observed_min: 9, cov: 0.9 }],
		periods: [{ grain: 'am_peak', otp_pct: 50, observation_count: 100 }],
		by_shift_daytype: [
			{ shift: 'am_peak', day_type: 'weekday', otp_pct: 50, observation_count: 100 },
		],
		habits: { scale: 'repeat_problem_relative', matrix: [[0.9]] },
		// WINDOWED companions — only a 'week' entry (no 'day').
		periods_by_grain: [
			{
				grain: 'week',
				by_shift: [{ grain: 'am_peak', otp_pct: 80, observation_count: 200 }],
				by_daytype: [{ grain: 'weekday', otp_pct: 81, observation_count: 200 }],
				day_of_week: [
					{ day_of_week_iso: 1, avg_delay_min: 2, severe_pct: 2, observation_count: 200 },
				],
				by_shift_daytype: [
					{ shift: 'am_peak', day_type: 'weekday', otp_pct: 82, observation_count: 200 },
				],
			},
		],
		headway_by_grain: [
			{ grain: 'week', headway: [{ shift: 'am_peak', observed_min: 7, cov: 0.5 }] },
		],
		weak_stops_by_grain: [
			{
				grain: 'week',
				stops: [
					// a genuinely-worst stop (ranked first by the DB) whose pooled avg is <= 0 — MUST survive.
					{
						id: 'win-worst',
						name: 'Worst',
						avg_delay_min: -1,
						severe_pct: 40,
						observation_count: 50,
						wilson_lo: 30,
						wilson_hi: 50,
					},
					{
						id: 'win-2',
						name: 'Second',
						avg_delay_min: 3,
						severe_pct: 20,
						observation_count: 80,
						wilson_lo: 15,
						wilson_hi: 25,
					},
				],
			},
		],
		habits_by_grain: [
			{ grain: 'week', habits: { scale: 'repeat_problem_relative', matrix: [[0.3]] } },
		],
	};

	it('reads the windowed slice + flags windowed=true when the grain matches', () => {
		const c = toReliabilityClusters(windowed, { grain: 'week' });
		expect(c.punctuality.windowed).toBe(true);
		expect(c.punctuality.weakStopsWindowed).toBe(true);
		expect(c.waitRegularity.windowed).toBe(true);
		// §1 reads the WINDOWED values (distinct from scalar)
		expect(c.punctuality.dayOfWeek[0]?.avg_delay_min).toBe(2);
		expect(c.punctuality.peakOffPeak.byShift[0]?.otpPct).toBe(80);
		expect(c.punctuality.peakOffPeak.byDayType[0]?.otpPct).toBe(81);
		expect(c.punctuality.byShiftDaytype[0]?.otp_pct).toBe(82);
		// §2 reads the windowed headway; §1 heatmap the windowed habits
		expect(c.waitRegularity.headway[0]?.observed_min).toBe(7);
		expect(c.habits.matrix).toEqual([[0.3]]);
	});

	it('preserves the DB worst-first order AND keeps a worst stop whose avg is <= 0 (§4)', () => {
		const c = toReliabilityClusters(windowed, { grain: 'week' });
		expect(c.punctuality.weakStops.map((w) => w.id)).toEqual(['win-worst', 'win-2']);
		// the avg=-1 worst-by-rate stop is NOT dropped (gated on observation_count, not avg).
		expect(c.punctuality.weakStops[0]?.avg_delay_min).toBe(-1);
		expect(c.punctuality.weakStops[0]?.severe_pct).toBe(40);
	});

	it('falls back to scalar + flags windowed=false when the grain has no windowed entry', () => {
		const c = toReliabilityClusters(windowed, { grain: 'day' });
		expect(c.punctuality.windowed).toBe(false);
		expect(c.punctuality.weakStopsWindowed).toBe(false);
		expect(c.waitRegularity.windowed).toBe(false);
		expect(c.punctuality.dayOfWeek[0]?.avg_delay_min).toBe(9); // scalar
		expect(c.waitRegularity.headway[0]?.observed_min).toBe(9); // scalar
		expect(c.habits.matrix).toEqual([[0.9]]); // scalar
		expect(c.punctuality.weakStops.map((w) => w.id)).toEqual(['scalar-stop']); // scalar (avg-gated)
	});

	it('a present-but-null windowed habits entry reads honest-empty, NOT the scalar matrix', () => {
		const nullHabits: RouteReliability = {
			generated_utc: utc('2026-06-19T02:00:00Z'),
			id: '51',
			habits: { scale: 'repeat_problem_relative', matrix: [[0.9]] }, // scalar non-null
			habits_by_grain: [{ grain: 'week', habits: null }], // windowed: no cell cleared MIN_N
		};
		const c = toReliabilityClusters(nullHabits, { grain: 'week' });
		expect(c.habits.isEmpty).toBe(true);
		expect(c.habits.matrix).toEqual([]); // NOT the scalar [[0.9]]
	});

	it('absent *_by_grain (pre-deploy) → all windowed flags false (regression guard)', () => {
		const c = toReliabilityClusters(populated, { grain: 'week' });
		expect(c.punctuality.windowed).toBe(false);
		expect(c.punctuality.weakStopsWindowed).toBe(false);
		expect(c.waitRegularity.windowed).toBe(false);
	});
});
