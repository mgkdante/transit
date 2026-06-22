import { describe, it, expect } from 'vitest';
import { hashStr, hashUnit, hashJitter } from './hash';

describe('hashStr — FNV-1a, deterministic', () => {
	it('is stable for the same input (never changes visit-to-visit)', () => {
		expect(hashStr('trip-165-42')).toBe(hashStr('trip-165-42'));
	});
	it('returns an unsigned 32-bit integer', () => {
		const h = hashStr('s1');
		expect(Number.isInteger(h)).toBe(true);
		expect(h).toBeGreaterThanOrEqual(0);
		expect(h).toBeLessThanOrEqual(0xffffffff);
	});
	it('distinguishes different ids', () => {
		expect(hashStr('a')).not.toBe(hashStr('b'));
	});
});

describe('hashUnit / hashJitter', () => {
	it('hashUnit is in [0, 1) and deterministic', () => {
		const u = hashUnit('stop-42');
		expect(u).toBeGreaterThanOrEqual(0);
		expect(u).toBeLessThan(1);
		expect(hashUnit('stop-42')).toBe(u);
	});
	it('hashJitter stays within ±band and is deterministic', () => {
		const j = hashJitter('trip-1', 4);
		expect(j).toBeGreaterThanOrEqual(-4);
		expect(j).toBeLessThanOrEqual(4);
		expect(hashJitter('trip-1', 4)).toBe(j);
	});
});
