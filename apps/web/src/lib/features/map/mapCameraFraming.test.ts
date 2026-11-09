import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type MapFitPadding } from '#lib/components/map/viewport.ts';
import providerFixtures from '../../../../e2e/providers.json';
import { RouteFileSchema } from '#lib/v1/schemas/route.ts';
import { focusCoordinate, fitRouteBounds } from './mapCamera';
import { deriveMapFitPadding, mapCameraFraming } from './mapCameraFraming';
import { createMapCamera, initialCamera, type CameraMap, type CameraInputs } from './mapCamera';

const ISLAND_FIT_BOUNDS = [-73.9757, 45.4022, -73.4764, 45.7028] as const;
const MAP_MAX_BOUNDS = [-74.28605, 45.3, -73.16605, 45.82] as const;
const mapInitialCenter: [number, number] = [-73.72605, 45.5525];

it('uses selected provider framing, falling back only to its own service bounds', () => {
	const bbox = [-76.05, 45.1, -75.33, 45.55];
	expect(mapCameraFraming({ manifest: { bbox } } as never)).toEqual({
		bounds: bbox,
		maxBounds: bbox,
		center: [-75.69, 45.325],
	});
	const stm = mapCameraFraming({
		manifest: { bbox: [-74.1, 45.25, -73.2, 45.75] },
		provider: { fit_bounds: ISLAND_FIT_BOUNDS, max_bounds: MAP_MAX_BOUNDS },
	} as never);
	expect(stm).toEqual({
		bounds: ISLAND_FIT_BOUNDS,
		maxBounds: MAP_MAX_BOUNDS,
		center: mapInitialCenter,
	});
});

const maplibrePackage = pathToFileURL(
	createRequire(import.meta.url).resolve('maplibre-gl/package.json'),
);
const MERCATOR_TRANSFORM_MODULE = new URL(
	'src/geo/projection/mercator_transform.ts',
	maplibrePackage,
).href;
const CAMERA_HELPER_MODULE = new URL('src/geo/projection/camera_helper.ts', maplibrePackage).href;
const LNG_LAT_MODULE = new URL('src/geo/lng_lat.ts', maplibrePackage).href;
const LNG_LAT_BOUNDS_MODULE = new URL('src/geo/lng_lat_bounds.ts', maplibrePackage).href;

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

const PRE_M6F2_MAX_BOUNDS = [-74.32, 45.3, -73.2, 45.82] as const;
const CENTRED_PX = 1e-6;

type Viewport = { label: string; width: number; height: number };

const CONSTRAINED_DESKTOP_VIEWPORTS: Viewport[] = [
	{ label: '1280x720', width: 1280, height: 720 },
	{ label: '1366x768', width: 1366, height: 768 },
	{ label: '1440x900', width: 1440, height: 900 },
	{ label: '1920x1080', width: 1920, height: 1080 },
];

const UNCONSTRAINED_DESKTOP_VIEWPORTS: Viewport[] = [
	{ label: '1280x1440', width: 1280, height: 1440 },
	{ label: '1440x1080', width: 1440, height: 1080 },
];

const DESKTOP_VIEWPORTS: Viewport[] = [
	...CONSTRAINED_DESKTOP_VIEWPORTS,
	...UNCONSTRAINED_DESKTOP_VIEWPORTS,
];

const HANDHELD_VIEWPORTS: Viewport[] = [
	{ label: '390x844', width: 390, height: 844 },
	{ label: '768x1024', width: 768, height: 1024 },
];

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

function transformCamera(viewport: Viewport, inputs: CameraInputs, padding?: MapFitPadding) {
	const controller = createMapCamera<[number, number]>();
	const value = { ...inputs, ...(padding === undefined ? {} : { fitPadding: padding }) };
	const options = controller.initial(value);
	const transform = new MercatorTransform();
	transform.setMinZoom(options.minZoom!);
	transform.setMaxZoom(options.maxZoom!);
	transform.setRenderWorldCopies(options.renderWorldCopies!);
	transform.setMaxBounds(LngLatBounds.convert(options.maxBounds));
	transform.setZoom(options.zoom);
	transform.setCenter(LngLat.convert(options.center));
	transform.resize(viewport.width, viewport.height);
	const map: CameraMap = {
		getContainer: () => {
			throw new Error('The transform adapter requires explicit covered-area insets');
		},
		flyTo(camera, event) {
			controller.claim(event);
			return map.jumpTo({ center: camera.center, zoom: camera.zoom });
		},
		easeTo(camera, event) {
			controller.claim(event);
			return map.jumpTo({ center: camera.center, zoom: camera.zoom });
		},
		getCenter: () => transform.center as ReturnType<CameraMap['getCenter']>,
		getZoom: () => transform.zoom,
		getBearing: () => 0,
		getPitch: () => 0,
		getRoll: () => 0,
		getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
		setMaxBounds(bounds) {
			transform.setMaxBounds(LngLatBounds.convert(bounds));
			return this as ReturnType<CameraMap['setMaxBounds']>;
		},
		jumpTo(camera) {
			if (camera.zoom !== undefined) transform.setZoom(camera.zoom);
			if (camera.center) transform.setCenter(LngLat.convert(camera.center));
			return this as ReturnType<CameraMap['jumpTo']>;
		},
		fitBounds(bounds, fit = {}, event) {
			controller.claim(event ?? {});
			const box = paddingObject(fit.padding ?? 0);
			const camera = cameraForBoxAndBearing(
				{ padding: box, offset: [0, 0], maxZoom: fit.maxZoom ?? options.maxZoom! },
				box,
				LngLatBounds.convert(bounds),
				0,
				transform,
			);
			if (!camera) throw new Error('MapLibre refused the fit for this viewport');
			transform.setZoom(camera.zoom);
			transform.setCenter(camera.center);
			transform.resize(viewport.width, viewport.height);
			return this as ReturnType<CameraMap['fitBounds']>;
		},
	};
	map.fitBounds(options.bounds, options.fitBoundsOptions);
	controller.attach(map, value);
	return { transform, map, controller, value };
}

