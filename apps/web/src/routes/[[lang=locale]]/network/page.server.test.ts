import { createMemoryLiveReader } from '#lib/v1/live/__fixtures__/reader.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn(), providerId: 'octranspo', manifest: { provider: 'octranspo' } },
	getNetwork: vi.fn(),
	getNetworkTrend: vi.fn(),
	getHistoricAvailability: vi.fn(),
	getProvenance: vi.fn(),
	serverV1Context: vi.fn(),
}));

vi.mock('#lib/v1/repositories/historic.ts', () => ({
	getHistoricAvailability: (...args: unknown[]) => harness.getHistoricAvailability(...args),
	getNetworkTrend: (...args: unknown[]) => harness.getNetworkTrend(...args),
}));

vi.mock('#lib/v1/repositories/provenance.ts', () => ({
	getProvenance: (...args: unknown[]) => harness.getProvenance(...args),
}));

vi.mock('#lib/v1/serverContext.ts', () => ({
	serverV1Context: (...args: unknown[]) => harness.serverV1Context(...args),
}));

import { _loadWithReader } from './+page.server';
const reader = createMemoryLiveReader();
harness.getNetwork = reader.network;
const load = (event: Parameters<typeof _loadWithReader>[0]) => _loadWithReader(event, reader);

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
		parent: async () => ({ v1: { manifest: harness.ctx.manifest } }),
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	harness.getNetwork.mockReset();
	harness.getNetworkTrend.mockReset();
	harness.getProvenance.mockReset();
	harness.serverV1Context.mockReset().mockReturnValue(harness.ctx);
});

describe('/network server seeds', () => {
	it('does not fetch any provider data before root discovery succeeds', async () => {
		const request = event();
		request.parent = vi.fn().mockResolvedValue({ v1: null, providerId: 'octranspo' });
		await expect(load(request)).resolves.toEqual({
			networkSeed: null,
			trendSeed: null,
			provenanceSeed: null,
			historicAvailabilitySeed: null,
		});
		expect(harness.getNetwork).not.toHaveBeenCalled();
		expect(harness.getNetworkTrend).not.toHaveBeenCalled();
		expect(harness.getProvenance).not.toHaveBeenCalled();
	});
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
		await Promise.resolve();

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
			historicAvailabilitySeed: null,
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
			historicAvailabilitySeed: null,
		});
	});
});

it('seeds the history root beside the trend', async () => {
	const index = { families: [] };
	const trend = { series: [] };
	harness.getHistoricAvailability.mockResolvedValue(index);
	harness.getNetworkTrend.mockResolvedValue(trend);
	expect(await load(event())).toMatchObject({
		historicAvailabilitySeed: { key: 'historic-availability', data: index },
		trendSeed: { key: 'network-trend', data: trend },
	});
	harness.getHistoricAvailability.mockRejectedValue(new Error('absent'));
	expect(await load(event())).toMatchObject({
		historicAvailabilitySeed: null,
		trendSeed: { key: 'network-trend', data: trend },
	});
});
