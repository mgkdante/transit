import { describe, expect, it } from 'vitest';
import {
	AGING_FLOOR_OPACITY,
	DEFAULT_LIVE_TTL_S,
	FRESH_TTL_MULTIPLIER,
	isSilent,
	liveTtlS,
	SILENT_RECOVER_S,
	SILENT_TTL_MULTIPLIER,
	silenceAgeS,
	silenceOpacity,
	silenceOpacityDiscrete,
} from './vehicleSilence';

const TTL = 30; // fresh window 45, fade end / silent threshold 90
const NOW = Date.parse('2026-06-21T12:00:00Z');

describe('silenceAgeS — server-anchored per-vehicle report age', () => {
	it('is 0 for a just-reported vehicle', () => {
		expect(silenceAgeS('2026-06-21T12:00:00Z', NOW)).toBe(0);
	});

	it('counts seconds since the vehicle’s own last report', () => {
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

describe('silenceOpacity — 3-state fresh / aging / silent', () => {
	it('is full opacity for a fresh vehicle (within the fresh window)', () => {
		expect(silenceOpacity(10, TTL)).toBe(1);
		expect(silenceOpacity(0, TTL)).toBe(1);
		expect(silenceOpacity(FRESH_TTL_MULTIPLIER * TTL, TTL)).toBe(1);
	});

	it('fades to a partial value (between the aging floor and full) mid-window', () => {
		const mid = 67.5; // (45 + 90) / 2
		const o = silenceOpacity(mid, TTL);
		expect(o).toBeGreaterThan(AGING_FLOOR_OPACITY);
		expect(o).toBeLessThan(1);
		// Halfway through the aging fade → halfway between 1 and the floor.
		expect(o).toBeCloseTo((1 + AGING_FLOOR_OPACITY) / 2, 6);
	});

	it('reaches the aging floor just before the silent threshold', () => {
		expect(silenceOpacity(89.99, TTL)).toBeCloseTo(AGING_FLOOR_OPACITY, 2);
	});

	it('is continuous at the silent threshold (≈ aging floor, no snap)', () => {
		expect(silenceOpacity(90, TTL)).toBeCloseTo(AGING_FLOOR_OPACITY, 6);
	});

	it('recovers to full opacity after the short recover ramp (silent = full)', () => {
		expect(silenceOpacity(90 + SILENT_RECOVER_S, TTL)).toBeCloseTo(1, 6);
	});

	it('keeps a long-silent vehicle at full opacity (flagged by the marker, not dimmed)', () => {
		expect(silenceOpacity(300, TTL)).toBe(1);
		expect(silenceOpacity(Number.POSITIVE_INFINITY, TTL)).toBe(1);
	});
});

describe('silenceOpacityDiscrete — reduced motion (stepped, not ramped)', () => {
	it('is full / a single mid step / full — no continuous ramp', () => {
		expect(silenceOpacityDiscrete(0, TTL)).toBe(1);
		expect(silenceOpacityDiscrete(FRESH_TTL_MULTIPLIER * TTL, TTL)).toBe(1);
		const mid = silenceOpacityDiscrete((FRESH_TTL_MULTIPLIER + 0.5) * TTL, TTL);
		expect(mid).toBe((1 + AGING_FLOOR_OPACITY) / 2);
		// Once silent, back to full opacity (the marker carries the silent state).
		expect(silenceOpacityDiscrete(300, TTL)).toBe(1);
		expect(silenceOpacityDiscrete(SILENT_TTL_MULTIPLIER * TTL, TTL)).toBe(1);
	});

	it('takes only three distinct values across the whole age range', () => {
		const seen = new Set<number>();
		for (let age = 0; age <= SILENT_TTL_MULTIPLIER * TTL + 60; age += 3) {
			seen.add(silenceOpacityDiscrete(age, TTL));
		}
		expect(seen.size).toBeLessThanOrEqual(3);
	});
});

describe('isSilent — past the fade window → flagged + frozen', () => {
	it('is false while fresh or aging, true past the silent threshold', () => {
		expect(isSilent(89, TTL)).toBe(false);
		expect(isSilent(90, TTL)).toBe(true);
		expect(isSilent(0, TTL)).toBe(false);
		expect(isSilent(Number.POSITIVE_INFINITY, TTL)).toBe(true);
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
