import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn() },
	getStop: vi.fn(),
	serverV1Context: vi.fn(),
}));

vi.mock('$lib/v1/repositories/static', () => ({
	getStop: (...args: unknown[]) => harness.getStop(...args),
}));

vi.mock('$lib/v1/serverContext', () => ({
	serverV1Context: (...args: unknown[]) => harness.serverV1Context(...args),
}));

import { load } from './+page.server';

function event(id = '1234'): Parameters<typeof load>[0] {
	return {
		params: { id },
		url: new URL(`https://transit.yesid.dev/stop/${id}`),
		fetch: vi.fn(),
		locals: { v1Cache: new Map() },
		platform: undefined,
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	harness.getStop.mockReset();
	harness.serverV1Context.mockReset().mockReturnValue(harness.ctx);
});

describe('/stop/[id] server identity seed', () => {
	it.each(['next', 'info', 'unknown', 'detail'])(
		'redirects the noncanonical %s tab before fetching data and preserves unrelated params',
		async (tab) => {
			const request = event();
			request.url = new URL(
				`https://transit.yesid.dev/stop/1234?tab=${tab}&from=2026-01-31&to=2026-02-01&line=51`,
			);

			await expect(load(request)).rejects.toMatchObject({
				status: 308,
				location: '/stop/1234?from=2026-01-31&to=2026-02-01&line=51',
			});
			expect(harness.getStop).not.toHaveBeenCalled();
		},
	);

	it('serializes the accepted stop once so hydration does not fetch it again', async () => {
		const stop = {
			id: '1234',
			name: '  Van Horne / Rockland  ',
			code: '56789',
			lat: 45.51,
			lon: -73.62,
			scheduled: [{ route: '24', times: ['08:00'] }],
			routes_served: ['24'],
		};
		harness.getStop.mockResolvedValue(stop);

		const result = await load(event());

		expect(result).toEqual({
			seed: { id: '1234', name: 'Van Horne / Rockland' },
			stopSeed: { key: '1234', data: stop },
		});
		if (!result) throw new Error('expected a stop identity seed');
		expect(Object.keys(result)).toEqual(['seed', 'stopSeed']);
		expect(Object.keys(result.seed)).toEqual(['id', 'name']);
		expect(harness.getStop).toHaveBeenCalledWith('1234', harness.ctx);
		expect(harness.serverV1Context).toHaveBeenCalledTimes(1);
	});

	it('uses the stop ID when the snapshot name is blank', async () => {
		harness.getStop.mockResolvedValue({ id: '1234', name: '   ' });

		await expect(load(event())).resolves.toEqual({
			seed: { id: '1234', name: '1234' },
			stopSeed: { key: '1234', data: { id: '1234', name: '   ' } },
		});
	});

	it('uses the deterministic ID fallback for a missing stop', async () => {
		harness.getStop.mockResolvedValue(null);

		await expect(load(event('9999'))).resolves.toEqual({
			seed: { id: '9999', name: '9999' },
			stopSeed: { key: '9999', data: null },
		});
	});

	it('uses the deterministic ID fallback when the upstream read fails', async () => {
		harness.getStop.mockRejectedValue(new Error('data proxy unavailable'));

		await expect(load(event('5678'))).resolves.toEqual({
			seed: { id: '5678', name: '5678' },
			stopSeed: null,
		});
	});

	it('forwards the seed through the thin stop mount', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/[[lang=locale]]/stop/[id]/+page.svelte'),
			'utf8',
		);

		expect(source).toContain('id={data.seed.id}');
		expect(source).toContain('seed={data.seed}');
		expect(source).toContain('stopSeed={data.stopSeed ?? undefined}');
		expect(source).not.toContain('id={data.id}');
	});
});
