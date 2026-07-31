import { describe, expect, it } from 'vitest';

import {
	deriveMapFitPadding,
	ISLAND_FIT_BOUNDS,
	MAP_MAX_BOUNDS,
	mapInitialCenter,
} from './mapCameraFraming';

describe('map camera framing', () => {
	it('keeps the Montréal island fit and pan-limit bounds with their derived center', () => {
		expect(ISLAND_FIT_BOUNDS).toEqual([-73.9757, 45.4022, -73.4764, 45.7028]);
		expect(MAP_MAX_BOUNDS).toEqual([-74.32, 45.3, -73.2, 45.82]);
		expect(mapInitialCenter).toEqual([-73.72605, 45.5525]);
	});

	it('derives the desktop padding from the whole map width', () => {
		expect(deriveMapFitPadding(true, 1280)).toEqual({
			top: 56,
			bottom: 56,
			left: 474,
			right: 550,
		});
	});

	it('uses the scalar fit padding on mobile or before a positive width exists', () => {
		expect(deriveMapFitPadding(false, 1280)).toBe(40);
		expect(deriveMapFitPadding(true, 0)).toBe(40);
	});
});
