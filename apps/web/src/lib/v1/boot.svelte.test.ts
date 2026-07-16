import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { r2Adapter } from '$lib/v1/adapter/r2';
import { clearBrowserAdapterManifestForTests } from '$lib/v1/adapter/browserManifest';
import OptionalV1ContextHarness from './__fixtures__/OptionalV1ContextHarness.svelte';

const ISO = '2026-07-15T12:00:00Z';
const manifest = {
	provider: 'stm',
	display_name: 'STM',
	bbox: [-74, 45, -73, 46],
	attribution: 'STM',
	dataset_version: 'v1',
	labels: {},
	files: {
		live: { generated_utc: ISO },
		static: { routes_index: 'static/routes_index.json' },
	},
	surfaces: [],
};

const json = (body: unknown) =>
	new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('optional root v1 context recovery', () => {
	afterEach(() => {
		clearBrowserAdapterManifestForTests();
		vi.unstubAllGlobals();
	});

	it('falls back to the public manifest while the root context is still pending', async () => {
		render(OptionalV1ContextHarness, { props: { context: undefined } });
		const request = vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith('/manifest.json')
				? json(manifest)
				: json({ generated_utc: ISO, routes: [] }),
		);
		vi.stubGlobal('fetch', request);

		await expect(r2Adapter.static.routesIndex()).resolves.toMatchObject({ routes: [] });
		expect(request).toHaveBeenCalledTimes(2);
	});
});
