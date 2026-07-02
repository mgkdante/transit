import { describe, it, expect } from 'vitest';
import { selectSilentByRoute, NON_RESPONDING_DOMAIN } from './silentByRoute';
import type { NonRespondingRoute } from '$lib/v1/schemas';

const labels = {
	routeName: (r: string) => `Route ${r}`,
	rowLabel: 'Line',
	display: (_r: string, count: number) => `${count} ${count === 1 ? 'trip' : 'trips'}`,
	href: (r: string) => `/lines/${r}`,
	viewDetail: (r: string) => `View line ${r}`,
};

describe('selectSilentByRoute', () => {
	it('ranks in the builder-given order (count DESC) with the fixed [0,10] absolute domain', () => {
		expect(NON_RESPONDING_DOMAIN).toEqual([0, 10]);
		const rows: NonRespondingRoute[] = [
			{ route_id: '51', count: 2 },
			{ route_id: '105', count: 1 },
		];
		const out = selectSilentByRoute(rows, labels);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ rank: 1, key: '51', value: 2, severity: 'critical' });
		expect(out[0].display).toBe('2 trips');
		expect(out[0].href).toBe('/lines/51');
		expect(out[1]).toMatchObject({ rank: 2, key: '105', value: 1, display: '1 trip' });
	});

	it('stands down on null / empty (the scalar total tile carries the count)', () => {
		expect(selectSilentByRoute(null, labels)).toEqual([]);
		expect(selectSilentByRoute([], labels)).toEqual([]);
	});
});
