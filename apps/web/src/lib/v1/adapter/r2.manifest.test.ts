import { afterEach, describe, expect, it, vi } from 'vitest';
import { r2Adapter } from './r2';
import {
	clearBrowserAdapterManifestForTests,
	installBrowserAdapterManifest,
} from './browserManifest';

vi.mock('$app/environment', () => ({ browser: true }));

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

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('r2 manifest memo', () => {
	afterEach(() => {
		clearBrowserAdapterManifestForTests();
		vi.unstubAllGlobals();
	});

	it('uses the booted browser manifest for context-free repository reads', async () => {
		const booted = {
			...manifest(),
			files: {
				live: { generated_utc: ISO },
				static: { routes_index: 'static/routes_index.json' },
			},
		};
		installBrowserAdapterManifest(() => booted as never);
		const request = vi.fn(async (input: RequestInfo | URL) => {
			expect(String(input)).toContain('/static/routes_index.json');
			return json({ generated_utc: ISO, routes: [] });
		});
		vi.stubGlobal('fetch', request);

		await expect(r2Adapter.static.routesIndex()).resolves.toMatchObject({ routes: [] });

		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls.some(([input]) => String(input).endsWith('/manifest.json'))).toBe(
			false,
		);
	});

	it('shares one pending manifest request between concurrent callers', async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const request = vi.fn(async () => {
			await gate;
			return json(manifest());
		});
		const ctx = {
			fetch: request as unknown as typeof fetch,
			cache: new Map<string, unknown>(),
		};

		const reads = Promise.all([r2Adapter.manifest.get(ctx), r2Adapter.manifest.get(ctx)]);
		await vi.waitFor(() => expect(request).toHaveBeenCalled());
		release?.();
		const [first, second] = await reads;

		expect(request).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it('evicts a rejected pending request so a later caller can retry', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(json({ error: 'temporary failure' }, 503))
			.mockResolvedValueOnce(json(manifest()));
		const ctx = {
			fetch: request as unknown as typeof fetch,
			cache: new Map<string, unknown>(),
		};

		await expect(r2Adapter.manifest.get(ctx)).rejects.toThrow('[v1.manifest] HTTP 503');
		await expect(r2Adapter.manifest.get(ctx)).resolves.toMatchObject({ provider: 'stm' });

		expect(request).toHaveBeenCalledTimes(2);
	});
});
