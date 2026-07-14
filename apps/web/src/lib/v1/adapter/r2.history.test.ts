import { describe, expect, it, vi } from 'vitest';
import { HistoryArtifactContractError } from '$lib/v1/history';
import { r2Adapter } from './r2';

vi.mock('$app/environment', () => ({ browser: true }));

const ISO = '2026-03-31T12:00:00Z';
const GENERATION = 'a'.repeat(64);
const SAFE_PAGE = `historic/alerts/generations/${GENERATION}/2026-03/page-0001.json`;

function manifest(historic: Record<string, unknown> = {}) {
	return {
		provider: 'stm',
		display_name: 'STM',
		bbox: [-74, 45, -73, 46],
		attribution: 'STM',
		dataset_version: 'v1',
		labels: {},
		files: { live: { generated_utc: ISO }, historic },
		surfaces: [],
	};
}

function historyIndex() {
	return { generated_utc: ISO, families: [] };
}

function collectionIndex(family: 'network' | 'lines' | 'stops', entityId?: string) {
	return {
		generated_utc: ISO,
		family,
		selection_mode: 'range',
		entity_id: entityId ?? null,
		collection_generation_id: GENERATION,
		partitions: [],
		metrics: [],
	};
}

function directory(family: 'lines' | 'stops') {
	return {
		generated_utc: ISO,
		family,
		selection_mode: 'range',
		collection_generation_id: GENERATION,
		entities: [],
	};
}

function networkPartition() {
	return {
		generated_utc: ISO,
		month: '2026-03',
		days: [
			{
				date: '2026-03-01',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 8,
					severe_count: 1,
					sum_delay_seconds: 100,
				},
			},
		],
	};
}

