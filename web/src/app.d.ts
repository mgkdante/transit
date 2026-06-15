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
			/** Cloudflare Worker bindings/secrets (adapter-cloudflare). */
			env?: Record<string, string>;
			context?: { waitUntil(promise: Promise<unknown>): void };
			caches?: CacheStorage;
		}
	}
}

export {};
