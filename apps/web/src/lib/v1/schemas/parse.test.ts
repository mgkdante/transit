import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
	parsePort,
	RoutesIndexSchema,
	StopsIndexSchema,
	StopFileSchema,
	RouteFileSchema,
	TripsFileSchema,
	VehiclesFileSchema,
	NetworkFileSchema,
	AlertsFileSchema,
	ManifestSchema,
} from './index';

const ISO = '2026-06-15T03:14:00Z';
const route = { id: 'r1', short: '1', type: 3 };
const stop = { id: 's1', name: 'Central', lat: 45.5, lon: -73.6 };
const trip = { status: 'on_time' };
const vehicle = { id: 'v1', lat: 45.5, lon: -73.6, status: 'late', updated_utc: ISO };
const alert = { id: 'a1', severity: 'watch', header_key: 'Service change' };
const network = {
	generated_utc: ISO,
	vehicles_in_service: 1,
	on_time_pct: 82,
	status_dist: {},
	delay_p50_min: 2,
	delay_p90_min: 9,
	non_responding: 1,
	feed_freshness_s: 31,
	coverage_pct: 96,
};
const manifest = {
	provider: 'example',
	display_name: 'Example Transit',
	bbox: [-73.97, 45.4, -73.47, 45.7],
	attribution: 'Example Transit',
	dataset_version: '2026.06.15',
	labels: { on_time: 'On time' },
	files: { live: { generated_utc: ISO }, historic: { generated_utc: ISO } },
	surfaces: ['network-health'],
};

type Case = [label: string, schema: z.ZodType, base: unknown, withAdditions: unknown];

const CASES: Case[] = [
	[
		'static/routes_index.json',
		RoutesIndexSchema,
		{ generated_utc: ISO, routes: [route] },
		{ generated_utc: ISO, routes: [{ ...route, live_data: true, r3: { mode: 'bus', order: 0 } }] },
	],
	[
		'static/stops_index.json',
		StopsIndexSchema,
		{ generated_utc: ISO, stops: [stop] },
		{ generated_utc: ISO, stops: [{ ...stop, r3: { mode: 'bus' } }] },
	],
	[
		'static/stops/{id}.json',
		StopFileSchema,
		{ generated_utc: ISO, ...stop },
		{ generated_utc: ISO, ...stop, wheelchair_boarding: 'yes' },
	],
	[
		'static/routes/{id}.json',
		RouteFileSchema,
		{ generated_utc: ISO, id: route.id },
		{ generated_utc: ISO, id: route.id, r3: { headway: null } },
	],
	[
		'live/trips.json',
		TripsFileSchema,
		{ generated_utc: ISO, trips: { t1: trip } },
		{
			generated_utc: ISO,
			trips: {
				t1: {
					...trip,
					headsign: 'Central',
					direction_id: 0,
					first_departure: '08:00:00',
					first_departure_seconds: 28800,
					r3: { band: 'late' },
				},
			},
		},
	],
	[
		'live/vehicles.json',
		VehiclesFileSchema,
		{ generated_utc: ISO, vehicles: [vehicle] },
		{ generated_utc: ISO, vehicles: [{ ...vehicle, r3: { band: 'on_time' } }] },
	],
	['live/network.json', NetworkFileSchema, network, { ...network, r3: { on_time_pct: null } }],
	[
		'live/alerts.json',
		AlertsFileSchema,
		{ generated_utc: ISO, alerts: [alert] },
		{ generated_utc: ISO, alerts: [{ ...alert, r3: { severity: 'unknown' } }] },
	],
	[
		'manifest.json',
		ManifestSchema,
		manifest,
		{
			...manifest,
			files: {
				...manifest.files,
				historic: {
					...manifest.files.historic,
					data_through: '2026-06-14',
					published_utc: ISO,
					next_publish_utc: '2026-06-22T03:14:00Z',
				},
			},
		},
	],
];

describe('current schemas accept payloads that carry r3 objects and the new flat fields', () => {
	it.each(CASES)('%s', (label, schema, base, withAdditions) => {
		const expected = parsePort(label, schema, base);
		expect(() => parsePort(label, schema, withAdditions)).not.toThrow();
		expect(parsePort(label, schema, withAdditions)).toEqual(expected);
	});
});
