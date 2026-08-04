import { describe, expect, it } from 'vitest';

import { mapViewportOptions, type MapFitPadding } from '$lib/components/map/viewport';
import {
	deriveMapFitPadding,
	ISLAND_FIT_BOUNDS,
	MAP_MAX_BOUNDS,
	mapInitialCenter,
} from './mapCameraFraming';

// The camera maths this receipt settles against is MapLibre's own, but the
// transform and the fit helper are not on its public export surface — they live in
// the TypeScript sources it ships beside the bundle. Load them through NON-LITERAL
// specifiers: the runtime resolves them identically, while `svelte-check` stays out
// of maplibre's sources, which do not compile under this project's tsconfig. The
// shapes below describe the API surface only; every number stays MapLibre's.
const MERCATOR_TRANSFORM_MODULE = 'maplibre-gl/src/geo/projection/mercator_transform';
const CAMERA_HELPER_MODULE = 'maplibre-gl/src/geo/projection/camera_helper';
const LNG_LAT_MODULE = 'maplibre-gl/src/geo/lng_lat';
const LNG_LAT_BOUNDS_MODULE = 'maplibre-gl/src/geo/lng_lat_bounds';

type PaddingBox = { top: number; bottom: number; left: number; right: number };

type MapLibreTransform = {
	readonly zoom: number;
	readonly center: { lng: number; lat: number };
	setMinZoom(zoom: number): void;
	setMaxZoom(zoom: number): void;
	setRenderWorldCopies(value: boolean): void;
	setMaxBounds(bounds: unknown): void;
	setZoom(zoom: number): void;
	setCenter(center: unknown): void;
	resize(width: number, height: number): void;
	locationToScreenPoint(location: unknown): { x: number; y: number };
};

const { MercatorTransform } = (await import(MERCATOR_TRANSFORM_MODULE)) as {
	MercatorTransform: new () => MapLibreTransform;
};
const { LngLat } = (await import(LNG_LAT_MODULE)) as {
	LngLat: { new (lng: number, lat: number): unknown; convert(input: unknown): unknown };
};
const { LngLatBounds } = (await import(LNG_LAT_BOUNDS_MODULE)) as {
	LngLatBounds: { convert(input: unknown): unknown };
};
const { cameraForBoxAndBearing } = (await import(CAMERA_HELPER_MODULE)) as {
	cameraForBoxAndBearing: (
		options: { padding: PaddingBox; offset: [number, number]; maxZoom: number },
		padding: PaddingBox,
		bounds: unknown,
		bearing: number,
		transform: MapLibreTransform,
	) => { center: unknown; zoom: number } | undefined;
};

// The pan limit as it shipped before M6f-2: 0.3443° of slack west of the island
// against 0.2764° east, so its midpoint sat west of the island's.
const PRE_M6F2_MAX_BOUNDS = [-74.32, 45.3, -73.2, 45.82] as const;
// MapStage's own initial zoom prop default (MapStage.svelte:185), passed to the
// MapLibre constructor alongside the bounds.
const MAP_STAGE_INITIAL_ZOOM = 11;
// Sub-pixel: the settled offsets below land at ~1e-11 px, i.e. float noise.
const CENTRED_PX = 1e-6;

type Viewport = { label: string; width: number; height: number };

// TWO DESKTOP REGIMES, and the fix needs both halves because each regime is centred
// by a different mechanism.
//
// CONSTRAINED (wide/short): the fit lands wider than the pan window, so MapLibre's
// constrain clamps the camera onto the pan-limit midpoint. Re-centring MAP_MAX_BOUNDS
// is what centres these; the fit padding cannot reach the camera at all.
const CONSTRAINED_DESKTOP_VIEWPORTS: Viewport[] = [
	{ label: '1280x720', width: 1280, height: 720 },
	{ label: '1366x768', width: 1366, height: 768 },
	{ label: '1440x900', width: 1440, height: 900 },
	{ label: '1920x1080', width: 1920, height: 1080 },
];

