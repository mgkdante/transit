import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
}));

import { routeFor } from './intent.svelte';

describe('routeFor', () => {
	it('resolves the map surface and preserves a canonical filter query', () => {
		expect(routeFor({ kind: 'map', search: 'status=late' })).toBe('/map?status=late');
		expect(routeFor({ kind: 'map' })).toBe('/map');
	});

	it('keeps existing route targets byte-identical when no search is provided', () => {
		expect(routeFor({ kind: 'line', id: '161' })).toBe('/route/161');
		expect(routeFor({ kind: 'stop', id: 'ABC 1' })).toBe('/stop/ABC%201');
		expect(routeFor({ kind: 'network-health' })).toBe('/network');
	});

	it('routes vehicle intents to the map vehicle filter instead of a missing vehicles page', () => {
		expect(routeFor({ kind: 'vehicle', id: '40061' })).toBe('/map?vehicle=40061');
		expect(routeFor({ kind: 'vehicle', id: '40061', search: 'route=361' })).toBe(
			'/map?route=361&vehicle=40061',
		);
		expect(routeFor({ kind: 'vehicle' })).toBe('/map');
	});
});
