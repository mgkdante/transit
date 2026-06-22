import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '$lib/motion/policy';
import { gsap } from '$lib/motion/utils/gsap';
import { VEHICLE_SOURCE, type VehicleFC, type VehicleFeature } from './vehicleLayer';
import { buildPathBetween, chordBearing, type Coord, type PathInterpolator } from './polyline';

/**
 * Per-frame silence-opacity refresher. Given a feature, returns its CURRENT fade
 * (read off the live skew-free clock) so a bus that goes quiet BETWEEN polls
 * visibly fades without waiting for the next poll. Returning the feature's own
 * `opacity` (a no-op) leaves the poll-time value untouched. Wired by MapHero off
 * `sharedClock.serverNow`; omitted under reduced motion (no per-frame fade).
 */
export type OpacityRefresher = (feature: VehicleFeature) => number;

/**
 * Resolve a vehicle's route SHAPE (an ordered lon/lat polyline) so the tween can
 * walk ALONG the street instead of cutting a straight chord. Returns null when no
 * shape is loaded for that vehicle's route — the tween then falls back to the
 * chord, so every bus stays correct whether or not its geometry has resolved.
 *
 * Keyed by the VehicleFeature (it carries `route` + `id`) so the caller can pick
 * the right direction-variant per vehicle. Called ONCE per vehicle at re-target
 * (when the tween is built), never per frame — the resulting per-vehicle
 * `PathInterpolator` is cached for the life of the tween (perf).
 */
export type ShapeResolver = (feature: VehicleFeature) => readonly Coord[] | null;

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
	/**
	 * Optional per-vehicle route-shape supplier for path-following motion (L1).
	 * Resolved ONCE per re-target into a precomputed sampler; missing shapes fall
	 * back to the straight chord. Omit to keep pure chord motion.
	 */
	shapeFor?: ShapeResolver;
}

export interface VehicleMotionController {
	set(features: VehicleFC, options?: VehicleMotionOptions): void;
	destroy(): void;
}

type Progress = { value: number };

const DEFAULT_DURATION_SEC = 28;
/**
 * Clamp the per-re-target tween duration into a sane band. The duration is the
 * real inter-fix interval (server-time gap between consecutive vehicles files),
 * so the bus is still easing toward its last known fix right up until the next
 * one arrives — no idle freeze. Floored so a burst of files doesn't produce a
 * jittery sub-second tween; ceilinged so an abnormally long gap doesn't crawl
 * (silence-fade takes over for a genuinely stale bus, which is the honest signal
 * — we never extend motion to fake continued travel).
 */
const MIN_DURATION_SEC = 4;
const MAX_DURATION_SEC = 45;

export function clampDurationSec(durationSec: number | undefined): number {
	if (durationSec == null || !Number.isFinite(durationSec)) return DEFAULT_DURATION_SEC;
	if (durationSec < MIN_DURATION_SEC) return MIN_DURATION_SEC;
	if (durationSec > MAX_DURATION_SEC) return MAX_DURATION_SEC;
	return durationSec;
}

/**
 * Minimum gap between source.setData calls while a tween runs (~30fps). A multi-
 * second position lerp does not need 60fps: each render() rebuilds the whole
 * vehicle FeatureCollection (interpolate over N features) and calls setData, so
 * at hundreds of buses 60fps is wasteful. We coalesce intermediate frames to
 * ~30fps but NEVER skip the terminal frame (onComplete/snap renders
 * unconditionally), so the bus still lands exactly on the real target at t=1.
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

/**
 * A vehicle's precomputed per-tween motion plan. Built ONCE at re-target so the
 * per-frame render is cheap: either a path-follow sampler (walk the route shape
 * between the two real fixes) or the straight chord (the honest fallback).
 *
 * `path` is non-null only when a shape resolved AND both fixes projected onto it
 * safely; otherwise the chord is used. `chordHeading` is the travel direction of
 * the straight from→to (null when the bus did not move).
 */
interface MotionPlan {
	path: PathInterpolator | null;
	chordHeading: number | null;
}

/**
 * Compute the per-vehicle motion plan for the current re-target. Pure given the
 * inputs; the result is reused across every frame of the tween.
 */
function planFor(
	from: VehicleFeature | undefined,
	to: VehicleFeature,
	shapeFor?: ShapeResolver,
): MotionPlan {
	if (!from) return { path: null, chordHeading: null };
	const fromPoint = from.geometry.coordinates as Coord;
	const toPoint = to.geometry.coordinates as Coord;
	const chordHeading = chordBearing(fromPoint, toPoint);
	const shape = shapeFor?.(to) ?? null;
	const path = shape ? buildPathBetween(shape, fromPoint, toPoint) : null;
	return { path, chordHeading };
}

