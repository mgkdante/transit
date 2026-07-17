import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import type { Plugin, ViteDevServer } from 'vite';

export const ISLAND_CENTERED_BASEMAP_BBOX = [-74.176, 45.237, -73.276, 45.867] as const;
export const DEV_MANIFEST_PREVIEW_SOURCE = 'https://data.yesid.dev/v1/stm/manifest.json';
export const DEV_BASEMAP_PREVIEW_SOURCE = 'https://data.yesid.dev/v1/stm/static/basemap.json';

const CANONICAL_SITE_ORIGIN = 'https://transit.yesid.dev';

function canonicalDataUrl(value: unknown): URL | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return url.origin === CANONICAL_SITE_ORIGIN && /^\/data\/v1(?:\/|$)/.test(url.pathname)
			? url
			: null;
	} catch {
		return null;
	}
}

function mapRuntimeManualChunks(id: string): string | undefined {
	if (id.endsWith('.css')) return undefined;
	if (id.includes('/node_modules/') && /\/(maplibre-gl|pmtiles)\//.test(id)) {
		return 'vendor-maplibre';
	}
}

export function previewManifestForIslandCenteredBasemap<T>(manifest: T): T {
	if (!manifest || typeof manifest !== 'object') return manifest;
	const source = manifest as { basemap?: unknown; provider?: unknown };
	const basemapUrl = canonicalDataUrl(source.basemap);
	const provider = typeof source.provider === 'string' ? source.provider : '';
	const providerPrefix = `/data/v1/${provider}/`;
	const basemap =
		basemapUrl && provider && basemapUrl.pathname.startsWith(providerPrefix)
			? `${basemapUrl.pathname.slice(providerPrefix.length)}${basemapUrl.search}${basemapUrl.hash}`
			: source.basemap;
	return {
		...manifest,
		bbox: [...ISLAND_CENTERED_BASEMAP_BBOX],
		...(basemap !== source.basemap ? { basemap } : {}),
	};
}

export function previewBasemapForDirectDevData<T>(descriptor: T): T {
	if (!descriptor || typeof descriptor !== 'object') return descriptor;
	const url = canonicalDataUrl((descriptor as { url?: unknown }).url);
	if (!url) return descriptor;

	return {
		...descriptor,
		url: `${url.pathname}${url.search}${url.hash}`,
	};
}

interface DevJsonPreview {
	path: string;
	source: string;
	header: string;
	transform: (value: unknown) => unknown;
}

function registerDevJsonPreview(server: ViteDevServer, preview: DevJsonPreview): void {
	type PreviewResult = { ok: true; body: string } | { ok: false; status: number };
	let inFlight: Promise<PreviewResult> | null = null;

	function loadPreview(): Promise<PreviewResult> {
		if (inFlight) return inFlight;
		const pending = (async (): Promise<PreviewResult> => {
			const upstream = await fetch(preview.source);
			if (!upstream.ok) return { ok: false, status: upstream.status };
			return { ok: true, body: JSON.stringify(preview.transform(await upstream.json())) };
		})();
		inFlight = pending;
		const clear = () => {
			if (inFlight === pending) inFlight = null;
		};
		void pending.then(clear, clear);
		return pending;
	}

	server.middlewares.use(preview.path, async (req, res, next) => {
		if (req.method !== 'GET') return next();
		try {
			const result = await loadPreview();
			if (!result.ok) {
				res.statusCode = result.status;
				res.setHeader('content-type', 'application/json; charset=utf-8');
				res.setHeader('cache-control', 'no-store');
				res.end(JSON.stringify({ error: 'dev preview upstream unavailable' }));
				return;
			}
			res.statusCode = 200;
			res.setHeader('content-type', 'application/json; charset=utf-8');
			res.setHeader('cache-control', 'no-store');
			res.setHeader('x-transit-dev-preview', preview.header);
			res.end(result.body);
		} catch {
			res.statusCode = 502;
			res.setHeader('content-type', 'application/json; charset=utf-8');
			res.setHeader('cache-control', 'no-store');
			res.end(JSON.stringify({ error: 'dev preview upstream unavailable' }));
		}
	});
}

