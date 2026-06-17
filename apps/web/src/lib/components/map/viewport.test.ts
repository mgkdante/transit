import { describe, expect, it } from 'vitest';
import { mapViewportOptions, MONTREAL_MAP_BOUNDS } from './viewport';

describe('mapViewportOptions', () => {
	it('keeps the citizen map constrained to the Montréal service area', () => {
		expect(MONTREAL_MAP_BOUNDS).toEqual([
			[-74.1, 45.25],
			[-73.2, 45.75],
		]);
		expect(mapViewportOptions()).toMatchObject({
			maxBounds: MONTREAL_MAP_BOUNDS,
			minZoom: 9,
			maxZoom: 16,
			renderWorldCopies: false,
		});
	});

	it('accepts a provider bbox so each provider can constrain to its own city', () => {
		expect(mapViewportOptions([-79.8, 43.4, -79.0, 44.0])).toMatchObject({
			maxBounds: [
				[-79.8, 43.4],
				[-79.0, 44.0],
			],
		});
	});

	it('reduces tile churn during zoom and repeated theme interactions', () => {
		expect(mapViewportOptions()).toMatchObject({
			refreshExpiredTiles: false,
			maxTileCacheZoomLevels: 8,
			fadeDuration: 0,
		});
	});
});
