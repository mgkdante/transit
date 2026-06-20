import { describe, expect, it } from 'vitest';
import { routeColor } from './routeColor';

describe('routeColor', () => {
	it('normalizes a bare 6-digit GTFS hex to #rrggbb', () => {
		expect(routeColor('009EE0')).toBe('#009ee0');
		expect(routeColor('#A1B2C3')).toBe('#a1b2c3');
	});

	it('expands a 3-digit shorthand', () => {
		expect(routeColor('0AF')).toBe('#00aaff');
		expect(routeColor('#fff')).toBe('#ffffff');
	});

	it('returns null for absent / empty — no fabricated default hue', () => {
		expect(routeColor(null)).toBeNull();
		expect(routeColor(undefined)).toBeNull();
		expect(routeColor('')).toBeNull();
		expect(routeColor('   ')).toBeNull();
	});

	it('rejects anything that is not a clean hex (no unsafe CSS injection)', () => {
		expect(routeColor('transparent')).toBeNull();
		expect(routeColor('red')).toBeNull();
		expect(routeColor('var(--primary)')).toBeNull();
		expect(routeColor('#0011')).toBeNull(); // 4 digits
		expect(routeColor('00ff00; background:url(x)')).toBeNull();
	});
});
