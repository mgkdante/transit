import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { relative, sep } from 'node:path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Default to rune mode for project code, except node_modules.
		// Can be removed in Svelte 6.
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');
			return isExternalLibrary ? undefined : true;
		},
	},
	kit: {
		// Cloudflare Worker (Static Assets) — see web/wrangler.toml. /data/* is kept
		// off this app by Cloudflare ROUTE specificity: the data-proxy worker's
		// transit.yesid.dev/data/* route beats this app's transit.yesid.dev/*.
		// The `routes.exclude` below only affects the Pages `_routes.json` (a no-op
		// in the Workers build) — retained so a future switch back to Pages still
		// hands /data/* to the snapshot worker rather than this Function.
		adapter: adapter({ routes: { exclude: ['/data/*'] } }),
	},
};

export default config;
