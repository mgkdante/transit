// roundtrip.test.ts — the contract front-door gate. Two guarantees:
//
//   1. EVERY exported *File / top-level schema parses a MINIMAL valid fixture
//      via parsePort(). "Minimal" = only the required fields the schema demands;
//      this proves the schema does not over-require beyond the on-disk JSON
//      Schema, and that the happy path round-trips through the adapter boundary.
//
//   2. A BAD value THROWS via parsePort, and the thrown error names the port
//      (`[adapter.<label>] …`) so a contract drift in CI points at the family.
//      Closed enums are the sharpest probe (StatusCode/OccupancyCode/Severity),
//      so the negative cases feed an out-of-vocabulary value to each.
//
// This is a GATE, not exhaustive: it covers each schema family's required core,
// not every optional/nullable permutation.

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
	parsePort,
	// shared primitives
	StatusCodeSchema,
	OccupancyCodeSchema,
	SeverityCodeSchema,
	GrainSchema,
	// roots / dictionaries
	ManifestSchema,
	LabelsFileSchema,
	// live tier
	NetworkFileSchema,
	VehiclesFileSchema,
	TripsFileSchema,
	StopDeparturesFileSchema,
	AlertsFileSchema,
	// static tier
	RoutesIndexSchema,
	RouteFileSchema,
	StopsIndexSchema,
	StopFileSchema,
	BasemapFileSchema,
	// historic tier
	RouteReliabilitySchema,
	StopReliabilitySchema,
	ReceiptSchema,
	ReceiptsIndexSchema,
	RepeatOffendersSchema,
	HotspotsSchema,
	NetworkTrendSchema,
	AlertHistorySchema,
	// provenance
	ProvenanceSchema,
} from './index';

const ISO = '2026-06-15T03:14:00Z';

// [port label, schema, minimal valid fixture]
type Case = [string, z.ZodTypeAny, unknown];

const CASES: Case[] = [
	// --- shared enums (the contract's closed vocabularies) -------------------
	['status', StatusCodeSchema, 'on_time'],
	['occupancy', OccupancyCodeSchema, 'few_seats'],
	['severity', SeverityCodeSchema, 'high'],
	['grain', GrainSchema, 'day'],

	// --- roots / dictionaries ------------------------------------------------
	[
		'manifest',
		ManifestSchema,
		{
			provider: 'stm',
			display_name: 'Société de transport de Montréal',
			short_name: 'STM',
			city: 'Montréal',
			bbox: [-73.97, 45.4, -73.47, 45.7],
			attribution: 'STM',
			dataset_version: '2026.06.15',
			labels: { on_time: 'On time' },
			files: { live: { generated_utc: ISO } },
			surfaces: ['network-health'],
		},
	],
	['labels', LabelsFileSchema, { generated_utc: ISO, labels: { on_time: 'On time' } }],

	// --- live tier -----------------------------------------------------------
	[
		'network',
		NetworkFileSchema,
		{
			generated_utc: ISO,
			vehicles_in_service: 812,
			on_time_pct: 82,
			status_dist: {}, // every band defaults to 0
			delay_p50_min: 2,
			delay_p90_min: 9,
			non_responding: 14,
			feed_freshness_s: 31,
			coverage_pct: 96,
		},
	],
	[
		'vehicles',
		VehiclesFileSchema,
		{
			generated_utc: ISO,
			vehicles: [{ id: 'v1', lat: 45.5, lon: -73.6, status: 'late', updated_utc: ISO }],
		},
	],
	['trips', TripsFileSchema, { generated_utc: ISO, trips: { t1: { status: 'on_time' } } }],
	['stop_departures', StopDeparturesFileSchema, { generated_utc: ISO }],
	[
		'alerts',
		AlertsFileSchema,
		{
			generated_utc: ISO,
			alerts: [{ id: 'a1', severity: 'watch', header_key: 'Travaux sur la ligne' }],
		},
	],

	// --- static tier ---------------------------------------------------------
	[
		'routes_index',
		RoutesIndexSchema,
		{ generated_utc: ISO, routes: [{ id: '165', short: '165', type: 3 }] },
	],
	['route', RouteFileSchema, { generated_utc: ISO, id: '165' }],
	[
		'stops_index',
		StopsIndexSchema,
		{ generated_utc: ISO, stops: [{ id: 's1', name: 'Côte-des-Neiges', lat: 45.5, lon: -73.6 }] },
	],
	[
		'stop',
		StopFileSchema,
		{ generated_utc: ISO, id: 's1', name: 'Côte-des-Neiges', lat: 45.5, lon: -73.6 },
	],
	[
		'basemap',
		BasemapFileSchema,
		{ url: 'https://x/basemap.pmtiles', attribution: 'STM', generated_utc: ISO },
	],

	// --- historic tier -------------------------------------------------------
	['route_reliability', RouteReliabilitySchema, { generated_utc: ISO, id: '165' }],
	['stop_reliability', StopReliabilitySchema, { generated_utc: ISO, id: 's1' }],
	['receipts', ReceiptSchema, { generated_utc: ISO, date: '2026-06-14' }],
	['receipts_index', ReceiptsIndexSchema, { generated_utc: ISO }],
	['repeat_offenders', RepeatOffendersSchema, { generated_utc: ISO }],
	['hotspots', HotspotsSchema, { generated_utc: ISO }],
	['network_trend', NetworkTrendSchema, { generated_utc: ISO }],
	['alert_history', AlertHistorySchema, { generated_utc: ISO }],

	// --- provenance ----------------------------------------------------------
	['provenance', ProvenanceSchema, { generated_utc: ISO }],
];

