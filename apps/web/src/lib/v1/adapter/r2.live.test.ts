import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas/manifest';
import { r2Adapter } from './r2';

vi.mock('$app/environment', () => ({ browser: true }));

const ISO = '2026-07-15T12:00:00Z';

function bootManifest(): Manifest {
	return {
		provider: 'stm',
		display_name: 'STM',
		bbox: [-74, 45, -73, 46],
		attribution: 'STM',
		dataset_version: 'v1',
		labels: {},
		files: {
			live: {
				generated_utc: ISO,
				vehicles: 'live/current-vehicles.json',
				trips: 'live/current-trips.json',
				stop_departures: 'live/current-stop-departures.json',
				alerts: 'live/current-alerts.json',
				network: 'live/current-network.json',
			},
		},
		surfaces: [],
	} as unknown as Manifest;
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

describe('r2 live ports', () => {
	it('reuse an authoritative boot manifest and fetch only the five live payloads', async () => {
		const manifest = bootManifest();
		const payloads: Record<string, unknown> = {
			'manifest.json': manifest,
			'live/current-vehicles.json': { generated_utc: ISO, vehicles: [] },
			'live/current-trips.json': { generated_utc: ISO, trips: {} },
			'live/current-stop-departures.json': { generated_utc: ISO, stops: {} },
			'live/current-alerts.json': { generated_utc: ISO, alerts: [] },
			'live/current-network.json': {
				generated_utc: ISO,
				vehicles_in_service: 0,
				on_time_pct: null,
				status_dist: {},
				delay_p50_min: null,
				delay_p90_min: null,
				non_responding: 0,
				feed_freshness_s: null,
				coverage_pct: null,
			},
		};
		const request = vi.fn(async (input: RequestInfo | URL) => {
			const path = String(input).replace('/data/v1/stm/', '');
			const payload = payloads[path];
			if (payload === undefined) throw new Error(`unexpected URL ${String(input)}`);
			return json(payload);
		});
		const ctx = {
			fetch: request as unknown as typeof fetch,
			manifest,
		};

		await Promise.all([
			r2Adapter.live.vehicles(ctx),
			r2Adapter.live.trips(ctx),
			r2Adapter.live.stopDepartures(ctx),
			r2Adapter.live.alerts(ctx),
			r2Adapter.live.network(ctx),
		]);

		const paths = request.mock.calls.map(([input]) => String(input).replace('/data/v1/stm/', ''));
		expect(paths.filter((path) => path === 'manifest.json')).toHaveLength(0);
		expect(paths).toEqual([
			'live/current-vehicles.json',
			'live/current-trips.json',
			'live/current-stop-departures.json',
			'live/current-alerts.json',
			'live/current-network.json',
		]);
	});
});
