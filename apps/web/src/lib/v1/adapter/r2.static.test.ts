import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas/manifest';
import { r2Adapter } from './r2';

vi.mock('$app/environment', () => ({ browser: true }));

const ISO = '2026-07-15T12:00:00Z';

function manifest(overrides: Record<string, unknown> = {}): Manifest {
	return {
		provider: 'stm',
		display_name: 'STM',
		bbox: [-74, 45, -73, 46],
		attribution: 'STM',
		dataset_version: 'v1',
		labels: {},
		files: {
			live: { generated_utc: ISO },
			...overrides,
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

describe('r2 static ports', () => {
	it('uses authoritative custom pointers, encoded entity IDs, and the top-level basemap pointer', async () => {
		const authoritativeManifest = {
			...manifest({
				static: {
					routes_index: 'static/catalog/routes.json',
					routes_prefix: 'static/routes-v2',
					stops_index: 'static/catalog/stops.json',
					stops_prefix: 'static/stops-v2',
				},
			}),
			basemap: 'static/custom-basemap.json',
		} as Manifest;
		const routesIndex = { generated_utc: ISO, routes: [] };
		const route = { generated_utc: ISO, id: 'A/B' };
		const stopsIndex = { generated_utc: ISO, stops: [] };
		const stop = {
			generated_utc: ISO,
			id: '../é',
			name: 'É',
			lat: 45.5,
			lon: -73.5,
		};
		const basemap = {
			url: 'pmtiles://example.test/stm.pmtiles',
			attribution: 'STM',
			generated_utc: ISO,
		};
		const payloads: Record<string, unknown> = {
			'static/catalog/routes.json': routesIndex,
			'static/routes-v2/A%2FB.json': route,
			'static/catalog/stops.json': stopsIndex,
			'static/stops-v2/..%2F%C3%A9.json': stop,
			'static/custom-basemap.json': basemap,
		};
		const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
			const path = String(input).replace('/data/v1/stm/', '');
			const payload = payloads[path];
			if (payload === undefined) throw new Error(`unexpected URL ${String(input)}`);
			return json(payload);
		});
		const controller = new AbortController();
		const ctx = {
			fetch: request as unknown as typeof fetch,
			manifest: authoritativeManifest,
			signal: controller.signal,
		};

		await expect(r2Adapter.static.routesIndex(ctx)).resolves.toEqual(routesIndex);
		await expect(r2Adapter.static.route('A/B', ctx)).resolves.toEqual(route);
		await expect(r2Adapter.static.stopsIndex(ctx)).resolves.toEqual(stopsIndex);
		await expect(r2Adapter.static.stop('../é', ctx)).resolves.toEqual(stop);
		await expect(r2Adapter.basemap.get(ctx)).resolves.toEqual(basemap);

		expect(request.mock.calls.map(([input]) => String(input).replace('/data/v1/stm/', ''))).toEqual(
			[
				'static/catalog/routes.json',
				'static/routes-v2/A%2FB.json',
				'static/catalog/stops.json',
				'static/stops-v2/..%2F%C3%A9.json',
				'static/custom-basemap.json',
			],
		);
		for (const [, init] of request.mock.calls) {
			expect(init).toEqual({
				headers: { accept: 'application/json' },
				cache: 'default',
				signal: controller.signal,
			});
		}
	});

	it('keeps required roots strict while default entity and basemap 404s resolve null', async () => {
		const authoritativeManifest = {
			...manifest(),
			basemap: null,
		} as Manifest;
		const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({}, 404));
		const ctx = {
			fetch: request as unknown as typeof fetch,
			manifest: authoritativeManifest,
		};

		await expect(r2Adapter.static.routesIndex(ctx)).rejects.toThrow(
			'[v1.static.routesIndex] expected file not found at /data/v1/stm/static/routes_index.json',
		);
		await expect(r2Adapter.static.stopsIndex(ctx)).rejects.toThrow(
			'[v1.static.stopsIndex] expected file not found at /data/v1/stm/static/stops_index.json',
		);
		await expect(r2Adapter.static.route('97', ctx)).resolves.toBeNull();
		await expect(r2Adapter.static.stop('123', ctx)).resolves.toBeNull();
		await expect(r2Adapter.basemap.get(ctx)).resolves.toBeNull();

		expect(request.mock.calls.map(([input]) => String(input))).toEqual([
			'/data/v1/stm/static/routes_index.json',
			'/data/v1/stm/static/stops_index.json',
			'/data/v1/stm/static/routes/97.json',
			'/data/v1/stm/static/stops/123.json',
			'/data/v1/stm/static/basemap.json',
		]);
	});
});