// UNCONSTRAINED (tall): the VERTICAL fit binds first, so the settled zoom rises above
// the constrain floor and the camera is free horizontally. The pan limit never touches
// these — the SYMMETRY of the side inset is the only thing centring them. Omitting
// this regime is what let the pre-M6f-2 0.37/0.43 split read as "inert".
const UNCONSTRAINED_DESKTOP_VIEWPORTS: Viewport[] = [
	{ label: '1280x1440', width: 1280, height: 1440 },
	{ label: '1440x1080', width: 1440, height: 1080 },
];

const DESKTOP_VIEWPORTS: Viewport[] = [
	...CONSTRAINED_DESKTOP_VIEWPORTS,
	...UNCONSTRAINED_DESKTOP_VIEWPORTS,
];

// Under 1024 the padding is the uniform scalar and no constraint fires. These are
// the must-not-regress controls: they were already exactly centred.
const HANDHELD_VIEWPORTS: Viewport[] = [
	{ label: '390x844', width: 390, height: 844 },
	{ label: '768x1024', width: 768, height: 1024 },
];

// Same normalisation MapLibre applies before it fits (`ui/camera.ts:828-839`):
// a scalar becomes all four edges, and a partial box defaults the rest to zero.
function paddingObject(padding: MapFitPadding): PaddingBox {
	if (typeof padding === 'number') {
		return { top: padding, bottom: padding, left: padding, right: padding };
	}
	return {
		top: padding.top ?? 0,
		bottom: padding.bottom ?? 0,
		left: padding.left ?? 0,
		right: padding.right ?? 0,
	};
}

/**
 * Settle the REAL MapLibre camera exactly the way `Map`'s constructor does
 * (maplibre-gl 5.24.0, `ui/map.ts:713-819`): build the transform from
 * `mapViewportOptions`, apply maxBounds, jumpTo(center/zoom), resize, fitBounds at
 * duration 0, then the final constraining resize. Every number this returns is
 * COMPUTED from that transform — nothing is sampled from rendered pixels, which is
 * why it cannot accidentally measure chrome that shares the island's colours.
 */
function settleCamera(
	viewport: Viewport,
	overrides: { maxBounds?: readonly number[]; padding?: MapFitPadding } = {},
) {
	const padding = overrides.padding ?? deriveMapFitPadding(viewport.width >= 1024, viewport.width);
	const options = mapViewportOptions(
		ISLAND_FIT_BOUNDS,
		padding,
		overrides.maxBounds ?? MAP_MAX_BOUNDS,
	);
	const { minZoom, maxZoom, renderWorldCopies } = options;
	if (
		typeof minZoom !== 'number' ||
		typeof maxZoom !== 'number' ||
		typeof renderWorldCopies !== 'boolean'
	) {
		throw new Error('mapViewportOptions must pin minZoom, maxZoom and renderWorldCopies');
	}

	const transform = new MercatorTransform();
	transform.setMinZoom(minZoom);
	transform.setMaxZoom(maxZoom);
	transform.setRenderWorldCopies(renderWorldCopies);
	transform.setMaxBounds(LngLatBounds.convert(options.maxBounds));
	transform.setZoom(MAP_STAGE_INITIAL_ZOOM);
	transform.setCenter(LngLat.convert(mapInitialCenter));
	transform.resize(viewport.width, viewport.height);

	const box = paddingObject(padding);
	const camera = cameraForBoxAndBearing(
		{ padding: box, offset: [0, 0], maxZoom },
		box,
		LngLatBounds.convert(options.bounds),
		0,
		transform,
	);
	if (!camera) throw new Error('MapLibre refused the fit for this viewport');
	transform.setZoom(camera.zoom);
	transform.setCenter(camera.center);
	transform.resize(viewport.width, viewport.height);

	const [west, , east, north] = ISLAND_FIT_BOUNDS;
	const leftEdge = transform.locationToScreenPoint(new LngLat(west, north)).x;
	const rightEdge = transform.locationToScreenPoint(new LngLat(east, north)).x;
	const islandCentreX = (leftEdge + rightEdge) / 2;
	return {
		zoom: transform.zoom,
		centreLng: transform.center.lng,
		marginLeftPx: leftEdge,
		marginRightPx: viewport.width - rightEdge,
		islandWidthPx: rightEdge - leftEdge,
		islandCentreX,
		offsetPx: islandCentreX - viewport.width / 2,
	};
}

