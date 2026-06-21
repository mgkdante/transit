import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '$lib/motion/policy';
import { gsap } from '$lib/motion/utils/gsap';
import { VEHICLE_SOURCE, type VehicleFC, type VehicleFeature } from './vehicleLayer';

/**
 * Per-frame silence-opacity refresher. Given a feature, returns its CURRENT fade
 * (read off the live skew-free clock) so a bus that goes quiet BETWEEN polls
 * visibly fades without waiting for the next poll. Returning the feature's own
 * `opacity` (a no-op) leaves the poll-time value untouched. Wired by MapHero off
 * `sharedClock.serverNow`; omitted under reduced motion (no per-frame fade).
 */
export type OpacityRefresher = (feature: VehicleFeature) => number;

export interface VehicleMotionOptions {
	tickKey?: string | null;
	stale?: boolean;
	durationSec?: number;
	animate?: boolean;
	/**
	 * Recompute each vehicle's silence opacity per animation frame from the live
	 * clock. Only used while a tween is running (continuous fade); poll-time
	 * opacity is already baked into the features otherwise.
	 */
	refreshOpacity?: OpacityRefresher;
}

export interface VehicleMotionController {
	set(features: VehicleFC, options?: VehicleMotionOptions): void;
	destroy(): void;
}

type Progress = { value: number };

const DEFAULT_DURATION_SEC = 28;

/**
 * Minimum gap between source.setData calls while a tween runs (~30fps). A 28s
 * position lerp does not need 60fps: each render() rebuilds the whole vehicle
 * FeatureCollection (interpolate over N features) and calls setData, so at
 * hundreds of buses 60fps is wasteful. We coalesce intermediate frames to ~30fps
 * but NEVER skip the terminal frame (onComplete/snap renders unconditionally),
 * so the bus still lands exactly on the real target at t=1.
 */
const MIN_RENDER_INTERVAL_MS = 1000 / 30;

function clamp01(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

function roundCoordinate(value: number): number {
	return Number(value.toFixed(6));
}

function normalizeBearing(value: number): number {
	return ((value % 360) + 360) % 360;
}

function interpolateBearing(from: number, to: number, t: number): number {
	const delta = ((to - from + 540) % 360) - 180;
	return Math.round(normalizeBearing(from + delta * t));
}

function interpolateFeature(
	from: VehicleFeature | undefined,
	to: VehicleFeature,
	t: number,
): VehicleFeature {
	if (!from) return to;
	const [fromLon, fromLat] = from.geometry.coordinates;
	const [toLon, toLat] = to.geometry.coordinates;

	return {
		...to,
		geometry: {
			type: 'Point',
			coordinates: [
				roundCoordinate(fromLon + (toLon - fromLon) * t),
				roundCoordinate(fromLat + (toLat - fromLat) * t),
			],
		},
		properties: {
			...to.properties,
			bearing: interpolateBearing(from.properties.bearing, to.properties.bearing, t),
		},
	};
}

export function interpolateVehicleFeatures(
	from: VehicleFC,
	to: VehicleFC,
	progress: number,
): VehicleFC {
	const t = clamp01(progress);
	const previousById = new Map(from.features.map((feature) => [feature.properties.id, feature]));

	return {
		type: 'FeatureCollection',
		features: to.features.map((feature) =>
			interpolateFeature(previousById.get(feature.properties.id), feature, t),
		),
	};
}

function setVehicleSourceData(map: MapLibreMap, features: VehicleFC): void {
	const source = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	source?.setData(features as unknown as Parameters<GeoJSONSource['setData']>[0]);
}

/** Re-stamp each feature's `opacity` from the live clock (silence fade). Returns
 * a NEW collection (does not mutate the input) so the source data is replaced
 * cleanly. A no-op when no refresher is supplied. */
function refreshFeatureOpacity(fc: VehicleFC, refresh?: OpacityRefresher): VehicleFC {
	if (!refresh) return fc;
	return {
		type: 'FeatureCollection',
		features: fc.features.map((feature) => {
			const opacity = refresh(feature);
			if (opacity === feature.properties.opacity) return feature;
			return { ...feature, properties: { ...feature.properties, opacity } };
		}),
	};
}

export function createVehicleMotionController(map: MapLibreMap): VehicleMotionController {
	let current: VehicleFC | null = null;
	let from: VehicleFC | null = null;
	let target: VehicleFC | null = null;
	let tickKey: string | null = null;
	let tween: gsap.core.Tween | null = null;
	let refreshOpacity: OpacityRefresher | undefined;
	// Timestamp (performance.now) of the last setData, used to coalesce the
	// per-frame tween render down to ~30fps. NOT Date.now() — a monotonic clock
	// so a wall-clock adjustment cannot stall or burst the throttle.
	let lastSetDataMs = Number.NEGATIVE_INFINITY;
	const progress: Progress = { value: 0 };

	function now(): number {
		return typeof performance !== 'undefined' && typeof performance.now === 'function'
			? performance.now()
			: Date.now();
	}

	function stopTween(): void {
		tween?.kill();
		tween = null;
	}

	function snap(next: VehicleFC, nextTickKey: string | null): void {
		stopTween();
		current = next;
		from = next;
		target = next;
		tickKey = nextTickKey;
		progress.value = 1;
		lastSetDataMs = now();
		setVehicleSourceData(map, next);
	}

	/**
	 * Rebuild the interpolated FeatureCollection and push it to the source.
	 *
	 * `throttled` is true for the tween's per-frame `onUpdate`: such a frame is
	 * SKIPPED if less than ~33ms has elapsed since the last setData (caps GL cost
	 * at ~30fps). The terminal frame (onComplete → snap) and re-targets call this
	 * unthrottled, so the bus always lands exactly on the real target at t=1 — the
	 * throttle only ever drops cheap intermediate frames, never the final one.
	 */
	function render(throttled = false): void {
		if (!from || !target) return;
		if (throttled && now() - lastSetDataMs < MIN_RENDER_INTERVAL_MS) return;
		// Interpolate POSITION between two real fixes, then re-stamp OPACITY off the
		// live clock so a bus going silent mid-tween fades within the same window
		// (position is clamped [0,1] so a silent bus, reporting from==to, sits
		// still — it fades in place rather than drifting).
		current = refreshFeatureOpacity(
			interpolateVehicleFeatures(from, target, progress.value),
			refreshOpacity,
		);
		lastSetDataMs = now();
		setVehicleSourceData(map, current);
	}

	return {
		set(next: VehicleFC, options: VehicleMotionOptions = {}) {
			const nextTickKey = options.tickKey ?? null;
			const animate = options.animate ?? shouldAnimate('motion-gated');
			// Latest refresher wins; used by the running tween's per-frame render.
			refreshOpacity = options.refreshOpacity;

			if (options.stale || !animate || !current) {
				snap(next, nextTickKey);
				return;
			}

			if (nextTickKey === tickKey) {
				target = next;
				if (tween) render();
				else snap(next, nextTickKey);
				return;
			}

			stopTween();
			from = current;
			target = next;
			tickKey = nextTickKey;
			progress.value = 0;

			tween = gsap.to(progress, {
				value: 1,
				duration: options.durationSec ?? DEFAULT_DURATION_SEC,
				ease: 'none',
				// Per-frame updates are throttled to ~30fps; the terminal frame lands
				// via onComplete → snap (unthrottled), so t=1 is never dropped.
				onUpdate: () => render(true),
				onComplete: () => snap(next, nextTickKey),
			});
		},
		destroy() {
			stopTween();
		},
	};
}
