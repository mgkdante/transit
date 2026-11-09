import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type MapFitPadding } from '#lib/components/map/viewport.ts';
import providerFixtures from '../../../../e2e/providers.json';
import { RouteFileSchema } from '#lib/v1/schemas/route.ts';
import { focusCoordinate, fitRouteBounds } from './mapCamera';
import { mapCameraFraming } from './mapCameraFraming';
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

type Viewport = { label: string; width: number; height: number };

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
	const value = {
		size: viewport,
		...inputs,
		...(padding === undefined ? {} : { fitPadding: padding }),
	};
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
		setMinZoom(zoom) {
			transform.setMinZoom(zoom ?? 0);
			return this as ReturnType<CameraMap['setMinZoom']>;
		},
		setMaxBounds(bounds) {
			transform.setMaxBounds(bounds ? LngLatBounds.convert(bounds) : undefined);
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
				{
					padding: box,
					offset: (fit.offset ?? [0, 0]) as [number, number],
					maxZoom: fit.maxZoom ?? options.maxZoom!,
				},
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
		for (const width of [1280, 1440, 1536, 1600, 1920]) {
			it.each(['none', 'rail', 'left', 'right', 'both'])(
				`${provider.name} centres or clears %s at ${width}`,
				(state) => {
					const viewport = { label: state, width, height: width === 1920 ? 1080 : 864 };
					const pad = {
						top: 160,
						bottom: 72,
						left: state === 'left' || state === 'both' ? 332 : 16,
						right: state === 'right' || state === 'both' ? 332 : 16,
					};
					const inputs = initialCamera({ manifest: { bbox: provider.bbox }, provider }, width);
					const screen = transformCamera(viewport, inputs, { ...pad, left: 16, right: 16 });
					const corner = (transform: MapLibreTransform, east: boolean) =>
						transform.locationToScreenPoint(
							new LngLat(provider.fit_bounds[east ? 2 : 0], provider.fit_bounds[3]),
						);
					const fullWidth = corner(screen.transform, true).x - corner(screen.transform, false).x;
					const fitted = transformCamera(viewport, inputs, pad);
					const west = corner(fitted.transform, false).x;
					const east = corner(fitted.transform, true).x;
					const fits = fullWidth <= width - pad.left - pad.right;
					const expected = fits
						? Math.max(
								pad.left + fullWidth / 2,
								Math.min(width / 2, width - pad.right - fullWidth / 2),
							)
						: (width + pad.left - pad.right) / 2;
					expect((west + east) / 2).toBeCloseTo(expected, 6);
					expect(west).toBeGreaterThanOrEqual(pad.left - 1e-6);
					expect(east).toBeLessThanOrEqual(width - pad.right + 1e-6);
					expect(fitted.map.getZoom()).toBeCloseTo(
						fits
							? screen.map.getZoom()
							: Math.log2((width - pad.left - pad.right) / fullWidth) + screen.map.getZoom(),
						6,
					);
				},
			);
		}
		it.each([
			{ label: '360x800', width: 360, height: 800 },
			{ label: '844x390', width: 844, height: 390 },
			{ label: '390x844', width: 390, height: 844 },
			{ label: '768x1024', width: 768, height: 1024 },
			{ label: '1280x900', width: 1280, height: 900 },
			{ label: '1920x1080', width: 1920, height: 1080 },
		])(provider.name + ' preserves fit, user ownership and recovery at $label', (viewport) => {
			const inputs = initialCamera({ manifest: { bbox: provider.bbox }, provider }, viewport.width);
			const { map, controller, value, transform } = transformCamera(viewport, inputs);
			const pad = paddingObject(inputs.fitPadding);
			for (const lng of [provider.fit_bounds[0], provider.fit_bounds[2]]) {
				for (const lat of [provider.fit_bounds[1], provider.fit_bounds[3]]) {
					const point = transform.locationToScreenPoint(new LngLat(lng, lat));
					expect(point.x).toBeGreaterThanOrEqual(pad.left - 1e-6);
					expect(point.x).toBeLessThanOrEqual(viewport.width - pad.right + 1e-6);
					expect(point.y).toBeGreaterThanOrEqual(pad.top - 1e-6);
					expect(point.y).toBeLessThanOrEqual(viewport.height - pad.bottom + 1e-6);
				}
			}
			const nw = transform.locationToScreenPoint(
				new LngLat(provider.fit_bounds[0], provider.fit_bounds[3]),
			);
			const se = transform.locationToScreenPoint(
				new LngLat(provider.fit_bounds[2], provider.fit_bounds[1]),
			);
			const halfWidth = (se.x - nw.x) / 2;
			const expectedX = Math.max(
				pad.left + halfWidth,
				Math.min(viewport.width / 2, viewport.width - pad.right - halfWidth),
			);
			expect((nw.x + se.x) / 2).toBeCloseTo(expectedX, 6);
			expect((nw.y + se.y) / 2).toBeCloseTo((pad.top + viewport.height - pad.bottom) / 2, 6);
			const fitZoom = map.getZoom();
			transform.setZoom(0);
			expect(transform.zoom).toBeCloseTo(fitZoom, 6);
			const settled = [map.getZoom(), map.getCenter().lng, map.getCenter().lat];
			expect(settled).toMatchSnapshot();
			if (viewport.width >= 1024) {
				for (const panelWidth of [300, 560]) {
					const detail = transformCamera(viewport, inputs, { ...pad, right: panelWidth + 16 });
					const corner = detail.transform.locationToScreenPoint(
						new LngLat(provider.fit_bounds[2], provider.fit_bounds[3]),
					);
					expect(corner.x).toBeLessThanOrEqual(viewport.width - panelWidth - 16 + 1e-6);
				}
			}
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
			focus.controller.attach(recoveredFocus.map, { ...inputs, size: viewport }, focusRecovery);
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
			replacement.controller.attach(
				replacement.map,
				{ ...inputs, size: viewport, fitPadding: 80 },
				recovery,
			);
			expect([
				replacement.map.getZoom(),
				replacement.map.getCenter().lng,
				replacement.map.getCenter().lat,
			]).toEqual(settled);
		});
	}
});

