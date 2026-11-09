import { describe, expect, it } from 'vitest';
import { livePollDelayMs } from './polling';

describe('cache expiry polling', () => {
	it.each([
		['public, max-age=30', '0', 30000],
		['public, max-age=30', '20', 11250],
		[null, null, 30000],
		['max-age=30', null, 30000],
		['max-age=30', '40', 5000],
		['max-age=2', '0', 5000],
		['max-age=100', '0', 30000],
		['max-age=30', '-1', 30000],
	])('handles %s / %s', (control, age, expected) => {
		const headers = new Headers();
		if (control !== null) headers.set('Cache-Control', control);
		if (age !== null) headers.set('Age', age);
		expect(livePollDelayMs(headers, 30000, () => 0.5)).toBe(expected);
	});
	it('bounds jitter and respects a TTL below the floor', () => {
		const headers = new Headers({ 'cache-control': 'max-age=30', age: '20' });
		expect(livePollDelayMs(headers, 30000, () => 0)).toBe(10500);
		expect(livePollDelayMs(headers, 30000, () => 1)).toBe(12000);
		expect(livePollDelayMs(headers, 2000)).toBe(2000);
	});
});
