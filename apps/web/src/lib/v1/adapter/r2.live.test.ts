import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '#lib/v1/schemas/manifest.ts';
import { r2Adapter } from './r2';
import { liveReader } from './index';

vi.mock('$app/env', () => ({ browser: true }));

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

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('r2 live ports', () => {
	it('passes live response cache headers to the caller', async () => {
		const onResponseHeaders = vi.fn();
		const response = json({ generated_utc: ISO, vehicles: [] });
		response.headers.set('Cache-Control', 'public, max-age=30');
		response.headers.set('Age', '21');
		await r2Adapter.live.vehicles({
			manifest: bootManifest(),
			fetch: vi.fn(async () => response),
			onResponseHeaders,
		});
		expect(onResponseHeaders).toHaveBeenCalledWith(response.headers);
		expect(onResponseHeaders.mock.calls[0][0].get('age')).toBe('21');
	});

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

	it('resolves data health from its manifest pointer and treats a default-path 404 as absent', async () => {
		const customManifest = bootManifest();
		customManifest.files.live.data_health = 'status/current-data-health.json';
		const dataHealth = { generated_utc: ISO, lanes: [], feeds: [] };
		const controller = new AbortController();
		const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
			String(input).endsWith('/status/current-data-health.json') ? json(dataHealth) : json({}, 404),
		);

		await expect(
			r2Adapter.dataHealth.get({
				fetch: request as unknown as typeof fetch,
				manifest: customManifest,
				signal: controller.signal,
			}),
		).resolves.toEqual(dataHealth);
		await expect(
			r2Adapter.dataHealth.get({
				fetch: request as unknown as typeof fetch,
				manifest: bootManifest(),
				signal: controller.signal,
			}),
		).resolves.toBeNull();

		expect(request.mock.calls.map(([input]) => String(input))).toEqual([
			'/data/v1/stm/status/current-data-health.json',
			'/data/v1/stm/status/data_health.json',
		]);
		for (const [, init] of request.mock.calls) {
			expect(init).toEqual({
				headers: { accept: 'application/json' },
				cache: 'default',
				signal: controller.signal,
			});
		}
	});
});

it.each(['stm', 'octranspo'])(
	'reads %s through the transport-free reader with polling and cancellation',
	async (provider) => {
		const manifest = { ...bootManifest(), provider };
		manifest.files.live.ttl_s = 30;
		const response = json({ generated_utc: ISO, vehicles: [] });
		response.headers.set('cache-control', 'public, max-age=30');
		response.headers.set('age', '21');
		const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
		vi.stubGlobal('fetch', request);
		const onPollDelayMs = vi.fn();
		const controller = new AbortController();
		try {
			await expect(
				liveReader.vehicles({ manifest, signal: controller.signal, onPollDelayMs }),
			).resolves.toMatchObject({ vehicles: [] });
			expect(request).toHaveBeenCalledWith(
				'/data/v1/' + provider + '/live/current-vehicles.json',
				expect.objectContaining({ signal: controller.signal }),
			);
			expect(onPollDelayMs.mock.calls[0][0]).toBeGreaterThanOrEqual(9500);
			expect(onPollDelayMs.mock.calls[0][0]).toBeLessThanOrEqual(11000);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);
