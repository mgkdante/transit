import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_TTL_S, liveTtlS, silenceAgeS } from './vehicleSilence';

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

describe('liveTtlS', () => {
	it('uses the manifest ttl, falling back to the default', () => {
		expect(liveTtlS(15)).toBe(15);
		expect(liveTtlS(null)).toBe(DEFAULT_LIVE_TTL_S);
		expect(liveTtlS(undefined)).toBe(DEFAULT_LIVE_TTL_S);
		// Never collapses to a non-positive window.
		expect(liveTtlS(0)).toBe(1);
	});
});
