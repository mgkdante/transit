import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { visualizer } from 'rollup-plugin-visualizer';

// svelteTesting() only activates under VITEST, so it is safe to include always.
export default defineConfig({
	// Relocate Vitest's cache out of node_modules/.vite so CI can cache it safely.
	cacheDir: process.env.VITEST ? '.vitest/cache' : undefined,
	// Dev-only snapshot proxy. In production the /v1 contract is served by the
	// data.yesid.dev zone-route worker; locally we proxy `/data/*` to it so the
	// app fetches relative `/data/...` URLs without CORS or a hardcoded origin.
	// The `/data` prefix is stripped, so `/data/network.json` → the worker's
	// `https://data.yesid.dev/v1/network.json`.
	server: {
		proxy: {
			'/data': {
				target: 'https://data.yesid.dev/v1',
				changeOrigin: true,
				secure: true,
				rewrite: (path) => path.replace(/^\/data/, ''),
			},
		},
	},
	plugins: [
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
		noExternal: ['bits-ui', 'gsap'],
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
					pool: 'threads',
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
});