describe('map camera framing', () => {
	it('keeps the Montréal island fit and pan-limit bounds with their derived center', () => {
		expect(ISLAND_FIT_BOUNDS).toEqual([-73.9757, 45.4022, -73.4764, 45.7028]);
		expect(MAP_MAX_BOUNDS).toEqual([-74.28605, 45.3, -73.16605, 45.82]);
		expect(mapInitialCenter).toEqual([-73.72605, 45.5525]);
	});

	it('centres the pan limit on the island, which is what the desktop camera settles on', () => {
		const midpoint = (MAP_MAX_BOUNDS[0] + MAP_MAX_BOUNDS[2]) / 2;
		expect(midpoint).toBeCloseTo(mapInitialCenter[0], 10);
		expect(MAP_MAX_BOUNDS[0] - ISLAND_FIT_BOUNDS[0]).toBeCloseTo(
			ISLAND_FIT_BOUNDS[2] - MAP_MAX_BOUNDS[2],
			10,
		);
	});

	it('derives one symmetric side inset from the whole map width', () => {
		expect(deriveMapFitPadding(true, 1280)).toEqual({
			top: 0,
			bottom: 0,
			left: 512,
			right: 512,
		});
	});

	it('uses the scalar fit padding on mobile or before a positive width exists', () => {
		expect(deriveMapFitPadding(false, 1280)).toBe(40);
		expect(deriveMapFitPadding(true, 0)).toBe(40);
	});
});