function settleCamera(
	viewport: Viewport,
	overrides: { maxBounds?: readonly number[]; padding?: MapFitPadding } = {},
) {
	const { transform } = transformCamera(
		viewport,
		initialCamera(
			{
				manifest: { bbox: [...ISLAND_FIT_BOUNDS] },
				provider: {
					fit_bounds: [...ISLAND_FIT_BOUNDS],
					max_bounds: [...(overrides.maxBounds ?? MAP_MAX_BOUNDS)] as [
						number,
						number,
						number,
						number,
					],
				},
			},
			viewport.width,
		),
		overrides.padding,
	);

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

describe('camera interface through the transform adapter', () => {
	function bbox(value: number[]): [number, number, number, number] {
		if (value.length !== 4) throw new Error('Expected fixture bbox');
		return [value[0], value[1], value[2], value[3]];
	}
	const providers = providerFixtures.providers.map((provider) => ({
		name: provider.labels.en.operator,
		bbox: bbox(provider.max_bounds),
		fit_bounds: bbox(provider.fit_bounds),
		max_bounds: bbox(provider.max_bounds),
	}));

	for (const provider of providers) {
		it.each([
			{ label: '390x844', width: 390, height: 844 },
			{ label: '768x1024', width: 768, height: 1024 },
			{ label: '1280x800', width: 1280, height: 800 },
			{ label: '1920x1080', width: 1920, height: 1080 },
		])(provider.name + ' preserves fit, user ownership and recovery at $label', (viewport) => {
			const inputs = initialCamera({ manifest: { bbox: provider.bbox }, provider }, viewport.width);
			const { map, controller, value } = transformCamera(viewport, inputs);
			const settled = [map.getZoom(), map.getCenter().lng, map.getCenter().lat];
			expect(settled).toMatchSnapshot();
			const focus = transformCamera(viewport, inputs);
			const intents = focus.controller.intents;
			intents.state({
				kind: 'point',
				coord: [provider.bbox[0] + 0.2, provider.bbox[1] + 0.2],
				minZoom: 14,
			});
			intents.state({
				kind: 'selection',
				selection: [provider.bbox[0] + 0.3, provider.bbox[1] + 0.3],
			});
			intents.replay((intent) => {
				if (intent.kind === 'selection') focusCoordinate(focus.map, intent.selection, 14, 40);
			});
			expect(focus.map.getZoom()).toBe(14);
			expect(intents.pending).toBeNull();
			const focused = [focus.map.getCenter().lng, focus.map.getCenter().lat];
			focus.controller.update(focus.map, { ...inputs, fitPadding: 80 });
			expect([focus.map.getCenter().lng, focus.map.getCenter().lat]).toEqual(focused);
			const route = RouteFileSchema.parse({
				id: 'camera-route',
				generated_utc: '2026-11-08T00:00:00Z',
				directions: [
					{
						dir: 0,
						shape: {
							type: 'LineString',
							coordinates: [
								[provider.bbox[0] + 0.2, provider.bbox[1] + 0.2],
								[provider.bbox[2] - 0.2, provider.bbox[3] - 0.2],
							],
						},
					},
				],
			});
			expect(fitRouteBounds(focus.map, route, { top: 64, right: 64, bottom: 64, left: 64 })).toBe(
				true,
			);
			expect(focus.map.getZoom()).toBeLessThanOrEqual(15);
			const focusRecovery = focus.controller.capture(focus.map, inputs);
			intents.state({
				kind: 'point',
				coord: [provider.bbox[0] + 0.25, provider.bbox[1] + 0.25],
				minZoom: 15,
			});
			const recoveredFocus = transformCamera(viewport, inputs);
			focus.controller.attach(recoveredFocus.map, inputs, focusRecovery);
			intents.replay((intent) => {
				if (intent.kind === 'point')
					focusCoordinate(recoveredFocus.map, intent.coord, intent.minZoom, 40);
			});
			expect(recoveredFocus.map.getZoom()).toBe(15);
			expect(recoveredFocus.map.getCenter().lng).toBeCloseTo(provider.bbox[0] + 0.25, 8);
			expect(recoveredFocus.map.getCenter().lat).toBeCloseTo(provider.bbox[1] + 0.25, 8);

			controller.claim({ originalEvent: {} });
			controller.update(map, { ...value, fitPadding: 80 });
			expect([map.getZoom(), map.getCenter().lng, map.getCenter().lat]).toEqual(settled);
			const recovery = controller.capture(map, value);
			const replacement = transformCamera(viewport, { ...inputs, fitPadding: 80 });
			replacement.controller.attach(replacement.map, { ...inputs, fitPadding: 80 }, recovery);
			expect([
				replacement.map.getZoom(),
				replacement.map.getCenter().lng,
				replacement.map.getCenter().lat,
			]).toEqual(settled);
		});
	}
});
