import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/v1/adapter', () => ({
	adapter: { manifest: { get: vi.fn() } },
}));

vi.mock('$lib/v1/config', () => ({
	resolveUrl: (path: string) => `/data/v1/stm/${path}`,
}));

import { getManifestFresh } from './manifest';

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
	vi.unstubAllGlobals();
});

describe('getManifestFresh', () => {
	it('uses normal HTTP cache semantics on one stable manifest URL', async () => {
		const request = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(JSON.stringify(manifest()), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		);
		vi.stubGlobal('fetch', request);

		await expect(getManifestFresh()).resolves.toMatchObject({ provider: 'stm' });

		expect(request).toHaveBeenCalledWith('/data/v1/stm/manifest.json');
		expect(String(request.mock.calls[0]?.[0])).not.toContain('_=');
	});
});
