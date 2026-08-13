import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn() },
	getRoute: vi.fn(),
	getRouteReliability: vi.fn(),
	serverV1Context: vi.fn(),
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

import { load } from './+page.server';

function event(id = '24'): Parameters<typeof load>[0] {
	return {
		params: { id },
		url: new URL(`https://transit.yesid.dev/lines/${id}`),
		fetch: vi.fn(),
		locals: { v1Cache: new Map() },
		platform: undefined,
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	harness.getRoute.mockReset();
	harness.getRouteReliability.mockReset().mockResolvedValue(null);
	harness.serverV1Context.mockReset().mockReturnValue(harness.ctx);
});

describe('/lines/[id] server identity seed', () => {
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
		});
		if (!result) throw new Error('expected a route identity seed');
		expect(Object.keys(result)).toEqual(['seed', 'routeSeed', 'reliabilitySeed']);
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
		});
	});

	it('uses the deterministic ID fallback for a missing route', async () => {
		harness.getRoute.mockResolvedValue(null);

		await expect(load(event('999'))).resolves.toEqual({
			seed: { id: '999', name: '999' },
			routeSeed: { key: '999', data: null },
			reliabilitySeed: { key: '999', data: null },
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
