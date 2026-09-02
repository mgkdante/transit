// See https://svelte.dev/docs/kit/types#app.d.ts
import type { R2BucketBinding } from './lib/v1/binding';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Request pathname locale, including error renders without matched route params. */
			locale?: 'en' | 'fr';
			/** Per-request /v1 fetch memo (manifest + labels fetched once per SSR request). Wired in P3/P5. */
			v1Cache?: Map<string, unknown>;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			/**
			 * Cloudflare Worker bindings/secrets (adapter-cloudflare). A heterogeneous
			 * bag: string secrets alongside the direct `SNAPSHOTS` R2 binding and the
			 * fallback `DATA` service binding. Both are absent in local dev / preview.
			 */
			env?: {
				/** Direct R2 binding for SSR snapshot reads without a Worker hop. */
				SNAPSHOTS?: R2BucketBinding;
				/** Service binding → transit-data-proxy (SSR /v1 boot). See wrangler.toml. */
				DATA?: { fetch: typeof fetch };
				/**
				 * Cloudflare Analytics Engine dataset for Web-Vitals RUM.
				 * ABSENT by default — the binding lives COMMENTED in wrangler.toml until
				 * the operator wires the dataset. /api/vitals no-ops (204) when this is
				 * absent, so the feature stays inert until the operator enables it.
				 */
				WEB_VITALS?: {
					writeDataPoint(point: {
						indexes?: string[];
						blobs?: (string | null)[];
						doubles?: number[];
					}): void;
				};
				/**
				 * READY-TO-ENABLE Cloudflare-managed geocode limiters. Their
				 * counters are location-local, not globally distributed. They stay
				 * absent until the account/config receipt selects the commented
				 * Wrangler variant; otherwise the route uses its isolate bucket.
				 */
				GEOCODE_RATE_LIMITER?: {
					limit(options: { key: string }): Promise<{ success: boolean }>;
				};
				GEOCODE_SHARED_RATE_LIMITER?: {
					limit(options: { key: string }): Promise<{ success: boolean }>;
				};
				[key: string]: unknown;
			};
			ctx?: { waitUntil(promise: Promise<unknown>): void };
			context?: { waitUntil(promise: Promise<unknown>): void };
			caches?: CacheStorage;
		}
	}
}

export {};
