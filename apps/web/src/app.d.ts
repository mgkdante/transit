// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Per-request /v1 fetch memo (manifest + labels fetched once per SSR request). Wired in P3/P5. */
			v1Cache?: Map<string, unknown>;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			/**
			 * Cloudflare Worker bindings/secrets (adapter-cloudflare). A heterogeneous
			 * bag: string secrets (CF_PAGES_*) alongside the `DATA` service binding to
			 * transit-data-proxy, which +layout.server.ts uses to boot the /v1 contract
			 * server-side (a same-origin SSR fetch to our own zone 523s). `DATA` is
			 * absent in local dev / `vite preview` — callers must guard for undefined.
			 */
			env?: {
				/** Service binding → transit-data-proxy (SSR /v1 boot). See wrangler.toml. */
				DATA?: { fetch: typeof fetch };
				[key: string]: unknown;
			};
			context?: { waitUntil(promise: Promise<unknown>): void };
			caches?: CacheStorage;
		}
	}
}

export {};
