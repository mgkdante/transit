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