function islandCenteredManifestPreviewPlugin(command: string): Plugin {
	return {
		name: 'transit-dev-island-centered-manifest-preview',
		apply: 'serve',
		configureServer(server) {
			if (command !== 'serve') return;
			registerDevJsonPreview(server, {
				path: '/data/v1/stm/manifest.json',
				source: DEV_MANIFEST_PREVIEW_SOURCE,
				header: 'island-centered-basemap-bbox',
				transform: previewManifestForIslandCenteredBasemap,
			});
			registerDevJsonPreview(server, {
				path: '/data/v1/stm/static/basemap.json',
				source: DEV_BASEMAP_PREVIEW_SOURCE,
				header: 'direct-r2-basemap-url',
				transform: previewBasemapForDirectDevData,
			});
		},
	};
}

// svelteTesting() only activates under VITEST, so it is safe to include always.
export default defineConfig(({ command, isSsrBuild }) => ({
	// Relocate Vitest's cache out of node_modules/.vite so CI can cache it safely.
	cacheDir: process.env.VITEST ? '.vitest/cache' : undefined,
	build: {
		chunkSizeWarningLimit: 1100,
		rollupOptions: isSsrBuild
			? undefined
			: {
					output: {
						manualChunks: mapRuntimeManualChunks,
					},
				},
	},
	// Dev-only snapshot proxy. Production keeps serving the same-origin `/data/v1`
	// contract through transit-data-proxy. Local development bypasses that quota-
	// limited Worker and reads the public R2 custom domain directly; R2 exposes the
	// same objects at `/v1`, so strip only the local `/data` mount prefix. Vite's
	// proxy preserves the request method and headers, including HEAD and Range.
	server: {
		proxy: {
			'/data': {
				target: 'https://data.yesid.dev',
				changeOrigin: true,
				secure: true,
				rewrite: (path) => path.replace(/^\/data\/v1(?=\/|$)/, '/v1'),
			},
		},
	},
	plugins: [
		islandCenteredManifestPreviewPlugin(command),
		tailwindcss(),
		sveltekit(),
		svelteTesting(),
		// Bundle visualizer — emits dist/stats.html on production build (build-only).
		visualizer({
			filename: 'dist/stats.html',
			gzipSize: true,
			brotliSize: true,
			template: 'treemap',
			open: false,
		}),
	],
	ssr: {
		// bits-ui ships .svelte files in dist/ — Vite SSR must run them through the
		// Svelte compiler instead of treating them as native ESM. gsap's subpath
		// plugin exports (gsap/SplitText) need bundling for clean SSR ESM interop;
		// it loads side-effect-free (window access is deferred) and only animates
		// client-side. (Lenis is still deliberately absent — no smooth-scroll.)
		noExternal: ['@yesid/ui', 'bits-ui', 'gsap'],
	},
	test: {
		// Two projects: "data" = pure logic (node, fast), "dom" = components/stores (happy-dom).
		projects: [
			{
				extends: true,
				test: {
					name: 'data',
					include: ['src/lib/**/*.test.ts', 'src/params/**/*.test.ts', 'src/tests/**/*.test.ts'],
					exclude: ['src/lib/components/**', 'src/lib/stores/**', 'src/lib/**/*.svelte.test.ts'],
					environment: 'node',
					globals: true,
					// forks (process-per-file), NOT threads: under threads this project intermittently
					// reported a spurious "1 failed file" while every test passed — cross-file state
					// leaking inside a shared worker. Process isolation removes the contamination at the
					// source, so the suite runs file-parallel again (no more --no-file-parallelism crutch).
					pool: 'forks',
					setupFiles: ['./src/tests/setup.data.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'dom',
					include: [
						'src/lib/components/**/*.test.ts',
						'src/lib/stores/**/*.test.ts',
						'src/lib/**/*.svelte.test.ts',
						'src/routes/**/*.test.ts',
					],
					environment: 'happy-dom',
					globals: true,
					pool: 'threads',
					setupFiles: ['./src/tests/setup.dom.ts'],
				},
			},
		],
	},
}));
