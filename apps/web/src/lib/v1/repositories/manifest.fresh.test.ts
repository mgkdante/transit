import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getFresh: vi.fn() }));
vi.mock('$lib/v1/adapter', () => ({
	adapter: { manifest: { get: vi.fn(), getFresh: mocks.getFresh } },
}));

import { getManifestFresh } from './manifest';
import type { AdapterCtx } from '$lib/v1/adapter';

const ISO = '2026-07-15T12:00:00Z';

function manifest() {
	return {
		provider: 'stm',
		display_name: 'STM',
		bbox: [-74, 45, -73, 46],
		attribution: 'STM',
		dataset_version: 'v1',
		labels: {},
		files: { live: { generated_utc: ISO } },
		surfaces: [],
	};
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('getManifestFresh', () => {
	it('delegates the fresh read and its context to the manifest port', async () => {
		const ctx: AdapterCtx = { cache: new Map<string, unknown>() };
		mocks.getFresh.mockResolvedValue(manifest());

		await expect(getManifestFresh(ctx)).resolves.toMatchObject({ provider: 'stm' });

		expect(mocks.getFresh).toHaveBeenCalledOnce();
		expect(mocks.getFresh).toHaveBeenCalledWith(ctx);
	});
});
