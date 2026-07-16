import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn() },
	getRoute: vi.fn(),
	serverV1Context: vi.fn(),
}));

vi.mock('$lib/v1', () => ({
	getRoute: (...args: unknown[]) => harness.getRoute(...args),
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
		},
	);

	it('serializes the accepted route once so hydration does not fetch it again', async () => {
		const route = {
			id: '24',
			long: '  Sherbrooke  ',
			generated_utc: '2026-07-14T12:00:00Z',
			directions: [{ dir: 0, shape: { type: 'LineString' } }],
			service_periods: [{ shift: 'day' }],
		};
		harness.getRoute.mockResolvedValue(route);

		const result = await load(event());

		expect(result).toEqual({
			seed: { id: '24', name: '24 Sherbrooke' },
			routeSeed: { key: '24', data: route },
		});
		if (!result) throw new Error('expected a route identity seed');
		expect(Object.keys(result)).toEqual(['seed', 'routeSeed']);
		expect(Object.keys(result.seed)).toEqual(['id', 'name']);
		expect(harness.getRoute).toHaveBeenCalledWith('24', harness.ctx);
		expect(harness.serverV1Context).toHaveBeenCalledTimes(1);
	});

	it('uses the route ID when the snapshot exists without a public long name', async () => {
		harness.getRoute.mockResolvedValue({ id: '24', long: '   ' });

		await expect(load(event())).resolves.toEqual({
			seed: { id: '24', name: '24' },
			routeSeed: { key: '24', data: { id: '24', long: '   ' } },
		});
	});

	it('uses the deterministic ID fallback for a missing route', async () => {
		harness.getRoute.mockResolvedValue(null);

		await expect(load(event('999'))).resolves.toEqual({
			seed: { id: '999', name: '999' },
			routeSeed: { key: '999', data: null },
		});
	});

	it('uses the deterministic ID fallback when the upstream read fails', async () => {
		harness.getRoute.mockRejectedValue(new Error('data proxy unavailable'));

		await expect(load(event('747'))).resolves.toEqual({
			seed: { id: '747', name: '747' },
			routeSeed: null,
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
		expect(source).not.toContain('id={data.id}');
	});
});
