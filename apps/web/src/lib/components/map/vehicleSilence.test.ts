import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LIVE_TTL_S,
	liveTtlS,
	silenceAgeS,
	silenceOpacity,
	silenceOpacityDiscrete,
} from './vehicleSilence';

const TTL = 30;
const NOW = Date.parse('2026-06-21T12:00:00Z');

describe('silenceAgeS — server-anchored report age', () => {
	it('is 0 for a just-reported vehicle', () => {
		expect(silenceAgeS('2026-06-21T12:00:00Z', NOW)).toBe(0);
	});

	it('counts seconds since the report timestamp', () => {
		expect(silenceAgeS('2026-06-21T11:59:15Z', NOW)).toBe(45);
	});

	it('clamps a future-stamped report (clock skew) to 0, never negative', () => {
		expect(silenceAgeS('2026-06-21T12:00:30Z', NOW)).toBe(0);
	});

	it('treats a missing or unparseable timestamp as maximally silent', () => {
		expect(silenceAgeS(null, NOW)).toBe(Number.POSITIVE_INFINITY);
		expect(silenceAgeS(undefined, NOW)).toBe(Number.POSITIVE_INFINITY);
		expect(silenceAgeS('not-a-date', NOW)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe('silenceOpacity — always full (buses are solid in normal operation)', () => {
	it('returns 1 for any age and any ttl', () => {
		expect(silenceOpacity(0, TTL)).toBe(1);
		expect(silenceOpacity(67.5, TTL)).toBe(1);
		expect(silenceOpacity(300, TTL)).toBe(1);
		expect(silenceOpacity(Number.POSITIVE_INFINITY, TTL)).toBe(1);
		// ttl is irrelevant now — the fade is gone.
		expect(silenceOpacity(67.5, 5)).toBe(1);
		expect(silenceOpacity(67.5)).toBe(1);
	});
});

describe('silenceOpacityDiscrete — always full (reduced motion)', () => {
	it('returns 1 for any age and any ttl', () => {
		expect(silenceOpacityDiscrete(0, TTL)).toBe(1);
		expect(silenceOpacityDiscrete(67.5, TTL)).toBe(1);
		expect(silenceOpacityDiscrete(300, TTL)).toBe(1);
		expect(silenceOpacityDiscrete(Number.POSITIVE_INFINITY, TTL)).toBe(1);
		expect(silenceOpacityDiscrete(67.5, 5)).toBe(1);
		expect(silenceOpacityDiscrete(67.5)).toBe(1);
	});
});

describe('liveTtlS', () => {
	it('uses the manifest ttl, falling back to the default', () => {
		expect(liveTtlS(15)).toBe(15);
		expect(liveTtlS(null)).toBe(DEFAULT_LIVE_TTL_S);
		expect(liveTtlS(undefined)).toBe(DEFAULT_LIVE_TTL_S);
		// Never collapses to a non-positive window.
		expect(liveTtlS(0)).toBe(1);
	});
});
