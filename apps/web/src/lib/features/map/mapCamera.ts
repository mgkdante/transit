import { coveredArea } from './mapCameraCoveredArea';
export { coveredArea } from './mapCameraCoveredArea';
import {
	centerFromProviderBbox,
	mapViewportOptions,
	type MapFitPadding,
} from '#lib/components/map/viewport.ts';
import { mapCameraFraming, deriveMapFitPadding } from './mapCameraFraming';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '@yesid/motion/policy';
import { duration } from '@yesid/motion/tokens';
import type { RouteFile } from '#lib/v1/index.ts';
import { routeBoundsFromFile } from './mapGeo';
import { deferMapFocusInset } from './mapFocusInset';

const FOCUS_EVENT_DATA = { cameraIntent: 'focus' } as const;

function easeOut(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	let lower = 0;
	let upper = 1;
	let parameter = 0;
	for (let iteration = 0; iteration < 24; iteration += 1) {
		parameter = (lower + upper) / 2;
		const x = parameter ** 3 - 0.6 * parameter ** 2 + 0.6 * parameter;
		if (x < t) lower = parameter;
		else upper = parameter;
	}
	return 0.4 * parameter ** 3 - 1.8 * parameter ** 2 + 2.4 * parameter;
}

export function panTo(
	map: CameraMap | null,
	center: [number, number],
	zoom: number,
	insets?: MapFitPadding,
): void {
	if (!map) return;
	const consume = ({ pointOffset }: Pick<ReturnType<typeof coveredArea>, 'pointOffset'>) => {
		const camera = { center, zoom, offset: pointOffset, easing: easeOut };
		if (shouldAnimate('motion-gated')) {
			map.flyTo({ ...camera, essential: true }, FOCUS_EVENT_DATA);
		} else {
			map.easeTo({ ...camera, duration: 0 }, FOCUS_EVENT_DATA);
		}
	};
	if (insets !== undefined) consume(coveredArea(insets));
	else deferMapFocusInset(map, consume);
}

export function focusCoordinate(
	map: CameraMap | null,
	coord: [number, number],
	minZoom: number,
	insets?: MapFitPadding,
): boolean {
	if (!map) return false;
	panTo(map, coord, Math.max(map.getZoom(), minZoom), insets);
	return true;
}

export function fitRouteBounds(
	map: CameraMap | null,
	route: RouteFile,
	insets?: MapFitPadding,
): boolean {
	if (!map) return false;
	const bounds = routeBoundsFromFile(route);
	if (!bounds) return false;
	const consume = ({ routePadding }: Pick<ReturnType<typeof coveredArea>, 'routePadding'>) => {
		map.fitBounds(
			bounds,
			{
				padding: routePadding,
				maxZoom: 15,
				duration: shouldAnimate('motion-gated') ? duration.slower : 0,
				easing: easeOut,
			},
			FOCUS_EVENT_DATA,
		);
	};
	if (insets !== undefined) consume(coveredArea(insets));
	else deferMapFocusInset(map, consume);
	return true;
}

export const INITIAL_MAP_ZOOM = 11;
export type CameraMap = Pick<
	MapLibreMap,
	| 'flyTo'
	| 'easeTo'
	| 'getContainer'
	| 'jumpTo'
	| 'fitBounds'
	| 'setMaxBounds'
	| 'getCenter'
	| 'getZoom'
	| 'getBearing'
	| 'getPitch'
	| 'getRoll'
	| 'getPadding'
>;
export interface CameraInputs {
	center?: [number, number];
	zoom?: number;
	bounds?: readonly number[];
	maxBounds?: readonly number[];
	fitPadding?: MapFitPadding;
}
type CameraOwner = 'fit' | 'user' | 'focus';
export interface CameraRecoveryView {
	center: [number, number];
	zoom: number;
	bearing: number;
	pitch: number;
	roll: number;
	padding: ReturnType<MapLibreMap['getPadding']>;
	owner: CameraOwner;
	fitInputsKey: string;
	layoutInputsKey: string;
	cameraInputsKey: string;
}

function cameraKey(nextCenter: [number, number], nextZoom: number): string {
	return `${nextCenter[0]},${nextCenter[1]},${nextZoom}`;
}

function fitPaddingKey(nextPadding: MapFitPadding): string {
	if (typeof nextPadding === 'number') return `${nextPadding}`;
	return [
		nextPadding.top ?? '',
		nextPadding.right ?? '',
		nextPadding.bottom ?? '',
		nextPadding.left ?? '',
	].join(',');
}

function fitKey(nextBounds: readonly number[] | undefined, nextPadding: MapFitPadding): string {
	return `${nextBounds?.join(',') ?? 'fallback'}:${fitPaddingKey(nextPadding)}`;
}

/** Production initial framing, including the hydration-safe desktop snapshot. */
export function initialCamera(
	source: Parameters<typeof mapCameraFraming>[0],
	width: number,
	desktop = width >= 1024,
) {
	const framing = mapCameraFraming(source);
	return {
		...framing,
		zoom: INITIAL_MAP_ZOOM,
		fitPadding: coveredArea(deriveMapFitPadding(desktop, width)).padding,
	};
}