describe('settled map camera (computed from the real MapLibre transform)', () => {
	it.each(DESKTOP_VIEWPORTS)('centres the island at $label', (viewport) => {
		const settled = settleCamera(viewport);
		expect(settled.centreLng).toBeCloseTo(mapInitialCenter[0], 10);
		expect(settled.offsetPx).toBeCloseTo(0, 6);
		expect(Math.abs(settled.offsetPx)).toBeLessThan(CENTRED_PX);
		expect(settled.marginLeftPx).toBeCloseTo(settled.marginRightPx, 6);
	});

	it.each(HANDHELD_VIEWPORTS)('leaves $label exactly centred', (viewport) => {
		const settled = settleCamera(viewport);
		expect(settled.centreLng).toBeCloseTo(mapInitialCenter[0], 10);
		expect(Math.abs(settled.offsetPx)).toBeLessThan(CENTRED_PX);
		expect(settled.marginLeftPx).toBeCloseTo(settled.marginRightPx, 6);
	});

	it('pins the settled zoom and island width so a padding change cannot flip the regime', () => {
		const pinned = [...HANDHELD_VIEWPORTS, ...DESKTOP_VIEWPORTS].map((viewport) => {
			const settled = settleCamera(viewport);
			return [viewport.label, +settled.zoom.toFixed(6), +settled.islandWidthPx.toFixed(4)];
		});
		expect(pinned).toEqual([
			['390x844', 9.642114, 567.4069],
			['768x1024', 9.921015, 688.4178],
			['1280x720', 9.650282, 570.6286],
			['1366x768', 9.744096, 608.9677],
			['1440x900', 9.820207, 641.9571],
			['1920x1080', 10.235245, 855.9429],
			['1280x1440', 10.412868, 968.0876],
			['1440x1080', 9.997831, 726.0657],
		]);
	});

	// INERTNESS GUARD for the pan-limit half of the fix. Put the pre-M6f-2 pan limit
	// back and the island must go RED across the CONSTRAINED regime — a constant
	// +3.03125% of viewport width right of centre. Scoped to that regime on purpose:
	// the tall viewports escape the constrain, so the pan limit does not reach them
	// and this particular bias is not the defect there (see the symmetry guard below).
	// Without this the fix could silently become a no-op, which is exactly how the
	// previous attempt at F8 failed.
	it('goes RED again with the pre-M6f-2 asymmetric pan limit', () => {
		const red = CONSTRAINED_DESKTOP_VIEWPORTS.map((viewport) => {
			const settled = settleCamera(viewport, { maxBounds: PRE_M6F2_MAX_BOUNDS });
			expect(settled.centreLng).toBeCloseTo(-73.76, 10);
			return [
				viewport.label,
				+settled.offsetPx.toFixed(4),
				+((settled.offsetPx / viewport.width) * 100).toFixed(5),
			];
		});
		expect(red).toEqual([
			['1280x720', 38.8, 3.03125],
			['1366x768', 41.4069, 3.03125],
			['1440x900', 43.65, 3.03125],
			['1920x1080', 58.2, 3.03125],
		]);
	});

	it('leaves the handheld camera untouched by the pan-limit change', () => {
		for (const viewport of HANDHELD_VIEWPORTS) {
			const before = settleCamera(viewport, { maxBounds: PRE_M6F2_MAX_BOUNDS });
			const after = settleCamera(viewport);
			expect(after.zoom).toBe(before.zoom);
			expect(after.centreLng).toBe(before.centreLng);
			expect(after.marginLeftPx).toBe(before.marginLeftPx);
			expect(after.marginRightPx).toBe(before.marginRightPx);
		}
	});

	// Why re-centring the pan limit — not shrinking the padding — is the fix for the
	// CONSTRAINED regime: while the constrain owns the camera, every split of the same
	// total settles to the identical camera, so no padding edit could have moved it.
	// This is a regime-scoped claim, NOT a general one — see the next test.
	it('ignores any left/right split while the constrain owns the camera', () => {
		const viewport = CONSTRAINED_DESKTOP_VIEWPORTS[2];
		const splits: Array<[number, number]> = [
			[0.37, 0.43],
			[0.4, 0.4],
			[0.43, 0.37],
			[0.6, 0.2],
		];
		const cameras = splits.map(([left, right]) =>
			settleCamera(viewport, {
				maxBounds: PRE_M6F2_MAX_BOUNDS,
				padding: {
					top: 56,
					bottom: 56,
					left: Math.round(viewport.width * left),
					right: Math.round(viewport.width * right),
				},
			}),
		);
		for (const camera of cameras) expect(camera).toEqual(cameras[0]);
		expect(cameras[0].offsetPx).toBeCloseTo(43.65, 2);
	});

	// SYMMETRY GUARD — the second half of the fix, and the arm the first receipt for
	// this slice was missing. Once the camera escapes the constrain the split reaches
	// it in full, so restoring the pre-M6f-2 0.37/0.43 must throw the island sharply
	// LEFT here. Deleting DESKTOP_LEFT/RIGHT_PAD_FRAC was therefore not a cleanup of
	// inert config — it is what centres this regime, and this test must fail if any
	// future edit reintroduces an asymmetric inset.
	it('is centred only by the SYMMETRY of the side inset once the camera escapes the constrain', () => {
		const biased = UNCONSTRAINED_DESKTOP_VIEWPORTS.map((viewport) => {
			const settled = settleCamera(viewport, {
				padding: {
					top: 56,
					bottom: 56,
					left: Math.round(viewport.width * 0.37),
					right: Math.round(viewport.width * 0.43),
				},
			});
			return [viewport.label, +settled.offsetPx.toFixed(4)];
		});
		expect(biased).toEqual([
			['1280x1440', -143.7005],
			['1440x1080', -94.3336],
		]);

		// ...while the shipped symmetric inset centres them exactly.
		for (const viewport of UNCONSTRAINED_DESKTOP_VIEWPORTS) {
			const settled = settleCamera(viewport);
			expect(Math.abs(settled.offsetPx)).toBeLessThan(CENTRED_PX);
			expect(settled.marginLeftPx).toBeCloseTo(settled.marginRightPx, 6);
		}
	});

	it('settles identically for any symmetric vertical inset', () => {
		for (const viewport of DESKTOP_VIEWPORTS) {
			const side = Math.round(viewport.width * 0.4);
			const cameras = [0, 56, 200].map((vertical) =>
				settleCamera(viewport, {
					padding: { top: vertical, bottom: vertical, left: side, right: side },
				}),
			);
			for (const camera of cameras) expect(camera).toEqual(cameras[0]);
		}
	});
});