describe('schema round-trip — every family parses a minimal valid fixture', () => {
	for (const [label, schema, fixture] of CASES) {
		it(`[${label}] parses its minimal valid fixture`, () => {
			expect(() => parsePort(label, schema, fixture)).not.toThrow();
		});
	}
});

describe('reliability — new optional fields (day_of_week / habits / p50,p90) round-trip', () => {
	it('parses a populated route_reliability with day_of_week + percentile periods', () => {
		const fixture = {
			generated_utc: ISO,
			id: '165',
			periods: [
				{ grain: 'day', date: '2026-06-14', p50_min: 1.2, p90_min: 6.5 },
				// granularity grains are free-string (locks against enum-tightening)
				{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
				{ grain: 'weekday', otp_pct: 85, avg_delay_min: 1.8, severe_pct: 4.2 },
			],
			day_of_week: [
				{ day_of_week_iso: 1, avg_delay_min: 2.1, severe_pct: 4.0, observation_count: 1200 },
			],
			habits: { scale: 'repeat_problem_relative', matrix: [[0.0, null]] },
			// S7-B Pattern A: bare shift + typed direction_id / day_type
			headway: [{ shift: 'am_peak', direction_id: 0, day_type: 'weekend', observed_min: 7.5 }],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses a populated stop_reliability with a severe_relative heatmap + day p50/p90', () => {
		const fixture = {
			generated_utc: ISO,
			id: 's1',
			periods: [{ grain: 'day', p50_min: 0.8, p90_min: 5.0 }],
			habits: { scale: 'severe_relative', matrix: [[null, 1.0]] },
			// per-stop weekday seasonality (ISO 1=Mon..7=Sun); the additive optional
			// field mirrors the route shape (day_of_week_iso required, rest nullable).
			day_of_week: [
				{ day_of_week_iso: 5, avg_delay_min: 3.4, severe_pct: 7.1, observation_count: 320 },
			],
			// trailing-window crowding of buses observed AT this stop — additive
			// optional, reuses the canonical OccupancyMix shape (route surface mirror).
			occupancy_mix: { empty: 0.05, many_seats: 0.2, few_seats: 0.3, standing: 0.4, full: 0.05 },
		};
		expect(() => parsePort('stop_reliability', StopReliabilitySchema, fixture)).not.toThrow();
	});
});

describe('tier-1 — cancellations + occupancy_mix round-trip (additive optional)', () => {
	it('parses route_reliability carrying cancellations + occupancy_mix', () => {
		const fixture = {
			generated_utc: ISO,
			id: '165',
			cancellations: [
				{
					grain: 'day',
					date: '2026-06-14',
					cancellation_rate_pct: 2.56,
					canceled_trip_days: 4,
					total_trip_days: 156,
				},
			],
			occupancy_mix: { empty: 0, many_seats: 0.5, few_seats: 0.3, standing: 0.2, full: 0 },
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses route_reliability carrying S7 occupancy_by_grain + occupancy_by_dow', () => {
		const fixture = {
			generated_utc: ISO,
			id: '51',
			// grain-aware crowding mix (day/week/month) + per-ISO-weekday split.
			occupancy_by_grain: [
				{ grain: 'day', mix: { empty: 0, many_seats: 1, few_seats: 0, standing: 0, full: 0 } },
				{
					grain: 'week',
					mix: { empty: 0.1, many_seats: 0.4, few_seats: 0.3, standing: 0.15, full: 0.05 },
				},
				// honest-absence: a window with no band telemetry carries mix: null.
				{ grain: 'month', mix: null },
			],
			occupancy_by_dow: [
				{
					day_of_week_iso: 1,
					mix: { empty: 0, many_seats: 0.5, few_seats: 0.3, standing: 0.2, full: 0 },
					n: 4000, // FIX-5: per-DOW band-observation total (trip-weight denominator)
				},
				// weekday with data-days but no band telemetry -> mix null; still parses.
				{ day_of_week_iso: 7, mix: null, n: 0 },
			],
		};
		const parsed = parsePort('route_reliability', RouteReliabilitySchema, fixture);
		expect(parsed.occupancy_by_dow?.[0]?.n).toBe(4000);
		expect(parsed.occupancy_by_dow?.[1]?.n).toBe(0);
	});

	it('parses route_reliability with occupancy_by_grain/dow absent (additive optional)', () => {
		const fixture = { generated_utc: ISO, id: '51' };
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses network_trend carrying cancellation_rate + occupancy_mix per point', () => {
		const fixture = {
			generated_utc: ISO,
			series: [
				{
					date: '2026-06-14',
					otp_pct: 82,
					cancellation_rate: 1.2,
					occupancy_mix: {
						empty: 0.1,
						many_seats: 0.4,
						few_seats: 0.3,
						standing: 0.15,
						full: 0.05,
					},
				},
				// honest-null day: both new fields absent — still parses (optional).
				{ date: '2026-06-15' },
			],
		};
		expect(() => parsePort('network_trend', NetworkTrendSchema, fixture)).not.toThrow();
	});

	it('parses network_trend carrying network-wide by_shift + by_daytype readouts', () => {
		const fixture = {
			generated_utc: ISO,
			by_shift: [
				{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
				{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
				// honest-null grain: too little data → metrics null, still parses.
				{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
			],
			by_daytype: [
				{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
				// metrics absent entirely (optional) — still parses.
				{ grain: 'weekend' },
			],
		};
		expect(() => parsePort('network_trend', NetworkTrendSchema, fixture)).not.toThrow();
	});

	it('parses network_trend carrying additive weekly + monthly trend series', () => {
		const fixture = {
			generated_utc: ISO,
			// week-start / month-start dated TrendPoints. p90_min + vehicles are null
			// on these coarse grains (14d-daily-only) — honest gaps, never fabricated.
			weekly: [
				{
					date: '2026-06-08',
					otp_pct: 80,
					avg_delay_min: 2.0,
					p90_min: null,
					vehicles: null,
				},
				// honest-null week: otp absent (optional) — still parses.
				{ date: '2026-06-15' },
			],
			monthly: [
				{
					date: '2026-05-01',
					otp_pct: 79,
					avg_delay_min: 2.2,
					p90_min: null,
					vehicles: null,
				},
				{ date: '2026-06-01' },
			],
		};
		expect(() => parsePort('network_trend', NetworkTrendSchema, fixture)).not.toThrow();
	});
});

describe('S7-B §2 — windowable headway_by_grain round-trip', () => {
	it('parses route_reliability carrying headway_by_grain (busiest-dir, recomposed + prior)', () => {
		const fixture = {
			generated_utc: ISO,
			id: '165',
			headway: [
				{ shift: 'am_peak', scheduled_min: 6, observed_min: 7.5, cov: 0.42, bunched_pct: 18 },
			],
			headway_by_grain: [
				{
					grain: 'week',
					date: '2026-06-20',
					headway: [
						{
							shift: 'am_peak',
							scheduled_min: 6,
							observed_min: 7.5,
							excess_wait_min: 1.5,
							cov: 0.63,
							bunched_pct: 18,
							observation_count: 240,
							prior_observation_count: 228,
							prior_observed_min: 7.1,
						},
					],
				},
			],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses route_reliability with headway_by_grain absent (additive optional)', () => {
		const fixture = { generated_utc: ISO, id: '51' };
		const parsed = parsePort('route_reliability', RouteReliabilitySchema, fixture);
		expect(parsed.headway_by_grain ?? []).toEqual([]);
	});
});

describe('S7-B §4 — windowable weak_stops_by_grain round-trip', () => {
	it('parses route_reliability carrying weak_stops_by_grain (Wilson-ranked, + the new WeakStop fields)', () => {
		const fixture = {
			generated_utc: ISO,
			id: '165',
			weak_stops: [{ id: '51234', name: 'Côte-Vertu / Décarie', avg_delay_min: 8.2 }],
			weak_stops_by_grain: [
				{
					grain: 'month',
					date: '2026-06-01',
					stops: [
						{
							id: '9001',
							name: 'Worst / Stop',
							avg_delay_min: 12.4,
							observation_count: 987,
							severe_pct: 55,
							wilson_lo: 33.1,
							wilson_hi: 47.9,
						},
					],
				},
			],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses route_reliability with weak_stops_by_grain absent (additive optional)', () => {
		const fixture = { generated_utc: ISO, id: '51' };
		const parsed = parsePort('route_reliability', RouteReliabilitySchema, fixture);
		expect(parsed.weak_stops_by_grain ?? []).toEqual([]);
	});
});

describe('S7-B — windowable §1 (periods_by_grain + habits_by_grain + prior_*) round-trip', () => {
	it('parses route_reliability carrying periods_by_grain + habits_by_grain + prior fields', () => {
		const fixture = {
			generated_utc: ISO,
			id: '165',
			periods: [
				{
					grain: 'day',
					otp_pct: 82,
					observation_count: 12345,
					prior_observation_count: 11987,
					prior_otp_pct: 79,
				},
			],
			periods_by_grain: [
				{
					grain: 'week',
					date: '2026-06-20',
					by_shift: [
						{
							grain: 'am_peak',
							otp_pct: 80,
							observation_count: 2000,
							prior_observation_count: 1900,
							prior_otp_pct: 78,
							prior_on_time: 1482, // FIX-4: exact prior numerator (1482/1900 = 78.0%)
						},
					],
					by_daytype: [{ grain: 'weekday', otp_pct: 81, observation_count: 9000 }],
					day_of_week: [
						{ day_of_week_iso: 1, avg_delay_min: 3.1, severe_pct: 4, observation_count: 4000 },
					],
					by_shift_daytype: [
						{ shift: 'am_peak', day_type: 'weekday', otp_pct: 80, observation_count: 2000 },
					],
				},
			],
			habits_by_grain: [
				{
					grain: 'month',
					date: '2026-06-20',
					habits: { scale: 'repeat_problem_relative', matrix: [[0.1, null]] },
					cells_observed: 1,
					cells_suppressed: 167,
				},
				// honest absence: a too-sparse window carries habits=null + a suppressed count
				{ grain: 'day', date: '2026-06-20', habits: null, cells_observed: 0, cells_suppressed: 12 },
			],
		};
		const parsed = parsePort('route_reliability', RouteReliabilitySchema, fixture);
		expect(parsed.periods_by_grain?.[0]?.by_shift?.[0]?.prior_on_time).toBe(1482);
	});

	it('parses route_reliability with the S7-B keys absent (additive optional back-compat)', () => {
		const fixture = { generated_utc: ISO, id: '51', periods: [{ grain: 'day', otp_pct: 80 }] };
		const parsed = parsePort('route_reliability', RouteReliabilitySchema, fixture);
		expect(parsed.periods_by_grain ?? []).toEqual([]);
		expect(parsed.habits_by_grain ?? []).toEqual([]);
		expect(parsed.periods?.[0]?.prior_on_time).toBeUndefined(); // additive: absent → undefined
	});

	it('rejects a wrong-typed grain inside periods_by_grain (names the port)', () => {
		const bad = {
			generated_utc: ISO,
			id: '51',
			periods_by_grain: [{ grain: 123, by_shift: [] }],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, bad)).toThrowError(
			/route_reliability/,
		);
	});
});

describe('tier-2 — headway cov/bunching + service_spans + alert breakdown round-trip', () => {
	it('parses route_reliability carrying headway cov/bunched_pct + service_spans', () => {
		const fixture = {
			generated_utc: ISO,
			id: '165',
			headway: [{ shift: 'am_peak', observed_min: 8.5, cov: 0.42, bunched_pct: 12.5 }],
			service_spans: [
				{
					date: '2026-06-14',
					first_trip_utc: '2026-06-14T10:00:00Z',
					last_trip_utc: '2026-06-15T01:00:00Z',
					service_span_min: 900,
					first_trip_delay_min: 0.5,
					last_trip_delay_min: 1.5,
					trip_count: 120,
				},
			],
			skipped_stops: [
				{
					date: '2026-06-14',
					skipped_stop_rate_pct: 3.94,
					skipped_stop_count: 12,
					stop_time_update_count: 305,
				},
			],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses alert_history carrying a cause/effect/severity breakdown', () => {
		const fixture = {
			generated_utc: ISO,
			alerts: [],
			breakdown: {
				by_cause: [{ key: 'unknown', count: 3, median_duration_min: 42 }],
				by_effect: [{ key: 'DETOUR', count: 2 }],
				by_severity: [{ key: 'high', count: 2, median_duration_min: null }],
			},
		};
		expect(() => parsePort('alert_history', AlertHistorySchema, fixture)).not.toThrow();
	});

	it('parses route/stop/trend carrying the slice-S3 honesty fields (observation_count + wilson_lo/hi)', () => {
		const route = {
			generated_utc: ISO,
			id: '165',
			periods: [
				// real-OTP Wilson on a route period...
				{
					grain: 'day',
					date: '2026-06-14',
					otp_pct: 82,
					observation_count: 240,
					wilson_lo: 76.8,
					wilson_hi: 86.4,
				},
				// ...and honest absence (fields omitted = pre-republish back-compat).
				{ grain: 'week' },
			],
		};
		const stop = {
			generated_utc: ISO,
			id: 's1',
			// severe-proxy Wilson bounds the NOT-SEVERE rate, not a real OTP.
			periods: [
				{ grain: 'week', otp_pct: 90, observation_count: 120, wilson_lo: 83.6, wilson_hi: 94.2 },
			],
		};
		const trend = {
			generated_utc: ISO,
			series: [
				{
					date: '2026-06-14',
					otp_pct: 82,
					observation_count: 5400,
					wilson_lo: 81.0,
					wilson_hi: 83.0,
				},
			],
			by_shift: [
				{
					grain: 'am_peak',
					otp_pct: 79,
					observation_count: 1800,
					wilson_lo: 77.1,
					wilson_hi: 80.8,
				},
			],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, route)).not.toThrow();
		expect(() => parsePort('stop_reliability', StopReliabilitySchema, stop)).not.toThrow();
		expect(() => parsePort('network_trend', NetworkTrendSchema, trend)).not.toThrow();
	});
});

describe('network — delay_histogram + non_responding_by_route round-trip (additive optional)', () => {
	it('parses a network file carrying the 8-bucket delay histogram + per-route silent counts', () => {
		const fixture = {
			generated_utc: ISO,
			vehicles_in_service: 812,
			on_time_pct: 82,
			status_dist: {},
			delay_p50_min: 2,
			delay_p90_min: 9,
			non_responding: 14,
			feed_freshness_s: 31,
			coverage_pct: 96,
			// All 8 fixed signed-minute buckets (null edge = unbounded). `count`
			// defaults to 0, so a bucket may omit it.
			delay_histogram: [
				{ lo_min: null, hi_min: -5, count: 3 },
				{ lo_min: -5, hi_min: -2, count: 12 },
				{ lo_min: -2, hi_min: 0, count: 40 },
				{ lo_min: 0, hi_min: 2 },
				{ lo_min: 2, hi_min: 5, count: 90 },
				{ lo_min: 5, hi_min: 10, count: 30 },
				{ lo_min: 10, hi_min: 15, count: 8 },
				{ lo_min: 15, hi_min: null, count: 2 },
			],
			// Per-route silent-trip counts; SUM(count)=14 equals `non_responding`.
			non_responding_by_route: [
				{ route_id: '51', count: 9 },
				{ route_id: '105', count: 5 },
			],
		};
		expect(() => parsePort('network', NetworkFileSchema, fixture)).not.toThrow();
	});

	it('parses a network file with BOTH new fields absent (back-compat)', () => {
		const fixture = {
			generated_utc: ISO,
			vehicles_in_service: 812,
			on_time_pct: 82,
			status_dist: {},
			delay_p50_min: 2,
			delay_p90_min: 9,
			non_responding: 0,
			feed_freshness_s: 31,
			coverage_pct: 96,
		};
		expect(() => parsePort('network', NetworkFileSchema, fixture)).not.toThrow();
	});

	it('parses a network file with both new fields explicitly null (honest empty)', () => {
		const fixture = {
			generated_utc: ISO,
			vehicles_in_service: 812,
			on_time_pct: 82,
			status_dist: {},
			delay_p50_min: 2,
			delay_p90_min: 9,
			non_responding: 0,
			feed_freshness_s: 31,
			coverage_pct: 96,
			delay_histogram: null,
			non_responding_by_route: null,
		};
		expect(() => parsePort('network', NetworkFileSchema, fixture)).not.toThrow();
	});

	it('rejects a non_responding_by_route entry missing its required count', () => {
		const bad = {
			generated_utc: ISO,
			vehicles_in_service: 812,
			on_time_pct: 82,
			status_dist: {},
			delay_p50_min: 2,
			delay_p90_min: 9,
			non_responding: 1,
			feed_freshness_s: 31,
			coverage_pct: 96,
			non_responding_by_route: [{ route_id: '51' }],
		};
		expect(() => parsePort('network', NetworkFileSchema, bad)).toThrowError(
			/^\[adapter\.network\]/,
		);
	});
});

describe('stops_index — optional mode + routes round-trip', () => {
	it('parses a populated entry (mode + routes) alongside a minimal one (neither)', () => {
		const fixture = {
			generated_utc: ISO,
			stops: [
				{
					id: 's1',
					name: 'Berri-UQAM',
					lat: 45.51,
					lon: -73.56,
					mode: 'metro',
					routes: ['1', '165'],
				},
				{ id: 's2', name: 'Côte-des-Neiges', lat: 45.5, lon: -73.6 },
			],
		};
		expect(() => parsePort('stops_index', StopsIndexSchema, fixture)).not.toThrow();
	});
});

describe('alerts — additive cause/effect/severity_level round-trip (raw GTFS-RT/i3 passthroughs)', () => {
	it('parses an alert carrying cause/effect/severity_level alongside a minimal one', () => {
		const fixture = {
			generated_utc: ISO,
			alerts: [
				{
					id: 'a1',
					severity: 'high',
					header_key: 'Détour sur la ligne 33',
					cause: 'CONSTRUCTION',
					effect: 'DETOUR',
					severity_level: 'WARNING',
				},
				// minimal alert: the three new fields absent — still parses (optional).
				{ id: 'a2', severity: 'watch', header_key: 'Travaux' },
			],
		};
		expect(() => parsePort('alerts', AlertsFileSchema, fixture)).not.toThrow();
	});

	it('parses an alert carrying the S15 url/url_en + active_periods, and one without', () => {
		const fixture = {
			generated_utc: ISO,
			alerts: [
				{
					id: 'a1',
					severity: 'high',
					header_key: 'Détour',
					url: 'https://stm.info/a',
					url_en: 'https://stm.info/en/a',
					active_periods: [
						{ start_utc: '2026-06-01T00:00:00Z', end_utc: '2026-06-02T00:00:00Z' },
						{ start_utc: '2026-06-10T00:00:00Z', end_utc: null },
					],
				},
				// legacy: no url / no active_periods — still parses (all optional).
				{ id: 'a2', severity: 'watch', header_key: 'Travaux' },
			],
		};
		expect(() => parsePort('alerts', AlertsFileSchema, fixture)).not.toThrow();
	});
});

describe('alert_history — S15 additive (window envelope + entry cause/effect/url/active_periods)', () => {
	it('parses a history carrying the served-window envelope + rich entries', () => {
		const fixture = {
			generated_utc: ISO,
			window_start: '2026-04-01',
			window_end: '2026-06-30',
			total_in_window: 512,
			truncated: true,
			alerts: [
				{
					id: 'h1',
					severity: 'high',
					cause: 'CONSTRUCTION',
					effect: 'DETOUR',
					severity_level: 'WARNING',
					url: 'https://stm.info/h1',
					active_periods: [{ start_utc: '2026-06-01T00:00:00Z', end_utc: '2026-06-02T00:00:00Z' }],
				},
				// legacy entry: none of the S15 fields — still parses.
				{ id: 'h2' },
			],
		};
		expect(() => parsePort('alert_history', AlertHistorySchema, fixture)).not.toThrow();
	});

	it('still parses a LEGACY history with none of the S15 fields (additive-only)', () => {
		const fixture = { generated_utc: ISO, alerts: [{ id: 'old' }] };
		expect(() => parsePort('alert_history', AlertHistorySchema, fixture)).not.toThrow();
	});
});

describe('schema round-trip — a bad value throws via parsePort, naming the port', () => {
	// Closed-enum families: an out-of-vocabulary value must be rejected.
	const ENUM_REJECTS: Array<[string, z.ZodTypeAny, unknown]> = [
		['status', StatusCodeSchema, 'kinda_late'],
		['occupancy', OccupancyCodeSchema, 'crammed'],
		['severity', SeverityCodeSchema, 'apocalyptic'],
		['grain', GrainSchema, 'decade'],
	];

	for (const [label, schema, badValue] of ENUM_REJECTS) {
		it(`[${label}] rejects an out-of-enum value and names the port`, () => {
			expect(() => parsePort(label, schema, badValue)).toThrowError(
				new RegExp(`^\\[adapter\\.${label}\\]`),
			);
		});
	}

	it('[vehicles] rejects a row with a bad status enum (nested object path)', () => {
		const bad = {
			generated_utc: ISO,
			vehicles: [{ id: 'v1', lat: 45.5, lon: -73.6, status: 'on_fire', updated_utc: ISO }],
		};
		expect(() => parsePort('vehicles', VehiclesFileSchema, bad)).toThrowError(
			/^\[adapter\.vehicles\]/,
		);
	});

	it('[stops_index] rejects a stop with a wrong-typed mode (nested object path)', () => {
		// `mode` is a FREE STRING in the canonical contract (not a closed enum), so an
		// unknown string value is VALID — only a wrong TYPE (here a number) must throw.
		const bad = {
			generated_utc: ISO,
			stops: [{ id: 's1', name: 'X', lat: 45.5, lon: -73.6, mode: 42 }],
		};
		expect(() => parsePort('stops_index', StopsIndexSchema, bad)).toThrowError(
			/^\[adapter\.stops_index\]/,
		);
	});

	it('[network] rejects a missing required headline number', () => {
		// vehicles_in_service is required (non-nullable); dropping it must throw.
		const bad = {
			generated_utc: ISO,
			on_time_pct: 82,
			status_dist: {},
			delay_p50_min: 2,
			delay_p90_min: 9,
			non_responding: 14,
			feed_freshness_s: 31,
			coverage_pct: 96,
		};
		expect(() => parsePort('network', NetworkFileSchema, bad)).toThrowError(
			/^\[adapter\.network\]/,
		);
	});

	it('[manifest] rejects a wrong-typed required field', () => {
		const bad = {
			provider: 'stm',
			display_name: 'STM',
			bbox: 'not-an-array',
			attribution: 'STM',
			dataset_version: '2026.06.15',
			labels: {},
			files: { live: { generated_utc: ISO } },
			surfaces: [],
		};
		expect(() => parsePort('manifest', ManifestSchema, bad)).toThrowError(/^\[adapter\.manifest\]/);
	});
});
