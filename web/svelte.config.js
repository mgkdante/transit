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
		// Cloudflare Pages. Exclude /data/* from the Pages Function so the existing
		// zone-route snapshot worker (slice-9.1.1p) keeps serving the /v1 contract;
		// the Function never sees those paths. (Hashed assets are auto-excluded.)
		adapter: adapter({ routes: { exclude: ['/data/*'] } }),
	},
};

export default config;
