import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn() },
	getRoute: vi.fn(),
	getRouteReliability: vi.fn(),
	serverV1Context: vi.fn(),
	loadLineHistorySeed: vi.fn(),
	Clusters: () => undefined,
}));

vi.mock('$lib/v1/repositories/static', () => ({
	getRoute: (...args: unknown[]) => harness.getRoute(...args),
}));

vi.mock('$lib/v1/repositories/historic', () => ({
	getRouteReliability: (...args: unknown[]) => harness.getRouteReliability(...args),
}));

vi.mock('$lib/v1/serverContext', () => ({
	serverV1Context: (...args: unknown[]) => harness.serverV1Context(...args),
}));

vi.mock('$lib/features/lines/reliability/data/lineHistoryResource.svelte', () => ({
	loadLineHistorySeed: (...args: unknown[]) => harness.loadLineHistorySeed(...args),
}));
vi.mock('$lib/features/lines/reliability/RouteReliabilityClusters.svelte', () => ({
	default: harness.Clusters,
}));

import { load } from './+page.server';
import { load as loadUniversal } from './+page';

function event(id = '24'): Parameters<typeof load>[0] {
	return {
		params: { id },
		url: new URL(`https://transit.yesid.dev/lines/${id}`),
		fetch: vi.fn(),
		locals: { v1Cache: new Map() },
		platform: undefined,
		request: new Request(`https://transit.yesid.dev/lines/${id}`),
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	harness.getRoute.mockReset();
	harness.getRouteReliability.mockReset().mockResolvedValue(null);
	harness.serverV1Context.mockReset().mockReturnValue(harness.ctx);
	harness.loadLineHistorySeed.mockReset().mockResolvedValue(null);
});

