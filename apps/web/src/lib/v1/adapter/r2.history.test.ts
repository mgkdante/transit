import { describe, expect, it, vi } from 'vitest';
import { HistoryArtifactContractError } from '$lib/v1/history';
import { r2Adapter } from './r2';

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
	it('resolves manifest pointers, forwards signals, and keeps page 404 transport-null', async () => {
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
			if (url.endsWith('/historic/custom-history.json')) return json(historyIndex());
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
			'/data/v1/stm/manifest.json',
			'/data/v1/stm/historic/custom-history.json',
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
});
