import { describe, expect, it } from 'vitest';
import { centerFromProviderBbox, mapViewportOptions, MONTREAL_MAP_BOUNDS } from './viewport';
import providers from '../../../../e2e/providers.json';
import montreal from '../../../../static/map/basemap-montreal-posters.json';
import ottawa from '../../../../static/map/basemap-ottawa-posters.json';

describe('extract coverage at the minimum camera zoom', () => {
	for (const provider of providers.providers) {
		const extract = (provider.id === 'stm' ? montreal : ottawa).source.bounds;
		it.each([
			[390, 844],
			[1280, 800],
			[1536, 864],
			[1920, 1080],
			[2560, 1440],
			[1960, 980],
		])(`${provider.id} retains 15 percent margin at %ix%i`, (width, height) => {
			const padding =
				width < 1024
					? { top: 160, bottom: 112, left: 16, right: 16 }
					: { top: 166.8, bottom: 80, left: 332, right: 16 };
			const view = mapViewportOptions(provider.fit_bounds, padding, provider.max_bounds, {
				width,
				height,
			});
			const x = (lon: number) => (lon + 180) / 360;
			const y = (lat: number) => (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
			const scale = 512 * 2 ** view.minZoom!;
			const cx =
				(x(provider.fit_bounds[0]) + x(provider.fit_bounds[2])) / 2 -
				(padding.left - padding.right) / (2 * scale);
			const cy =
				(y(provider.fit_bounds[1]) + y(provider.fit_bounds[3])) / 2 -
				(padding.top - padding.bottom) / (2 * scale);
			expect(cx - width / (2 * scale) - x(extract[0])).toBeGreaterThanOrEqual(
				(0.15 * width) / scale,
			);
			expect(x(extract[2]) - cx - width / (2 * scale)).toBeGreaterThanOrEqual(
				(0.15 * width) / scale,
			);
			expect(y(extract[1]) - cy - height / (2 * scale)).toBeGreaterThanOrEqual(
				(0.15 * height) / scale,
			);
			expect(cy - height / (2 * scale) - y(extract[3])).toBeGreaterThanOrEqual(
				(0.15 * height) / scale,
			);
			expect(view.maxBounds[0][0]).toBeGreaterThanOrEqual(extract[0]);
			expect(view.maxBounds[0][1]).toBeGreaterThanOrEqual(extract[1]);
			expect(view.maxBounds[1][0]).toBeLessThanOrEqual(extract[2]);
			expect(view.maxBounds[1][1]).toBeLessThanOrEqual(extract[3]);
		});
	}
});

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
			bounds: [
				[-79.8, 43.4],
				[-79.0, 44.0],
			],
			maxBounds: [
				[-79.8, 43.4],
				[-79.0, 44.0],
			],
			fitBoundsOptions: {
				padding: 40,
			},
		});
	});

	it('accepts layout-aware fit padding for desktop overlays', () => {
		const padding = { top: 40, bottom: 40, left: 520, right: 40 };

		expect(mapViewportOptions([-74.176, 45.237, -73.276, 45.867], padding)).toMatchObject({
			bounds: [
				[-74.176, 45.237],
				[-73.276, 45.867],
			],
			fitBoundsOptions: {
				padding,
			},
		});
	});

	it('derives the initial camera center from the provider bbox', () => {
		const center = centerFromProviderBbox([-74.176, 45.237, -73.276, 45.867]);
		expect(center[0]).toBeCloseTo(-73.726);
		expect(center[1]).toBeCloseTo(45.552);
	});

	it('reduces tile churn during zoom and repeated theme interactions', () => {
		expect(mapViewportOptions()).toMatchObject({
			refreshExpiredTiles: false,
			maxTileCacheZoomLevels: 8,
			fadeDuration: 0,
		});
	});
});
