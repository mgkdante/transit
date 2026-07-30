export interface TokenBucketProfile {
	readonly capacity: number;
	readonly refillTokens: number;
	readonly refillIntervalMs: number;
}

export interface TokenBucketDecision {
	readonly allowed: boolean;
	readonly tokensRemaining: number;
	readonly retryAfterSeconds: number;
}

interface BucketState {
	tokens: number;
	lastRefillMs: number;
	lastSeenMs: number;
}

export const GEOCODE_RATE_LIMIT = {
	requestCost: 1,
	trusted: {
		capacity: 54,
		refillTokens: 1,
		refillIntervalMs: 1_000,
	},
	missingIp: {
		capacity: 24,
		refillTokens: 1,
		refillIntervalMs: 4_000,
	},
	bucketTtlMs: 10 * 60_000,
	maxTrustedEntries: 10_000,
	maxMissingIpEntries: 1,
} as const;

/**
 * Best-effort defense-in-depth only. This map is local to one Worker isolate:
 * parallel isolates/colos do not share counters, isolate turnover resets them,
 * and IP churn can spread traffic across buckets. The native binding seam in
 * the route is the ready upgrade when the Cloudflare account positively exposes
 * Workers Rate Limiting; account-side WAF and provider quotas remain separate.
 */
export class TokenBucketLimiter {
	readonly #buckets = new Map<string, BucketState>();

	constructor(
		readonly profile: TokenBucketProfile,
		readonly options: { readonly ttlMs: number; readonly maxEntries: number },
	) {
		if (
			profile.capacity <= 0 ||
			profile.refillTokens <= 0 ||
			profile.refillIntervalMs <= 0 ||
			options.ttlMs <= 0 ||
			options.maxEntries <= 0
		) {
			throw new RangeError('Token-bucket parameters must be positive');
		}
	}

	take(key: string, nowMs = Date.now()): TokenBucketDecision {
		let bucket = this.#buckets.get(key);
		if (bucket && nowMs - bucket.lastSeenMs > this.options.ttlMs) {
			this.#buckets.delete(key);
			bucket = undefined;
		}

		if (!bucket) {
			this.#pruneAndMakeRoom(nowMs);
			bucket = {
				tokens: this.profile.capacity,
				lastRefillMs: nowMs,
				lastSeenMs: nowMs,
			};
			this.#buckets.set(key, bucket);
		} else {
			const elapsedMs = Math.max(0, nowMs - bucket.lastRefillMs);
			bucket.tokens = Math.min(
				this.profile.capacity,
				bucket.tokens + (elapsedMs / this.profile.refillIntervalMs) * this.profile.refillTokens,
			);
			bucket.lastRefillMs = Math.max(bucket.lastRefillMs, nowMs);
			bucket.lastSeenMs = Math.max(bucket.lastSeenMs, nowMs);
			// Map insertion order is the LRU queue. Refresh this key at the tail so
			// new-IP churn evicts in O(1) instead of scanning the 10k-entry cap.
			this.#buckets.delete(key);
			this.#buckets.set(key, bucket);
		}

		if (bucket.tokens >= GEOCODE_RATE_LIMIT.requestCost) {
			bucket.tokens -= GEOCODE_RATE_LIMIT.requestCost;
			return {
				allowed: true,
				tokensRemaining: bucket.tokens,
				retryAfterSeconds: 0,
			};
		}

		const deficit = GEOCODE_RATE_LIMIT.requestCost - bucket.tokens;
		const retryAfterSeconds = Math.max(
			1,
			Math.ceil((deficit * this.profile.refillIntervalMs) / this.profile.refillTokens / 1_000),
		);
		return {
			allowed: false,
			tokensRemaining: bucket.tokens,
			retryAfterSeconds,
		};
	}

	#pruneAndMakeRoom(nowMs: number): void {
		// LRU order means expired entries, if any, are contiguous at the front.
		for (const [key, bucket] of this.#buckets) {
			if (nowMs - bucket.lastSeenMs <= this.options.ttlMs) break;
			this.#buckets.delete(key);
		}
		if (this.#buckets.size < this.options.maxEntries) return;

		const oldestKey = this.#buckets.keys().next().value as string | undefined;
		if (oldestKey != null) this.#buckets.delete(oldestKey);
	}
}
