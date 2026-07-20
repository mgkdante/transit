import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { projectRunes } from '@yesid/config/svelte/project-runes.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Default to rune mode for project code, except node_modules.
		// Can be removed in Svelte 6.
		runes: projectRunes(import.meta.dirname),
	},
	kit: {
		// Cloudflare Worker (Static Assets) — see apps/web/wrangler.toml. /data/* is kept
		// off this app by Cloudflare ROUTE specificity: the data-proxy worker's
		// transit.yesid.dev/data/* route beats this app's transit.yesid.dev/*.
		// The `routes.exclude` below only affects the Pages `_routes.json` (a no-op
		// in the Workers build) — retained so a future switch back to Pages still
		// hands /data/* to the snapshot worker rather than this Function.
		adapter: adapter({ routes: { exclude: ['/data/*'] } }),
		version: {
			// Freshness lever for long-lived sessions. `name` already defaults to a
			// per-build timestamp (busts the service-worker cache + /_app/version.json
			// every deploy); the missing piece was the POLL. With pollInterval set,
			// SvelteKit polls /_app/version.json and flips `updated.current` true on a
			// new deploy, so a tab left open / resumed standalone PWA upgrades on its
			// next navigation (see src/lib/pwa/appVersion.ts + the +layout.svelte
			// beforeNavigate hook). Cold loads are already kept fresh network-first by
			// the service worker. Value mirrors VERSION_POLL_INTERVAL_MS (60_000ms);
			// a test in appVersion.test.ts asserts the two stay in sync.
			pollInterval: 60_000,
		},
	},
};

export default config;