/**
 * Interpolate ONE vehicle at progress `t` — strictly an ESTIMATE of where the
 * bus is BETWEEN its two real reported fixes (never an extrapolation past the
 * last one; `t` is clamped by the caller and the path walk is arc-bounded).
 *
 * Position: walk the route shape when a `plan.path` is available (follows the
 * street), else straight-line lerp the chord. Heading (L3): prefer the DIRECTION
 * OF TRAVEL — the path tangent or, chord-only, the chord bearing — because that
 * is where the bus is actually going; fall back to the feed `bearing` (slerped)
 * when the bus is effectively stationary (no travel direction to report), and to
 * no chevron at all when the feed never gave a heading (hasHeading handled by the
 * layer).
 */
function interpolateFeature(
	from: VehicleFeature | undefined,
	to: VehicleFeature,
	t: number,
	plan?: MotionPlan,
): VehicleFeature {
	if (!from) return to;
	const [fromLon, fromLat] = from.geometry.coordinates;
	const [toLon, toLat] = to.geometry.coordinates;

	// Default: straight chord + feed-bearing slerp (the honest baseline).
	let lon = fromLon + (toLon - fromLon) * t;
	let lat = fromLat + (toLat - fromLat) * t;
	let bearing = interpolateBearing(from.properties.bearing, to.properties.bearing, t);

	if (plan?.path) {
		// L1 path-follow: position + travel-direction tangent along the route shape.
		const sample = plan.path(t);
		lon = sample.coord[0];
		lat = sample.coord[1];
		bearing = Math.round(normalizeBearing(sample.bearing));
	} else if (plan && plan.chordHeading != null) {
		// L3 chord-only: heading is the direction of travel of the straight chord.
		bearing = Math.round(normalizeBearing(plan.chordHeading));
	}
	// else: bus did not move (chordHeading null) → keep the feed-bearing slerp.

	return {
		...to,
		geometry: {
			type: 'Point',
			coordinates: [roundCoordinate(lon), roundCoordinate(lat)],
		},
		properties: {
			...to.properties,
			bearing,
		},
	};
}

/**
 * Per-vehicle precomputed motion plans, keyed by vehicle id. Built once per
 * re-target and threaded through every frame so path-projection (the costly part)
 * runs once, not 30×/s × N buses.
 */
export type MotionPlanMap = ReadonlyMap<string, MotionPlan>;

export function buildMotionPlans(
	from: VehicleFC,
	to: VehicleFC,
	shapeFor?: ShapeResolver,
): MotionPlanMap {
	const previousById = new Map(from.features.map((feature) => [feature.properties.id, feature]));
	const plans = new Map<string, MotionPlan>();
	for (const feature of to.features) {
		plans.set(
			feature.properties.id,
			planFor(previousById.get(feature.properties.id), feature, shapeFor),
		);
	}
	return plans;
}

export function interpolateVehicleFeatures(
	from: VehicleFC,
	to: VehicleFC,
	progress: number,
	plans?: MotionPlanMap,
): VehicleFC {
	const t = clamp01(progress);
	const previousById = new Map(from.features.map((feature) => [feature.properties.id, feature]));

	return {
		type: 'FeatureCollection',
		features: to.features.map((feature) =>
			interpolateFeature(
				previousById.get(feature.properties.id),
				feature,
				t,
				plans?.get(feature.properties.id),
			),
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
	// Per-tween precomputed motion plans (path sampler / chord heading per
	// vehicle). Rebuilt at each re-target, consumed by every render() frame.
	let plans: MotionPlanMap | undefined;
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
		plans = undefined;
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
		// Interpolate POSITION as an ESTIMATE between two real fixes (path-follow
		// when a shape resolved, else the straight chord), then re-stamp OPACITY off
		// the live clock so a bus going silent mid-tween fades within the same window
		// (position is clamped [0,1] so a silent bus, reporting from==to, sits
		// still — it fades in place rather than drifting). Plans are precomputed, so
		// this frame only samples them.
		current = refreshFeatureOpacity(
			interpolateVehicleFeatures(from, target, progress.value, plans),
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
				// Same poll: keep the in-flight tween + its precomputed plans (a
				// filter/hover re-feed must not restart motion or re-project paths).
				if (tween) render();
				else snap(next, nextTickKey);
				return;
			}

			stopTween();
			from = current;
			target = next;
			tickKey = nextTickKey;
			progress.value = 0;
			// Precompute the per-vehicle path samplers ONCE for this interval (perf:
			// projection is the costly part; the per-frame render only samples them).
			plans = buildMotionPlans(from, next, options.shapeFor);

			tween = gsap.to(progress, {
				value: 1,
				duration: clampDurationSec(options.durationSec),
				// Ease OUT near t=1 so the bus SETTLES onto its last known fix rather
				// than hard-stopping — and then HOLDS there (silence-fade dims it if no
				// fresh fix arrives). We never extrapolate past t=1: the tween clamps at
				// the real target, honouring the no-faked-motion doctrine.
				ease: 'power1.out',
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