describe('/lines/[id] server identity seed', () => {
	it.each(['week', 'month'] as const)(
		'defers an unavailable %s grain to the existing correction owner',
		async (grain) => {
			const data = {
				seed: { id: '24', name: '24' },
				routeSeed: null,
				reliabilitySeed: {
					key: '24',
					data: {
						id: '24',
						generated_utc: '2026-01-31T12:00:00Z',
						periods: [{ grain: 'day', date: '2026-01-20', otp_pct: 80 }],
					},
				},
				lineHistorySeed: null,
			};
			const request = {
				data,
				url: new URL(`https://transit.yesid.dev/lines/24?tab=reliability&grain=${grain}`),
			} as Parameters<typeof loadUniversal>[0];
			expect((await loadUniversal(request))?.initialClusters).toBeUndefined();
			data.reliabilitySeed.data.periods.push({ grain, date: '2026-01-20', otp_pct: 60 });
			expect((await loadUniversal(request))?.initialClusters).toBe(harness.Clusters);
		},
	);

	it.each([
		null,
		{
			entityId: '24',
			request: { hasFrom: true, hasTo: true, rawFrom: 'bad', rawTo: '2026-01-20' },
			index: null,
			resolved: null,
			result: null,
		},
	])('keeps explicit unaccepted history on its existing lazy fallback', async (lineHistorySeed) => {
		const result = await loadUniversal({
			data: {
				seed: { id: '24', name: '24' },
				routeSeed: null,
				reliabilitySeed: null,
				lineHistorySeed,
			},
			url: new URL('https://transit.yesid.dev/lines/24?tab=reliability&from=bad&to=2026-01-20'),
		} as Parameters<typeof loadUniversal>[0]);
		expect(result?.initialClusters).toBeUndefined();
		expect(result?.initialImportFailed).toBe(false);
	});

	it('returns an explicit universal import failure for the pane retry owner', async () => {
		vi.resetModules();
		vi.doMock('$lib/features/lines/reliability/RouteReliabilityClusters.svelte', () => {
			throw new Error('module unavailable');
		});
		try {
			const { load: failingLoad } = await import('./+page');
			const result = await failingLoad({
				data: {
					seed: { id: '24', name: '24' },
					routeSeed: null,
					reliabilitySeed: null,
					lineHistorySeed: null,
				},
				url: new URL('https://transit.yesid.dev/lines/24?tab=reliability'),
			} as Parameters<typeof failingLoad>[0]);
			expect(result?.initialClusters).toBeUndefined();
			expect(result?.initialImportFailed).toBe(true);
		} finally {
			vi.doMock('$lib/features/lines/reliability/RouteReliabilityClusters.svelte', () => ({
				default: harness.Clusters,
			}));
			vi.resetModules();
		}
	});

	it('loads only explicitly selected reliability history through the same request context', async () => {
		const request = event('A/B');
		request.url = new URL(
			'https://transit.yesid.dev/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		const history = {
			entityId: 'A/B',
			request: { hasFrom: true, hasTo: true, rawFrom: '2026-01-31', rawTo: '2026-02-01' },
			index: null,
			resolved: null,
			result: null,
		};
		harness.loadLineHistorySeed.mockResolvedValue(history);
		const result = await load(request);
		expect(result?.lineHistorySeed).toBeNull();
		expect(harness.loadLineHistorySeed).toHaveBeenCalledWith('A/B', history.request, {
			...harness.ctx,
			signal: request.request.signal,
		});
	});

	it.each(['complete', 'partial', 'no_data'] as const)(
		'forwards an accepted selected %s result without changing its provenance',
		async (status) => {
			const request = event();
			request.url = new URL(
				'https://transit.yesid.dev/lines/24?tab=reliability&from=2026-01-10&to=2026-01-20',
			);
			const history = {
				entityId: '24',
				request: { hasFrom: true, hasTo: true, rawFrom: '2026-01-10', rawTo: '2026-01-20' },
				index: {
					entity_id: '24',
					generated_utc: '2026-01-31T12:00:00Z',
					collection_generation_id: 'a'.repeat(64),
				},
				resolved: {
					canonicalWindow: { from: '2026-01-10', to: '2026-01-20' },
					selection: { from: '2026-01-10', to: '2026-01-20' },
					correction: null,
					intersectingGaps: [],
				},
				result: { status, value: null },
			};
			harness.loadLineHistorySeed.mockResolvedValue(history);
			expect((await load(request))?.lineHistorySeed).toBe(history);
		},
	);

	it.each(['', '?tab=schedule', '?tab=reliability', '?from=2026-01-31&to=2026-02-01'])(
		'does not add server range reads to %s',
		async (query) => {
			const request = event();
			request.url = new URL('https://transit.yesid.dev/lines/24' + query);
			await load(request);
			expect(harness.loadLineHistorySeed).not.toHaveBeenCalled();
		},
	);

	it('keeps current resource seeds when server history fails instead of inventing a successful empty range', async () => {
		const request = event();
		request.url = new URL(
			'https://transit.yesid.dev/lines/24?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		const reliability = { id: '24', generated_utc: '2026-02-02T12:00:00Z' };
		harness.getRouteReliability.mockResolvedValue(reliability);
		harness.loadLineHistorySeed.mockRejectedValue(new Error('retained artifact unavailable'));
		const result = await load(request);
		expect(result?.lineHistorySeed).toBeNull();
		expect(result?.reliabilitySeed).toEqual({ key: '24', data: reliability });
	});

	it.each(['detail', 'schedule', 'reliability'])(
		'resolves the universal constructor only for the initial %s tab',
		async (tab) => {
			const data = {
				seed: { id: '24', name: '24 Sherbrooke' },
				routeSeed: null,
				reliabilitySeed: null,
				lineHistorySeed: null,
			};
			const result = await loadUniversal({
				data,
				url: new URL('https://transit.yesid.dev/lines/24?tab=' + tab),
			} as Parameters<typeof loadUniversal>[0]);
			expect(result).toEqual({
				...data,
				initialClusters: tab === 'reliability' ? harness.Clusters : undefined,
				initialImportFailed: false,
			});
		},
	);

	it.each(['unknown', 'detail'])(
		'redirects the noncanonical %s tab before fetching data and preserves unrelated params',
		async (tab) => {
			const request = event();
			request.url = new URL(
				`https://transit.yesid.dev/lines/24?tab=${tab}&from=2026-01-31&to=2026-02-01`,
			);

			await expect(load(request)).rejects.toMatchObject({
				status: 308,
				location: '/lines/24?from=2026-01-31&to=2026-02-01',
			});
			expect(harness.getRoute).not.toHaveBeenCalled();
			expect(harness.getRouteReliability).not.toHaveBeenCalled();
		},
	);

	it('serializes route and reliability together so hydration inserts neither after first paint', async () => {
		const route = {
			id: '24',
			long: '  Sherbrooke  ',
			generated_utc: '2026-07-14T12:00:00Z',
			directions: [{ dir: 0, shape: { type: 'LineString' } }],
			service_periods: [{ shift: 'day' }],
		};
		const reliability = {
			id: '24',
			generated_utc: '2026-07-14T12:00:00Z',
			periods: [{ grain: 'day', date: '2026-07-13', otp_pct: 80 }],
		};
		harness.getRoute.mockResolvedValue(route);
		harness.getRouteReliability.mockResolvedValue(reliability);

		const result = await load(event());

		expect(result).toEqual({
			seed: { id: '24', name: '24 Sherbrooke' },
			routeSeed: { key: '24', data: route },
			reliabilitySeed: { key: '24', data: reliability },
			lineHistorySeed: null,
		});
		if (!result) throw new Error('expected a route identity seed');
		expect(Object.keys(result)).toEqual([
			'seed',
			'routeSeed',
			'reliabilitySeed',
			'lineHistorySeed',
		]);
		expect(Object.keys(result.seed)).toEqual(['id', 'name']);
		expect(harness.getRoute).toHaveBeenCalledWith('24', harness.ctx);
		expect(harness.getRouteReliability).toHaveBeenCalledWith('24', harness.ctx);
		expect(harness.serverV1Context).toHaveBeenCalledTimes(1);
	});

	it('uses the route ID when the snapshot exists without a public long name', async () => {
		harness.getRoute.mockResolvedValue({ id: '24', long: '   ' });

		await expect(load(event())).resolves.toEqual({
			seed: { id: '24', name: '24' },
			routeSeed: { key: '24', data: { id: '24', long: '   ' } },
			reliabilitySeed: { key: '24', data: null },
			lineHistorySeed: null,
		});
	});

	it('uses the deterministic ID fallback for a missing route', async () => {
		harness.getRoute.mockResolvedValue(null);

		await expect(load(event('999'))).resolves.toEqual({
			seed: { id: '999', name: '999' },
			routeSeed: { key: '999', data: null },
			reliabilitySeed: { key: '999', data: null },
			lineHistorySeed: null,
		});
	});

	it('keeps the reliability seed when the independent route read fails', async () => {
		const reliability = { id: '747', generated_utc: '2026-07-14T12:00:00Z' };
		harness.getRoute.mockRejectedValue(new Error('data proxy unavailable'));
		harness.getRouteReliability.mockResolvedValue(reliability);

		await expect(load(event('747'))).resolves.toEqual({
			seed: { id: '747', name: '747' },
			routeSeed: null,
			reliabilitySeed: { key: '747', data: reliability },
			lineHistorySeed: null,
		});
	});

	it('keeps the route seed when the independent reliability read fails', async () => {
		const route = { id: '24', long: 'Sherbrooke' };
		harness.getRoute.mockResolvedValue(route);
		harness.getRouteReliability.mockRejectedValue(new Error('historic tier unavailable'));

		await expect(load(event())).resolves.toEqual({
			seed: { id: '24', name: '24 Sherbrooke' },
			routeSeed: { key: '24', data: route },
			reliabilitySeed: null,
			lineHistorySeed: null,
		});
	});

	it('forwards the seed through the thin route mount', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/[[lang=locale]]/lines/[id]/+page.svelte'),
			'utf8',
		);

		expect(source).toContain('id={data.seed.id}');
		expect(source).toContain('seed={data.seed}');
		expect(source).toContain('routeSeed={data.routeSeed ?? undefined}');
		expect(source).toContain('reliabilitySeed={data.reliabilitySeed ?? undefined}');
		expect(source).not.toContain('id={data.id}');
	});
});