export function createMapCamera<Selection = unknown>() {
	let cameraOwner: CameraOwner = 'fit';
	let activeFitKey: string | null = null;
	let activeLayoutSig: string | null = null;
	let activeBoundsSig: string | null = null;
	let activeCameraKey: string | null = null;
	function inputs(value: CameraInputs) {
		const {
			center = centerFromProviderBbox(),
			zoom = INITIAL_MAP_ZOOM,
			fitPadding = 40,
			...rest
		} = value;
		return { ...rest, center, zoom, fitPadding };
	}
	return {
		intents: createCameraIntents<Selection>(),
		initial(value: CameraInputs) {
			const { center, zoom, bounds, maxBounds, fitPadding } = inputs(value);
			return { center, zoom, ...mapViewportOptions(bounds, fitPadding, maxBounds) };
		},
		capture(instance: CameraMap, value: CameraInputs): CameraRecoveryView {
			const { center, zoom, bounds, maxBounds, fitPadding } = inputs(value);
			const position = instance.getCenter();
			const view: CameraRecoveryView = {
				center: [position.lng, position.lat],
				zoom: instance.getZoom(),
				bearing: instance.getBearing(),
				pitch: instance.getPitch(),
				roll: instance.getRoll(),
				padding: { ...instance.getPadding() },
				owner: cameraOwner,
				fitInputsKey: `${fitKey(bounds, fitPadding)}|${maxBounds?.join(',') ?? ''}`,
				layoutInputsKey: fitPaddingKey(fitPadding),
				cameraInputsKey: cameraKey(center, zoom),
			};

			return view;
		},
		attach(instance: CameraMap, value: CameraInputs, recoveryView?: CameraRecoveryView) {
			const { center, zoom, bounds, maxBounds, fitPadding } = inputs(value);
			const currentFitKey = `${fitKey(bounds, fitPadding)}|${maxBounds?.join(',') ?? ''}`;
			const currentCameraKey = cameraKey(center, zoom);
			const fitInputsChanged =
				recoveryView?.owner === 'fit' &&
				(recoveryView.fitInputsKey !== currentFitKey ||
					recoveryView.cameraInputsKey !== currentCameraKey);
			if (recoveryView && !fitInputsChanged) {
				instance.jumpTo({
					center: recoveryView.center,
					zoom: recoveryView.zoom,
					bearing: recoveryView.bearing,
					pitch: recoveryView.pitch,
					roll: recoveryView.roll,
					padding: recoveryView.padding,
				});
			} else if (recoveryView && fitInputsChanged) {
				instance.jumpTo({
					...(recoveryView.cameraInputsKey !== currentCameraKey ? { center, zoom } : {}),
					bearing: recoveryView.bearing,
					pitch: recoveryView.pitch,
					roll: recoveryView.roll,
					...(recoveryView.layoutInputsKey === fitPaddingKey(fitPadding)
						? { padding: recoveryView.padding }
						: {}),
				});
			}

			activeLayoutSig = fitPaddingKey(fitPadding);
			activeBoundsSig = `${bounds?.join(',') ?? 'fallback'}|${maxBounds?.join(',') ?? ''}`;
			activeCameraKey = currentCameraKey;
			cameraOwner = recoveryView?.owner ?? 'fit';
			if (recoveryView) activeFitKey = currentFitKey;
		},
		claim(value: unknown) {
			const event = value as { originalEvent?: unknown; cameraIntent?: unknown };
			if (event.cameraIntent === 'focus') cameraOwner = 'focus';
			else if (event.originalEvent) cameraOwner = 'user';
		},
		interact() {
			cameraOwner = 'user';
		},
		update(m: CameraMap, value: CameraInputs) {
			const { center, zoom, bounds, maxBounds, fitPadding } = inputs(value);
			const nextFitKey = `${fitKey(bounds, fitPadding)}|${maxBounds?.join(',') ?? ''}`;
			if (activeFitKey !== nextFitKey) {
				activeFitKey = nextFitKey;
				const nextLayoutSig = fitPaddingKey(fitPadding);
				const nextBoundsSig = `${bounds?.join(',') ?? 'fallback'}|${maxBounds?.join(',') ?? ''}`;
				const layoutChanged = activeLayoutSig !== nextLayoutSig;
				const boundsChanged = activeBoundsSig !== nextBoundsSig;
				if (layoutChanged || boundsChanged) {
					activeLayoutSig = nextLayoutSig;
					activeBoundsSig = nextBoundsSig;
					const viewport = mapViewportOptions(bounds, fitPadding, maxBounds);
					if (boundsChanged) m.setMaxBounds(viewport.maxBounds);
					if (cameraOwner === 'fit') {
						m.fitBounds(viewport.bounds, { ...viewport.fitBoundsOptions, duration: 0 });
					}
				}
			}
			const nextCenter = center;
			const nextZoom = zoom;
			const nextCameraKey = cameraKey(nextCenter, nextZoom);
			if (activeCameraKey === nextCameraKey) return;
			activeCameraKey = nextCameraKey;
			if (cameraOwner === 'fit') m.jumpTo({ center: nextCenter, zoom: nextZoom });
		},
	};
}

export type CameraIntent<Selection> =
	| { kind: 'point'; coord: [number, number]; minZoom: number }
	| { kind: 'selection'; selection: Selection }
	| { kind: 'url' };

/** Retain only the latest intent while the runtime is being replaced. */
function createCameraIntents<Selection>() {
	let pending: CameraIntent<Selection> | null = null;
	return {
		get pending() {
			return pending;
		},
		state(intent: CameraIntent<Selection> | null) {
			pending = intent;
		},
		replay(consume: (intent: Exclude<CameraIntent<Selection>, { kind: 'url' }>) => void) {
			const intent = pending;
			pending = null;
			if (intent && intent.kind !== 'url') consume(intent);
		},
	};
}

export type CameraLifecycle = Pick<
	ReturnType<typeof createMapCamera>,
	'initial' | 'capture' | 'attach' | 'claim' | 'interact' | 'update'
>;
