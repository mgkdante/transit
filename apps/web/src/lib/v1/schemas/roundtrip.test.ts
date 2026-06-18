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
			display_name: 'STM',
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
			// direction encoded in the free shift string
			headway: [{ shift: 'am_peak_dir0_weekend', observed_min: 7.5 }],
		};
		expect(() => parsePort('route_reliability', RouteReliabilitySchema, fixture)).not.toThrow();
	});

	it('parses a populated stop_reliability with a severe_relative heatmap + day p50/p90', () => {
		const fixture = {
			generated_utc: ISO,
			id: 's1',
			periods: [{ grain: 'day', p50_min: 0.8, p90_min: 5.0 }],
			habits: { scale: 'severe_relative', matrix: [[null, 1.0]] },
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

	it('[stops_index] rejects a stop with an out-of-enum mode (nested object path)', () => {
		const bad = {
			generated_utc: ISO,
			stops: [{ id: 's1', name: 'X', lat: 45.5, lon: -73.6, mode: 'spaceship' }],
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