it('refits on rotation and detail opening only while fit-owned', () => {
	const viewport = { label: 'rotating', width: 390, height: 844 };
	const inputs = initialCamera(
		{
			manifest: { bbox: [...ISLAND_FIT_BOUNDS] },
			provider: { fit_bounds: [...ISLAND_FIT_BOUNDS], max_bounds: [...MAP_MAX_BOUNDS] },
		},
		viewport.width,
	);
	const { map, transform, controller, value } = transformCamera(viewport, inputs);
	const before = map.getZoom();
	viewport.width = 844;
	viewport.height = 390;
	transform.resize(viewport.width, viewport.height);
	const padding = { top: 90, bottom: 110, left: 16, right: 16 };
	controller.update(map, { ...value, size: { ...viewport }, fitPadding: padding });
	expect(map.getZoom()).not.toBe(before);
	for (const lng of [ISLAND_FIT_BOUNDS[0], ISLAND_FIT_BOUNDS[2]]) {
		for (const lat of [ISLAND_FIT_BOUNDS[1], ISLAND_FIT_BOUNDS[3]]) {
			const point = transform.locationToScreenPoint(new LngLat(lng, lat));
			expect(point.x).toBeGreaterThanOrEqual(16 - 1e-6);
			expect(point.x).toBeLessThanOrEqual(828 + 1e-6);
			expect(point.y).toBeGreaterThanOrEqual(90 - 1e-6);
			expect(point.y).toBeLessThanOrEqual(280 + 1e-6);
		}
	}
	controller.update(map, { ...value, fitPadding: { ...padding, bottom: 190 } });
	const detailedZoom = map.getZoom();
	controller.interact();
	controller.update(map, { ...value, fitPadding: 16 });
	expect(map.getZoom()).toBe(detailedZoom);
	for (const center of [
		[-73.72, 45.558],
		[-73.682, 45.56],
		[-73.66, 45.56],
		[-73.522, 45.525],
	] as [number, number][]) {
		map.jumpTo({ center, zoom: 14 });
		expect(map.getCenter().lng).toBeCloseTo(center[0], 6);
		expect(map.getCenter().lat).toBeCloseTo(center[1], 6);
	}
});
