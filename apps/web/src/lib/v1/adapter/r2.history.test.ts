import { describe, expect, it, vi } from 'vitest';
import { HistoryArtifactContractError } from '$lib/v1/history';
import { sha256Hex } from '$lib/v1/http';
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

function pointIndex(family: 'hotspots' | 'repeat_offenders', refs: unknown[] = []) {
	const dates = refs
		.map((ref) => (ref as { coverage_start?: unknown }).coverage_start)
		.filter((date): date is string => typeof date === 'string');
	return {
		generated_utc: ISO,
		family,
		selection_mode: 'date',
		entity_id: null,
		collection_generation_id: GENERATION,
		first_available_date: dates[0] ?? null,
		last_available_date: dates.at(-1) ?? null,
		available_dates: dates,
		gaps: [],
		partitions: refs,
		metrics: [],
		methodology_version: 'history-1',
		publish_generation_id: 'published-run',
	};
}

function hotspotsDay(date = '2026-03-30') {
	return {
		generated_utc: ISO,
		date,
		hotspots: [],
		by_grain: [],
		methodology_version: 'reliability-1',
		publish_generation_id: null,
	};
}

function repeatOffendersDay(date = '2026-03-30') {
	return {
		generated_utc: ISO,
		date,
		offenders: [],
		by_grain: [],
		methodology_version: 'reliability-1',
		publish_generation_id: null,
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

async function payloadSha(value: unknown): Promise<string> {
	return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
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

		await expect(
			r2Adapter.historic.networkHistoryIndex('historic/history/network/index.json', ctx),
		).resolves.toMatchObject({
			family: 'network',
		});
		await expect(
			r2Adapter.historic.lineHistoryDirectory('historic/history/lines/index.json', ctx),
		).resolves.toMatchObject({
			family: 'lines',
		});
		await expect(
			r2Adapter.historic.stopHistoryDirectory('historic/history/stops/index.json', ctx),
		).resolves.toMatchObject({
			family: 'stops',
		});
		await expect(
			r2Adapter.historic.lineHistoryIndex('A/B', 'historic/history/lines/412f42/index.json', ctx),
		).resolves.toMatchObject({ entity_id: 'A/B' });
		await expect(
			r2Adapter.historic.stopHistoryIndex('..', 'historic/history/stops/2e2e/index.json', ctx),
		).resolves.toMatchObject({ entity_id: '..' });
		expect(request.mock.calls.map(([input]) => String(input))).toEqual([
			'/data/v1/stm/historic/history/network/index.json',
			'/data/v1/stm/historic/history/lines/index.json',
			'/data/v1/stm/historic/history/stops/index.json',
			'/data/v1/stm/historic/history/lines/412f42/index.json',
			'/data/v1/stm/historic/history/stops/2e2e/index.json',
		]);
	});

	it('reads exact versioned family, directory, and awkward-entity pointer paths', async () => {
		const network = collectionIndex('network');
		const lines = directory('lines');
		const entity = collectionIndex('lines', 'A/B');
		const networkPath = `historic/history/network/generations/${await payloadSha(network)}/index.json`;
		const directoryPath = `historic/history/lines/generations/${await payloadSha(lines)}/index.json`;
		const entityPath = `historic/history/lines/412f42/generations/${await payloadSha(entity)}/index.json`;
		const request = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith(`/${networkPath}`)) return json(network);
			if (url.endsWith(`/${directoryPath}`)) return json(lines);
			if (url.endsWith(`/${entityPath}`)) return json(entity);
			throw new Error(`unexpected URL ${url}`);
		});
		const ctx = { fetch: request as unknown as typeof fetch };

		await expect(r2Adapter.historic.networkHistoryIndex(networkPath, ctx)).resolves.toMatchObject({
			family: 'network',
		});
		await expect(
			r2Adapter.historic.lineHistoryDirectory(directoryPath, ctx),
		).resolves.toMatchObject({
			family: 'lines',
		});
		await expect(
			r2Adapter.historic.lineHistoryIndex('A/B', entityPath, ctx),
		).resolves.toMatchObject({ entity_id: 'A/B' });
		expect(request.mock.calls.map(([input]) => String(input))).toEqual([
			`/data/v1/stm/${networkPath}`,
			`/data/v1/stm/${directoryPath}`,
			`/data/v1/stm/${entityPath}`,
		]);
	});

	it('rejects a versioned pointer whose path SHA does not match the exact response bytes', async () => {
		const path = `historic/history/network/generations/${'0'.repeat(64)}/index.json`;
		const request = vi.fn(async () => json(collectionIndex('network')));

		await expect(
			r2Adapter.historic.networkHistoryIndex(path, {
				fetch: request as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path,
			message: expect.stringContaining('payload SHA-256 mismatch'),
		});
		expect(request).toHaveBeenCalledOnce();
	});

	it('rejects unsafe or cross-family pointer paths before fetch', async () => {
		const request = vi.fn(async () => json(collectionIndex('network')));
		const ctx = { fetch: request as unknown as typeof fetch };
		const versioned = `generations/${'b'.repeat(64)}/index.json`;

		await expect(
			r2Adapter.historic.networkHistoryIndex(`historic/history/lines/${versioned}`, ctx),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.lineHistoryDirectory(`historic/history/stops/${versioned}`, ctx),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.lineHistoryIndex('A/B', `historic/history/lines/2e2e/${versioned}`, ctx),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.lineHistoryIndex(
				'A/B',
				`historic/history/lines/412f42/${versioned}?raw=1`,
				ctx,
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(request).not.toHaveBeenCalled();
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

		await r2Adapter.historic.lineHistoryDirectory('historic/history/lines/index.json', ctx);
		await r2Adapter.historic.lineHistoryDirectory('historic/history/lines/index.json', ctx);

		const urls = request.mock.calls.map(([input]) => String(input));
		expect(urls[0]).toMatch(
			/^\/data\/v1\/stm\/historic\/history\/lines\/index\.json\?history_refresh=/,
		);
		expect(urls[1]).toMatch(
			/^\/data\/v1\/stm\/historic\/history\/lines\/index\.json\?history_refresh=/,
		);
		expect(urls[1]).not.toBe(urls[0]);
	});

	it('cache-busts a fixed entity-index URL when recovery reloads the stale child', async () => {
		const controller = new AbortController();
		const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.cache).toBe('reload');
			expect(init?.signal).toBe(controller.signal);
			return json(collectionIndex('lines', 'A/B'));
		});

		await expect(
			r2Adapter.historic.lineHistoryIndex('A/B', 'historic/history/lines/412f42/index.json', {
				fetch: request as unknown as typeof fetch,
				signal: controller.signal,
				freshHistoryParent: true,
			}),
		).resolves.toMatchObject({ entity_id: 'A/B' });

		expect(String(request.mock.calls[0]?.[0])).toMatch(
			/^\/data\/v1\/stm\/historic\/history\/lines\/412f42\/index\.json\?history_refresh=/,
		);
	});

	it('keeps every new discovery/index/partition 404 transport-null', async () => {
		const request = vi.fn(async () => json({}, 404));
		const ctx = { fetch: request as unknown as typeof fetch };
		const path = `historic/history/network/generations/${GENERATION}/2026-03.json`;

		await expect(r2Adapter.historic.historyIndex(ctx)).resolves.toBeNull();
		await expect(
			r2Adapter.historic.networkHistoryIndex('historic/history/network/index.json', ctx),
		).resolves.toBeNull();
		await expect(
			r2Adapter.historic.lineHistoryDirectory('historic/history/lines/index.json', ctx),
		).resolves.toBeNull();
		await expect(
			r2Adapter.historic.stopHistoryDirectory('historic/history/stops/index.json', ctx),
		).resolves.toBeNull();
		await expect(
			r2Adapter.historic.lineHistoryIndex('A/B', 'historic/history/lines/412f42/index.json', ctx),
		).resolves.toBeNull();
		await expect(
			r2Adapter.historic.stopHistoryIndex('..', 'historic/history/stops/2e2e/index.json', ctx),
		).resolves.toBeNull();
		await expect(r2Adapter.historic.networkHistoryPartition(path, ctx)).resolves.toBeNull();
	});

	it('reads exact immutable point indexes and preserves raw day bytes and signals', async () => {
		const controller = new AbortController();
		const hotspotsIndex = pointIndex('hotspots');
		const repeatIndex = pointIndex('repeat_offenders');
		const hotspotsIndexPath = `historic/history/hotspots/generations/${await payloadSha(hotspotsIndex)}/index.json`;
		const repeatIndexPath = `historic/history/repeat_offenders/generations/${await payloadSha(repeatIndex)}/index.json`;
		const hotspots = hotspotsDay();
		const repeat = repeatOffendersDay();
		const hotspotsText = ` ${JSON.stringify(hotspots)}\n`;
		const repeatText = `${JSON.stringify(repeat)}\n`;
		const hotspotsSha = await sha256Hex(new TextEncoder().encode(hotspotsText));
		const repeatSha = await sha256Hex(new TextEncoder().encode(repeatText));
		const hotspotsPath = `historic/history/hotspots/generations/${hotspotsSha}/${hotspots.date}.json`;
		const repeatPath = `historic/history/repeat_offenders/generations/${repeatSha}/${repeat.date}.json`;
		const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.signal).toBe(controller.signal);
			const url = String(input);
			if (url.endsWith(`/${hotspotsIndexPath}`)) return json(hotspotsIndex);
			if (url.endsWith(`/${repeatIndexPath}`)) return json(repeatIndex);
			if (url.endsWith(`/${hotspotsPath}`)) return new Response(hotspotsText);
			if (url.endsWith(`/${repeatPath}`)) return new Response(repeatText);
			throw new Error(`unexpected URL ${url}`);
		});
		const ctx = {
			fetch: request as unknown as typeof fetch,
			cache: new Map<string, unknown>(),
			signal: controller.signal,
		};

		await expect(r2Adapter.historic.hotspotsHistoryIndex(hotspotsIndexPath, ctx)).resolves.toEqual(
			hotspotsIndex,
		);
		await expect(
			r2Adapter.historic.repeatOffendersHistoryIndex(repeatIndexPath, ctx),
		).resolves.toEqual(repeatIndex);
		const rawHotspots = await r2Adapter.historic.hotspotsHistoryDay(
			hotspots.date,
			hotspotsPath,
			ctx,
		);
		const rawRepeat = await r2Adapter.historic.repeatOffendersHistoryDay(
			repeat.date,
			repeatPath,
			ctx,
		);

		expect(new TextDecoder().decode(rawHotspots?.bytes)).toBe(hotspotsText);
		expect(new TextDecoder().decode(rawRepeat?.bytes)).toBe(repeatText);
		expect(rawHotspots?.value.date).toBe(hotspots.date);
		expect(rawRepeat?.value.date).toBe(repeat.date);
		expect(ctx.cache.size).toBe(0);
	});

	it('rejects unsafe, mutable, cross-family, and date-mismatched point paths before fetch', async () => {
		const request = vi.fn(async () => json(pointIndex('hotspots')));
		const ctx = { fetch: request as unknown as typeof fetch };
		const sha = 'f'.repeat(64);
		const date = '2026-03-30';

		await expect(
			r2Adapter.historic.hotspotsHistoryIndex('historic/history/hotspots/index.json', ctx),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.hotspotsHistoryIndex(
				`historic/history/repeat_offenders/generations/${sha}/index.json`,
				ctx,
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.hotspotsHistoryDay(
				date,
				`historic/history/hotspots/generations/${sha}/2026-03-29.json`,
				ctx,
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.repeatOffendersHistoryDay(
				date,
				`historic/history/hotspots/generations/${sha}/${date}.json`,
				ctx,
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		await expect(
			r2Adapter.historic.repeatOffendersHistoryDay(
				date,
				`historic/history/repeat_offenders/generations/${sha}/${date}.json?raw=1`,
				ctx,
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(request).not.toHaveBeenCalled();
	});

	it('cache-busts one point-index parent refresh and keeps point 404s transport-null', async () => {
		const index = pointIndex('hotspots');
		const path = `historic/history/hotspots/generations/${await payloadSha(index)}/index.json`;
		const dayPath = `historic/history/hotspots/generations/${'a'.repeat(64)}/2026-03-30.json`;
		const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/index.json')) {
				expect(init?.cache).toBe('reload');
				return json(index);
			}
			return json({}, 404);
		});
		const freshCtx = {
			fetch: request as unknown as typeof fetch,
			freshHistoryParent: true,
		};

		await expect(r2Adapter.historic.hotspotsHistoryIndex(path, freshCtx)).resolves.toEqual(index);
		expect(String(request.mock.calls[0]?.[0])).toMatch(
			/^\/data\/v1\/stm\/historic\/history\/hotspots\/generations\/[0-9a-f]{64}\/index\.json\?history_refresh=/,
		);
		await expect(
			r2Adapter.historic.hotspotsHistoryDay('2026-03-30', dayPath, {
				fetch: request as unknown as typeof fetch,
			}),
		).resolves.toBeNull();
		await expect(
			r2Adapter.historic.repeatOffendersHistoryIndex(
				`historic/history/repeat_offenders/generations/${'b'.repeat(64)}/index.json`,
				{ fetch: async () => json({}, 404) },
			),
		).resolves.toBeNull();
	});
});
