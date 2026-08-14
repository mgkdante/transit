import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	ctx: { fetch: vi.fn() },
	getProvenance: vi.fn(),
	getDataHealth: vi.fn(),
	getHistoricAvailability: vi.fn(),
	serverV1Context: vi.fn(),
}));

vi.mock('$lib/v1/repositories/provenance', () => ({
	getProvenance: (...args: unknown[]) => harness.getProvenance(...args),
}));

vi.mock('$lib/v1/repositories/dataHealth', () => ({
	getDataHealth: (...args: unknown[]) => harness.getDataHealth(...args),
}));

vi.mock('$lib/v1/repositories/historic', () => ({
	getHistoricAvailability: (...args: unknown[]) => harness.getHistoricAvailability(...args),
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
		url: new URL('https://transit.yesid.dev/status'),
		fetch: vi.fn(),
		locals: { v1Cache: new Map() },
		platform: undefined,
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	harness.getProvenance.mockReset();
	harness.getDataHealth.mockReset();
	harness.getHistoricAvailability.mockReset();
	harness.serverV1Context.mockReset().mockReturnValue(harness.ctx);
});

describe('/status server seeds', () => {
	it('starts all honesty reads concurrently through one request context', async () => {
		const provenance = { generated_utc: '2026-07-14T12:00:00Z', freshness: [] };
		const dataHealth = { generated_utc: '2026-07-14T12:00:00Z', lanes: [] };
		const history = { generated_utc: '2026-07-14T12:00:00Z', families: [] };
		const provenanceRead = deferred<typeof provenance>();
		const dataHealthRead = deferred<typeof dataHealth>();
		const historyRead = deferred<typeof history>();
		harness.getProvenance.mockReturnValue(provenanceRead.promise);
		harness.getDataHealth.mockReturnValue(dataHealthRead.promise);
		harness.getHistoricAvailability.mockReturnValue(historyRead.promise);

		const pending = load(event());

		expect(harness.serverV1Context).toHaveBeenCalledTimes(1);
		expect(harness.getProvenance).toHaveBeenCalledWith(harness.ctx);
		expect(harness.getDataHealth).toHaveBeenCalledWith(harness.ctx);
		expect(harness.getHistoricAvailability).toHaveBeenCalledWith(harness.ctx);

		provenanceRead.resolve(provenance);
		dataHealthRead.resolve(dataHealth);
		historyRead.resolve(history);

		await expect(pending).resolves.toEqual({
			provenanceSeed: { key: 'provenance', data: provenance },
			dataHealthSeed: { key: 'data-health', data: dataHealth },
			historicAvailabilitySeed: { key: 'historic-availability', data: history },
		});
	});

	it('keeps successful seeds when one independent honesty read fails', async () => {
		const provenance = { generated_utc: '2026-07-14T12:00:00Z', freshness: [] };
		const history = { generated_utc: '2026-07-14T12:00:00Z', families: [] };
		harness.getProvenance.mockResolvedValue(provenance);
		harness.getDataHealth.mockRejectedValue(new Error('live tier unavailable'));
		harness.getHistoricAvailability.mockResolvedValue(history);

		await expect(load(event())).resolves.toEqual({
			provenanceSeed: { key: 'provenance', data: provenance },
			dataHealthSeed: null,
			historicAvailabilitySeed: { key: 'historic-availability', data: history },
		});
	});
});
