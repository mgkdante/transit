import { afterEach, describe, expect, it, vi } from 'vitest';
import config, {
	DEV_BASEMAP_PREVIEW_SOURCE,
	DEV_MANIFEST_PREVIEW_SOURCE,
	ISLAND_CENTERED_BASEMAP_BBOX,
	previewBasemapForDirectDevData,
	previewManifestForIslandCenteredBasemap,
} from '../../vite.config';
import type { UserConfig, ViteDevServer } from 'vite';

type PreviewMiddleware = (
	req: { method?: string },
	res: PreviewResponse,
	next: () => void,
) => void | Promise<void>;

interface PreviewResponse {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
}

interface PreviewPlugin {
	name?: string;
	configureServer?: (server: ViteDevServer) => unknown;
}

function responseHarness() {
	const headers = new Map<string, string>();
	let body = '';
	const response: PreviewResponse = {
		statusCode: 0,
		setHeader(name, value) {
			headers.set(name.toLowerCase(), value);
		},
		end(value = '') {
			body = value;
		},
	};
	return { response, headers, body: () => body };
}

async function previewMiddleware(path: string): Promise<PreviewMiddleware> {
	const dev = await resolveConfig(false, 'serve');
	const plugins = (dev.plugins ?? []) as unknown as PreviewPlugin[];
	const plugin = plugins.find(
		(candidate) => candidate?.name === 'transit-dev-island-centered-manifest-preview',
	);
	const configureServer = plugin?.configureServer;
	if (!configureServer) {
		throw new Error('dev preview plugin configureServer hook not found');
	}

	const handlers = new Map<string, PreviewMiddleware>();
	const server = {
		middlewares: {
			use: (registeredPath: string, handler: PreviewMiddleware) => {
				handlers.set(registeredPath, handler);
			},
		},
	} as unknown as ViteDevServer;
	configureServer(server);

	const handler = handlers.get(path);
	if (!handler) throw new Error(`dev preview middleware not registered for ${path}`);
	return handler;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('vite production chunk contract', () => {
	it('keeps the heavy map runtime isolated behind the map route', async () => {
		const client = await resolveConfig(false);
		const build = Array.isArray(client) ? client[0]?.build : client.build;
		const output = build?.rollupOptions?.output;
		const firstOutput = Array.isArray(output) ? output[0] : output;
		const manualChunks = firstOutput?.manualChunks;

		expect(build?.chunkSizeWarningLimit).toBe(1100);
		expect(typeof manualChunks).toBe('function');
		if (typeof manualChunks !== 'function') return;

		expect(manualChunks('/repo/node_modules/maplibre-gl/dist/maplibre-gl.js')).toBe(
			'vendor-maplibre',
		);
		expect(manualChunks('/repo/node_modules/pmtiles/dist/index.js')).toBe('vendor-maplibre');
		expect(manualChunks('/repo/node_modules/maplibre-gl/dist/maplibre-gl.css')).toBeUndefined();
		expect(manualChunks('/repo/src/lib/features/map/MapHero.svelte')).toBeUndefined();
	});

	it('does not emit the map vendor chunk for the SSR build', async () => {
		const ssr = await resolveConfig(true);
		const build = Array.isArray(ssr) ? ssr[0]?.build : ssr.build;
		const output = build?.rollupOptions?.output;
		const firstOutput = Array.isArray(output) ? output[0] : output;

		expect(firstOutput?.manualChunks).toBeUndefined();
	});
});

describe('vite dev snapshot preview', () => {
	it('routes the local /data/v1 contract directly to R2 with its public path shape', async () => {
		const dev = await resolveConfig(false, 'serve');
		const proxy = dev.server?.proxy?.['/data'];

		expect(proxy).toBeTypeOf('object');
		if (!proxy || typeof proxy === 'string') return;

		expect(proxy.target).toBe('https://data.yesid.dev');
		expect(proxy.rewrite?.('/data/v1/stm/manifest.json')).toBe('/v1/stm/manifest.json');
		expect(proxy.rewrite?.('/data/v1/stm/live/vehicles.json?cache=off')).toBe(
			'/v1/stm/live/vehicles.json?cache=off',
		);
	});

	it('can override only the manifest bbox so the dev map previews island-centered framing', () => {
		const manifest = {
			provider: 'stm',
			bbox: [-74.315, 45.235, -73.415, 45.865],
			files: { live: {} },
		};

		expect(previewManifestForIslandCenteredBasemap(manifest)).toEqual({
			...manifest,
			bbox: ISLAND_CENTERED_BASEMAP_BBOX,
		});
		expect(ISLAND_CENTERED_BASEMAP_BBOX).toEqual([-74.176, 45.237, -73.276, 45.867]);
	});

	it('routes the canonical manifest basemap pointer through the local R2 preview', () => {
		const manifest = {
			provider: 'stm',
			bbox: [-74.315, 45.235, -73.415, 45.865],
			basemap: 'https://transit.yesid.dev/data/v1/stm/static/basemap.json',
			files: { live: {} },
		};

		expect(previewManifestForIslandCenteredBasemap(manifest)).toEqual({
			...manifest,
			bbox: ISLAND_CENTERED_BASEMAP_BBOX,
			basemap: 'static/basemap.json',
		});
		expect(manifest.basemap).toBe('https://transit.yesid.dev/data/v1/stm/static/basemap.json');
	});

	it('loads both dev preview documents from R2 instead of the quota-limited Worker', () => {
		expect(DEV_MANIFEST_PREVIEW_SOURCE).toBe('https://data.yesid.dev/v1/stm/manifest.json');
		expect(DEV_BASEMAP_PREVIEW_SOURCE).toBe('https://data.yesid.dev/v1/stm/static/basemap.json');
	});

	it('rewrites the canonical Worker PMTiles URL through the local R2 proxy', () => {
		const descriptor = {
			format: 'pmtiles',
			url: 'https://transit.yesid.dev/data/v1/stm/static/basemap/montreal.pmtiles',
			attribution: 'OpenStreetMap contributors',
		};

		expect(previewBasemapForDirectDevData(descriptor)).toEqual({
			...descriptor,
			url: '/data/v1/stm/static/basemap/montreal.pmtiles',
		});
		expect(descriptor.url).toBe(
			'https://transit.yesid.dev/data/v1/stm/static/basemap/montreal.pmtiles',
		);
	});

	it.each(['/data/v1/stm/manifest.json', '/data/v1/stm/static/basemap.json'])(
		'returns one controlled upstream failure for %s instead of falling through',
		async (path) => {
			const request = vi.fn(async () => new Response('rate limited', { status: 429 }));
			vi.stubGlobal('fetch', request);
			const handler = await previewMiddleware(path);
			const result = responseHarness();
			const next = vi.fn();

			await handler({ method: 'GET' }, result.response, next);

			expect(request).toHaveBeenCalledTimes(1);
			expect(next).not.toHaveBeenCalled();
			expect(result.response.statusCode).toBe(429);
			expect(result.headers.get('cache-control')).toBe('no-store');
			expect(result.body()).toContain('dev preview upstream unavailable');
		},
	);

	it('returns one controlled 502 when the preview source throws', async () => {
		const request = vi.fn(async () => {
			throw new Error('R2 unavailable');
		});
		vi.stubGlobal('fetch', request);
		const handler = await previewMiddleware('/data/v1/stm/manifest.json');
		const result = responseHarness();
		const next = vi.fn();

		await handler({ method: 'GET' }, result.response, next);

		expect(request).toHaveBeenCalledTimes(1);
		expect(next).not.toHaveBeenCalled();
		expect(result.response.statusCode).toBe(502);
		expect(result.headers.get('cache-control')).toBe('no-store');
	});

	it('shares one upstream preview read across concurrent requests', async () => {
		let release!: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			release = resolve;
		});
		const request = vi.fn(() => pending);
		vi.stubGlobal('fetch', request);
		const handler = await previewMiddleware('/data/v1/stm/manifest.json');
		const first = responseHarness();
		const second = responseHarness();

		const reads = [
			handler({ method: 'GET' }, first.response, vi.fn()),
			handler({ method: 'GET' }, second.response, vi.fn()),
		];
		expect(request).toHaveBeenCalledTimes(1);

		release(
			new Response(JSON.stringify({ bbox: [-74, 45, -73, 46] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		await Promise.all(reads);

		expect(request).toHaveBeenCalledTimes(1);
		expect(first.response.statusCode).toBe(200);
		expect(second.response.statusCode).toBe(200);
	});
});

async function resolveConfig(
	isSsrBuild: boolean,
	command: 'build' | 'serve' = 'build',
): Promise<UserConfig> {
	if (typeof config === 'function') {
		const resolved = await config({
			command,
			mode: 'production',
			isSsrBuild,
			isPreview: false,
		});
		return Array.isArray(resolved) ? resolved[0] : resolved;
	}
	return Array.isArray(config) ? config[0] : config;
}
