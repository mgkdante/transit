import { describe, expect, it } from 'vitest';

import type { MapNearTarget } from '$lib/search/mapNear';
import { buildFocusClearSearch, buildNearTargetSearch, clearNearTargetSearch } from './mapUrlSync';

const target: MapNearTarget = {
	lat: 45.5,
	lon: -73.6,
	label: 'Place des Arts',
	precision: 'address',
};

describe('buildNearTargetSearch', () => {
	it('writes the near-me params, preserving the existing filter params', () => {
		const current = new URLSearchParams('status=late&route=24');
		const path = buildNearTargetSearch(current, '/map', target);
		const next = new URLSearchParams(path.slice(1));
		// The filter spine is untouched…
		expect(next.get('status')).toBe('late');
		expect(next.get('route')).toBe('24');
		// …and the near-me target is present (a non-empty `near` token + label).
		expect(next.has('near')).toBe(true);
		expect(next.get('nearLabel')).toBe('Place des Arts');
	});

	it('does not mutate the passed-in params (clones)', () => {
		const current = new URLSearchParams('status=late');
		buildNearTargetSearch(current, '/map', target);
		expect(current.has('near')).toBe(false);
		expect(current.get('status')).toBe('late');
	});
});

describe('clearNearTargetSearch', () => {
	it('drops every near-me param while leaving map filters intact', () => {
		const seeded = new URLSearchParams(
			buildNearTargetSearch(new URLSearchParams('route=24'), '/map', target).slice(1),
		);
		const path = clearNearTargetSearch(seeded, '/map');
		const next = new URLSearchParams(path.startsWith('?') ? path.slice(1) : '');
		expect(next.has('near')).toBe(false);
		expect(next.has('nearLabel')).toBe(false);
		expect(next.get('route')).toBe('24');
	});

	it('reduces to the bare pathname when no params remain', () => {
		const seeded = new URLSearchParams(
			buildNearTargetSearch(new URLSearchParams(), '/map', target).slice(1),
		);
		expect(clearNearTargetSearch(seeded, '/map')).toBe('/map');
	});
});

describe('buildFocusClearSearch', () => {
	it('strips the focus param, preserving the rest', () => {
		const current = new URLSearchParams('focus=stop:STOP1&route=24');
		const path = buildFocusClearSearch(current, '/map');
		const next = new URLSearchParams(path.startsWith('?') ? path.slice(1) : '');
		expect(next.has('focus')).toBe(false);
		expect(next.get('route')).toBe('24');
	});

	it('reduces to the bare pathname when focus was the only param', () => {
		const current = new URLSearchParams('focus=stop:STOP1');
		expect(buildFocusClearSearch(current, '/map')).toBe('/map');
	});
});
