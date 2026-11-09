declare module 'cloudflare:workers' {
	export const env: {
		SNAPSHOTS?: import('./lib/v1/binding').R2BucketBinding;
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
	export function waitUntil(promise: Promise<unknown>): void;
}
