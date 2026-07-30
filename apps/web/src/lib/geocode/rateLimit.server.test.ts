import { describe, expect, it } from 'vitest';
import {
	GEOCODE_RATE_LIMIT,
	TokenBucketLimiter,
	type TokenBucketProfile,
} from './rateLimit.server';

function trace(profile: TokenBucketProfile, cadenceMs: number, attempts: number) {
	const limiter = new TokenBucketLimiter(profile, {
		ttlMs: GEOCODE_RATE_LIMIT.bucketTtlMs,
		maxEntries: GEOCODE_RATE_LIMIT.maxTrustedEntries,
	});
	return Array.from({ length: attempts }, (_, index) =>
		limiter.take('198.51.100.10', index * cadenceMs),
	);
}

describe('geocode token bucket', () => {
	it('admits the measured 18-call 121ms trace and a full second trace of headroom', () => {
		const decisions = trace(GEOCODE_RATE_LIMIT.trusted, 121, 36);

		expect(decisions.every((decision) => decision.allowed)).toBe(true);
		expect(decisions.at(-1)?.tokensRemaining).toBeCloseTo(22.235, 3);
	});

	it.each([
		{
			cadenceMs: 121,
			acceptedCalls: 61,
			deniedCall: 62,
			after18: 38.057,
			after36: 22.235,
			after54: 6.413,
			atDenial: 0.381,
		},
		{
			cadenceMs: 251,
			acceptedCalls: 71,
			deniedCall: 72,
			after18: 40.267,
			after36: 26.785,
			after54: 13.303,
			atDenial: 0.821,
		},
	])(
		'records the full sizing receipt and first denial at call $deniedCall for $cadenceMs ms',
		({ cadenceMs, acceptedCalls, deniedCall, after18, after36, after54, atDenial }) => {
			const decisions = trace(GEOCODE_RATE_LIMIT.trusted, cadenceMs, deniedCall);

			expect(decisions.slice(0, acceptedCalls).every((decision) => decision.allowed)).toBe(true);
			expect(decisions[17].tokensRemaining).toBeCloseTo(after18, 3);
			expect(decisions[35].tokensRemaining).toBeCloseTo(after36, 3);
			expect(decisions[53].tokensRemaining).toBeCloseTo(after54, 3);
			expect(decisions[deniedCall - 1]).toMatchObject({
				allowed: false,
				retryAfterSeconds: 1,
			});
			expect(decisions[deniedCall - 1].tokensRemaining).toBeCloseTo(atDenial, 3);
		},
	);

	it('gives the conservative missing-IP bucket room for 18 suggestions plus Details', () => {
		const decisions = trace(GEOCODE_RATE_LIMIT.missingIp, 0, 25);

		expect(decisions.slice(0, 24).every((decision) => decision.allowed)).toBe(true);
		expect(decisions[24]).toMatchObject({ allowed: false, retryAfterSeconds: 4 });
	});

	it('expires idle buckets after the configured TTL', () => {
		const profile = { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 };
		const active = new TokenBucketLimiter(profile, { ttlMs: 100, maxEntries: 2 });
		const expired = new TokenBucketLimiter(profile, { ttlMs: 100, maxEntries: 2 });

		expect(active.take('a', 0).allowed).toBe(true);
		expect(active.take('a', 99).allowed).toBe(false);
		expect(expired.take('a', 0).allowed).toBe(true);
		expect(expired.take('a', 101).allowed).toBe(true);
	});

	it('caps the map by evicting the least-recently-seen bucket', () => {
		const profile = { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 };
		const limiter = new TokenBucketLimiter(profile, { ttlMs: 60_000, maxEntries: 2 });

		expect(limiter.take('a', 0).allowed).toBe(true);
		expect(limiter.take('b', 1).allowed).toBe(true);
		expect(limiter.take('a', 2).allowed).toBe(false);
		expect(limiter.take('c', 3).allowed).toBe(true);
		expect(limiter.take('b', 4).allowed).toBe(true);
	});
});
