import type { R2BucketBinding } from './lib/v1/binding';

declare global {
	namespace App {
		interface Locals {
			locale?: 'en' | 'fr';
			v1Cache?: Map<string, unknown>;
		}
		interface Platform {
			env?: {
				SNAPSHOTS?: R2BucketBinding;
				DATA?: { fetch: typeof fetch };
				WEB_VITALS?: {
					writeDataPoint(point: {
						indexes?: string[];
						blobs?: (string | null)[];
						doubles?: number[];
					}): void;
				};
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
