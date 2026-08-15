import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn() },
	getNetwork: vi.fn(),
	getNetworkTrend: vi.fn(),
	getProvenance: vi.fn(),
	serverV1Context: vi.fn(),
}));

vi.mock('$lib/v1/repositories/live', () => ({
	getNetwork: (...args: unknown[]) => harness.getNetwork(...args),
}));

vi.mock('$lib/v1/repositories/historic', () => ({
	getNetworkTrend: (...args: unknown[]) => harness.getNetworkTrend(...args),
}));

vi.mock('$lib/v1/repositories/provenance', () => ({
	getProvenance: (...args: unknown[]) => harness.getProvenance(...args),
}));

vi.mock('$lib/v1/serverContext', () => ({
	serverV1Context: (...args: unknown[]) => harness.serverV1Context(...args),
}));

import { load } from './+page.server';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function event(): Parameters<typeof load>[0] {
	return {
		params: { lang: undefined },
		url: new URL('https://transit.yesid.dev/network'),
		fetch: vi.fn(),
		locals: { v1Cache: new Map() },
		platform: undefined,
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	harness.getNetwork.mockReset();
	harness.getNetworkTrend.mockReset();
	harness.getProvenance.mockReset();
	harness.serverV1Context.mockReset().mockReturnValue(harness.ctx);
});

describe('/network server seeds', () => {
	it('starts all three reads concurrently through one request-scoped context', async () => {
		const network = { generated_utc: '2026-07-14T12:00:00Z', on_time_pct: 91 };
		const trend = { generated_utc: '2026-07-14T12:00:00Z', series: [] };
		const provenance = { generated_utc: '2026-07-14T12:00:00Z', freshness: [] };
		const networkRead = deferred<typeof network>();
		const trendRead = deferred<typeof trend>();
		const provenanceRead = deferred<typeof provenance>();
		harness.getNetwork.mockReturnValue(networkRead.promise);
		harness.getNetworkTrend.mockReturnValue(trendRead.promise);
		harness.getProvenance.mockReturnValue(provenanceRead.promise);

		const pending = load(event());

		expect(harness.serverV1Context).toHaveBeenCalledTimes(1);
		expect(harness.getNetwork).toHaveBeenCalledWith(harness.ctx);
		expect(harness.getNetworkTrend).toHaveBeenCalledWith(harness.ctx);
		expect(harness.getProvenance).toHaveBeenCalledWith(harness.ctx);

		networkRead.resolve(network);
		trendRead.resolve(trend);
		provenanceRead.resolve(provenance);

		await expect(pending).resolves.toEqual({
			networkSeed: network,
			trendSeed: { key: 'network-trend', data: trend },
			provenanceSeed: { key: 'provenance', data: provenance },
		});
	});

	it('keeps successful seeds when one independent read fails', async () => {
		const network = { generated_utc: '2026-07-14T12:00:00Z', on_time_pct: 91 };
		const provenance = { generated_utc: '2026-07-14T12:00:00Z', freshness: [] };
		harness.getNetwork.mockResolvedValue(network);
		harness.getNetworkTrend.mockRejectedValue(new Error('historic tier unavailable'));
		harness.getProvenance.mockResolvedValue(provenance);

		await expect(load(event())).resolves.toEqual({
			networkSeed: network,
			trendSeed: null,
			provenanceSeed: { key: 'provenance', data: provenance },
		});
	});
});