function alertIndex() {
	return {
		generated_utc: ISO,
		collection_generation_id: GENERATION,
		first_available_date: null,
		last_available_date: null,
		total_alerts: 0,
		months: [],
	};
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('r2 historic collection ports', () => {
	it('keeps history root fixed, preserves Alert manifest pointers, forwards signals, and keeps page 404 transport-null', async () => {
		const controller = new AbortController();
		const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			expect(init?.signal).toBe(controller.signal);
			if (url.endsWith('/manifest.json')) {
				return json(
					manifest({
						history_index: 'historic/custom-history.json',
						alerts_index: 'historic/custom-alerts.json',
					}),
				);
			}
			if (url.endsWith('/historic/history/index.json')) return json(historyIndex());
			if (url.endsWith('/historic/custom-alerts.json')) return json(alertIndex());
			if (url.endsWith(`/${SAFE_PAGE}`)) return json({}, 404);
			throw new Error(`unexpected URL ${url}`);
		});
		const ctx = {
			fetch: request as unknown as typeof fetch,
			cache: new Map<string, unknown>(),
			signal: controller.signal,
		};

		await expect(r2Adapter.historic.historyIndex(ctx)).resolves.toMatchObject({ families: [] });
		await expect(r2Adapter.historic.alertArchiveIndex(ctx)).resolves.toMatchObject({ months: [] });
		await expect(r2Adapter.historic.alertArchivePage(SAFE_PAGE, ctx)).resolves.toBeNull();
		expect(request.mock.calls.map(([input]) => String(input))).toEqual([
			'/data/v1/stm/historic/history/index.json',
			'/data/v1/stm/manifest.json',
			'/data/v1/stm/historic/custom-alerts.json',
			`/data/v1/stm/${SAFE_PAGE}`,
		]);
	});

	it('uses contract-default index paths and returns null only for 404', async () => {
		const request = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/manifest.json')) return json(manifest());
			if (url.endsWith('/historic/history/index.json')) return json({}, 404);
			if (url.endsWith('/historic/alerts/index.json')) return json({}, 404);
			throw new Error(`unexpected URL ${url}`);
		});
		const ctx = { fetch: request as unknown as typeof fetch, cache: new Map<string, unknown>() };

		await expect(r2Adapter.historic.historyIndex(ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.alertArchiveIndex(ctx)).resolves.toBeNull();
		expect(request.mock.calls.map(([input]) => String(input))).toContain(
			'/data/v1/stm/historic/history/index.json',
		);
		expect(request.mock.calls.map(([input]) => String(input))).toContain(
			'/data/v1/stm/historic/alerts/index.json',
		);
	});

	it('throws non-404 index failures instead of treating them as rollout absence', async () => {
		const request = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/manifest.json')) return json(manifest());
			return json({}, 500);
		});

		await expect(
			r2Adapter.historic.historyIndex({
				fetch: request as unknown as typeof fetch,
				cache: new Map<string, unknown>(),
			}),
		).rejects.toThrow('HTTP 500');
	});

	it('rejects an unsafe advertised page path before fetching even the manifest', async () => {
		const request = vi.fn(async () => json(manifest()));

		await expect(
			r2Adapter.historic.alertArchivePage('https://evil.test/page.json', {
				fetch: request as unknown as typeof fetch,
			}),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(request).not.toHaveBeenCalled();
	});

	it('uses exact fixed family discovery paths and lowercase UTF-8 entity IDs', async () => {
		const controller = new AbortController();
		const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			expect(init?.signal).toBe(controller.signal);
			expect(init?.cache).toBe('force-cache');
			if (url.endsWith('/historic/history/network/index.json')) {
				return json(collectionIndex('network'));
			}
			if (url.endsWith('/historic/history/lines/index.json')) return json(directory('lines'));
			if (url.endsWith('/historic/history/stops/index.json')) return json(directory('stops'));
			if (url.endsWith('/historic/history/lines/412f42/index.json')) {
				return json(collectionIndex('lines', 'A/B'));
			}
			if (url.endsWith('/historic/history/stops/2e2e/index.json')) {
				return json(collectionIndex('stops', '..'));
			}
			throw new Error(`unexpected URL ${url}`);
		});
		const ctx = { fetch: request as unknown as typeof fetch, signal: controller.signal };

		await expect(r2Adapter.historic.networkHistoryIndex(ctx)).resolves.toMatchObject({
			family: 'network',
		});
		await expect(r2Adapter.historic.lineHistoryDirectory(ctx)).resolves.toMatchObject({
			family: 'lines',
		});
		await expect(r2Adapter.historic.stopHistoryDirectory(ctx)).resolves.toMatchObject({
			family: 'stops',
		});
		await expect(r2Adapter.historic.lineHistoryIndex('A/B', ctx)).resolves.toMatchObject({
			entity_id: 'A/B',
		});
		await expect(r2Adapter.historic.stopHistoryIndex('..', ctx)).resolves.toMatchObject({
			entity_id: '..',
		});
		expect(request.mock.calls.map(([input]) => String(input))).toEqual([
			'/data/v1/stm/historic/history/network/index.json',
			'/data/v1/stm/historic/history/lines/index.json',
			'/data/v1/stm/historic/history/stops/index.json',
			'/data/v1/stm/historic/history/lines/412f42/index.json',
			'/data/v1/stm/historic/history/stops/2e2e/index.json',
		]);
	});

	it('returns exact raw partition bytes once and never places them in the request memo', async () => {
		const path = `historic/history/network/generations/${GENERATION}/2026-03.json`;
		const text = ` ${JSON.stringify(networkPartition())}\n`;
		const request = vi.fn(async () => new Response(text, { status: 200 }));
		const cache = new Map<string, unknown>();
		const ctx = { fetch: request as unknown as typeof fetch, cache };

		const first = await r2Adapter.historic.networkHistoryPartition(path, ctx);
		const second = await r2Adapter.historic.networkHistoryPartition(path, ctx);

		expect(first?.value).toMatchObject({ month: '2026-03' });
		expect(new TextDecoder().decode(first?.bytes)).toBe(text);
		expect(second?.bytes).toEqual(first?.bytes);
		expect(request).toHaveBeenCalledTimes(2);
		expect(cache.size).toBe(0);
	});

	it('rejects unsafe or cross-entity family partition paths before fetch', async () => {
		const request = vi.fn(async () => json(networkPartition()));
		const ctx = { fetch: request as unknown as typeof fetch };

		await expect(
			r2Adapter.historic.networkHistoryPartition('https://evil.test/x.json', ctx),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.lineHistoryPartition(
				'A/B',
				`historic/history/lines/2e2e/generations/${GENERATION}/2026-03.json`,
				ctx,
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(request).not.toHaveBeenCalled();
	});

	it('fresh parent reads use a unique query plus browser cache reload', async () => {
		const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.cache).toBe('reload');
			return json(directory('lines'));
		});
		const ctx = {
			fetch: request as unknown as typeof fetch,
			freshHistoryParent: true,
		};

		await r2Adapter.historic.lineHistoryDirectory(ctx);
		await r2Adapter.historic.lineHistoryDirectory(ctx);

		const urls = request.mock.calls.map(([input]) => String(input));
		expect(urls[0]).toMatch(
			/^\/data\/v1\/stm\/historic\/history\/lines\/index\.json\?history_refresh=/,
		);
		expect(urls[1]).toMatch(
			/^\/data\/v1\/stm\/historic\/history\/lines\/index\.json\?history_refresh=/,
		);
		expect(urls[1]).not.toBe(urls[0]);
	});

	it('keeps every new discovery/index/partition 404 transport-null', async () => {
		const request = vi.fn(async () => json({}, 404));
		const ctx = { fetch: request as unknown as typeof fetch };
		const path = `historic/history/network/generations/${GENERATION}/2026-03.json`;

		await expect(r2Adapter.historic.historyIndex(ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.networkHistoryIndex(ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.lineHistoryDirectory(ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.stopHistoryDirectory(ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.lineHistoryIndex('A/B', ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.stopHistoryIndex('..', ctx)).resolves.toBeNull();
		await expect(r2Adapter.historic.networkHistoryPartition(path, ctx)).resolves.toBeNull();
	});
});
