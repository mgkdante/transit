import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '$lib/motion/policy';
import { VEHICLE_SOURCE, type VehicleFC, type VehicleFeature } from './vehicleLayer';
import type { Coord } from './polyline';
import { fixAgeS, projectVehicle, type ProjectVehicleResult } from './vehicleProjection';

/**
 * Per-vehicle inputs the FORWARD projection needs that are NOT carried on the GL
 * feature itself: the bus's OWN fix time (`reported_utc`, nullable → fall back to
 * the uniform snapshot `updated_utc`) and its speed in metres/second. Supplied by
 * MapHero alongside the feature collection so the controller can dead-reckon each
 * bus off its own latest fix without polluting the painted feature's typed props.
 */
export interface VehicleFix {
	/** The bus's OWN GTFS-RT fix time (ISO 8601), or null/undefined. */
	reportedUtc: string | null | undefined;
	/** The uniform snapshot capture time (ISO 8601) — the fallback for age. */
	updatedUtc: string;
	/** Reported speed in metres/second (≤ 0 or null → freeze, no dead-reckon). */
	speedMps: number | null;
}

/** Look up a vehicle's projection inputs by id. Returns null when unknown (the
 *  controller then freezes that bus at its reported position — never projects on
 *  guessed data). */
export type FixResolver = (id: string) => VehicleFix | null;

/**
 * Resolve a vehicle's route SHAPE (an ordered lon/lat polyline) so the projection
 * can advance ALONG the street it is on. Returns null when no shape is loaded for
 * that vehicle's route — the bus then FREEZES at its fix (we never dead-reckon on
 * the raw GTFS-RT bearing, which is not guaranteed route-aligned). Keyed by the
 * VehicleFeature (it carries `route` + `id`). Read EACH FRAME (cheap: a cache
 * lookup) so a route shape that resolves mid-flight upgrades the bus to projection
 * without a re-feed.
 */
export type ShapeResolver = (feature: VehicleFeature) => readonly Coord[] | null;

export interface VehicleMotionOptions {
	tickKey?: string | null;
	/** Global stale gate: snap + do not animate (whole feed behind). */
	stale?: boolean;
	animate?: boolean;
	/** Per-vehicle projection inputs (speed + fix times) keyed by vehicle id. */
	fixFor?: FixResolver;
	/** Per-vehicle route-shape supplier for forward path projection. */
	shapeFor?: ShapeResolver;
	/**
	 * Live skew-free clock supplier (`() => sharedClock.serverNow`, epoch ms). Read
	 * EACH FRAME so the displayed position is each bus projected from its own latest
	 * fix to estimated-NOW — clock-driven, not interpolated toward an old target.
	 * Falls back to `Date.now` when omitted (still functional, just client-clocked).
	 */
	serverNowFn?: () => number;
}

export interface VehicleMotionController {
	set(features: VehicleFC, options?: VehicleMotionOptions): void;
	destroy(): void;
}

/**
 * Ease-correct window (ms): when a bus gets a NEW fix, its displayed dot blends
 * from where it currently sits to the fresh projection over this window (rather
 * than snapping), so a corrected position glides in — no rubber-band. Short enough
 * that the correction reads as "settling", long enough to hide the snap.
 */
const BLEND_MS = 900;

/**
 * Minimum gap between source.setData calls (~30fps). The per-frame projection
 * rebuilds the whole vehicle FeatureCollection and calls setData; at hundreds of
 * buses 60fps is wasteful, so intermediate frames coalesce to ~30fps. A re-feed
 * (`set`) renders unthrottled so a new fix lands immediately.
 */
const MIN_RENDER_INTERVAL_MS = 1000 / 30;

function roundCoordinate(value: number): number {
	return Number(value.toFixed(6));
}

function normalizeBearing(value: number): number {
	return ((value % 360) + 360) % 360;
}

/** Shortest-arc bearing blend (degrees), matching the old slerp. */
function blendBearing(from: number, to: number, t: number): number {
	const delta = ((to - from + 540) % 360) - 180;
	return Math.round(normalizeBearing(from + delta * t));
}

/**
 * gsap's `power1.out` easing curve, as pure math so the per-frame blend is
 * deterministic (no tween scheduler): `out` quad = `1 − (1−t)²`. Same shape the
 * backward tween used to settle a bus onto its fix; reused here so the ease-correct
 * decelerates into the corrected position. `t` is clamped to [0,1].
 */
export function power1Out(t: number): number {
	const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
	return 1 - (1 - u) * (1 - u);
}

/**
 * Per-vehicle ease-correct state captured when a fresh fix arrives: the displayed
 * position/heading at that instant (the blend ORIGIN) + the wall-clock start. The
 * blend runs from this origin to the live projection over BLEND_MS.
 */
interface BlendState {
	fromCoord: Coord;
	fromBearing: number;
	startMs: number;
}

/**
 * A latest fix for one vehicle: the painted feature (display props + last reported
 * coord/bearing) plus the projection inputs. The feature's geometry is the bus's
 * REPORTED position; the displayed position is computed each frame by projecting
 * forward from it.
 */
interface VehicleEntry {
	feature: VehicleFeature;
	fix: VehicleFix | null;
}

/**
 * Project ONE vehicle to its displayed position+heading at `serverNow`, blended
 * from its ease-correct origin if a correction is in flight. Pure given its inputs.
 *
 * The projection is FORWARD dead-reckoning (vehicleProjection.projectVehicle): from
 * the bus's reported coord, advance along the route shape by the decaying-speed
 * distance for its fix age. Frozen (stale / no shape / no speed) → the reported
 * coord + reported bearing. The blend (`e = power1Out(elapsed/BLEND_MS)`) lerps the
 * displayed dot from where it was when the fix landed to this projection, so a
 * corrected position eases in rather than snapping.
 */
export function projectEntry(
	entry: VehicleEntry,
	serverNow: number,
	nowMs: number,
	shapeFor: ShapeResolver | undefined,
	blend: BlendState | undefined,
): { feature: VehicleFeature; result: ProjectVehicleResult } {
	const { feature, fix } = entry;
	const coord = feature.geometry.coordinates as Coord;
	const shape = shapeFor?.(feature) ?? null;
	const ageS = fix ? fixAgeS(fix.reportedUtc, fix.updatedUtc, serverNow) : Infinity;

	const result = projectVehicle({
		coord,
		shape,
		speedMps: fix?.speedMps ?? null,
		ageS,
		bearing: feature.properties.bearing,
	});

	let lon = result.coord[0];
	let lat = result.coord[1];
	let bearing = Math.round(normalizeBearing(result.bearing));

	if (blend) {
		const e = power1Out((nowMs - blend.startMs) / BLEND_MS);
		lon = blend.fromCoord[0] + (lon - blend.fromCoord[0]) * e;
		lat = blend.fromCoord[1] + (lat - blend.fromCoord[1]) * e;
		bearing = blendBearing(blend.fromBearing, bearing, e);
	}

	return {
		feature: {
			...feature,
			geometry: { type: 'Point', coordinates: [roundCoordinate(lon), roundCoordinate(lat)] },
			// Re-stamp the per-bus stale flag from the LIVE projection so a bus that
			// crosses the cutoff between polls gets its "!" the moment it goes stale —
			// the controller owns the freeze flag off the live clock, no re-feed needed.
			properties: { ...feature.properties, bearing, stale: result.stale ? 1 : 0 },
		},
		result,
	};
}

function setVehicleSourceData(map: MapLibreMap, features: VehicleFC): void {
	const source = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	source?.setData(features as unknown as Parameters<GeoJSONSource['setData']>[0]);
}

/**
 * Allow injecting the frame scheduler (deterministic tests drive frames by hand).
 * Defaults to requestAnimationFrame in the browser, a no-op server-side.
 */
export interface MotionRuntime {
	requestFrame?: (cb: () => void) => number;
	cancelFrame?: (handle: number) => void;
	now?: () => number;
}

export function createVehicleMotionController(
	map: MapLibreMap,
	runtime: MotionRuntime = {},
): VehicleMotionController {
	const requestFrame =
		runtime.requestFrame ??
		(typeof requestAnimationFrame === 'function'
			? (cb: () => void) => requestAnimationFrame(cb)
			: () => 0);
	const cancelFrame =
		runtime.cancelFrame ??
		(typeof cancelAnimationFrame === 'function'
			? (h: number) => cancelAnimationFrame(h)
			: () => {});
	const now =
		runtime.now ??
		(typeof performance !== 'undefined' && typeof performance.now === 'function'
			? () => performance.now()
			: () => Date.now());

	// Latest fix per vehicle, in feed order so output is stable. Rebuilt on each
	// `set`; read every frame for projection.
	let entries: VehicleEntry[] = [];
	let tickKey: string | null = null;
	let shapeFor: ShapeResolver | undefined;
	let serverNowFn: () => number = () => Date.now();
	let animating = false;
	let frameHandle: number | null = null;
	// Per-vehicle ease-correct blends (keyed by id), seeded on a new fix.
	const blends = new Map<string, BlendState>();
	// Blend ORIGINS captured at `set` time for a NEW tick, awaiting the render that
	// actually paints them. We seed the blend `startMs` from THAT render's `nowMs`
	// (not `set`'s clock) so the blend's elapsed-time is measured from when
	// rendering begins — the unthrottled `render(false)` runs on the same turn as
	// `set`, but in production its `now()` has advanced, so capturing startMs in
	// `set` would mistime the blend window. null when no new-tick seed is pending.
	let pendingBlendOrigins: Map<string, { coord: Coord; bearing: number }> | null = null;
	// Last displayed coord/bearing per vehicle (the blend origin when the next fix
	// arrives) so a correction starts from exactly where the dot sits, never snaps.
	const displayed = new Map<string, { coord: Coord; bearing: number }>();
	// Monotonic timestamp of the last setData, to coalesce frames to ~30fps.
	let lastSetDataMs = Number.NEGATIVE_INFINITY;

	function stopLoop(): void {
		if (frameHandle != null) cancelFrame(frameHandle);
		frameHandle = null;
		animating = false;
	}

	function scheduleFrame(): void {
		if (!animating || frameHandle != null) return;
		frameHandle = requestFrame(() => {
			frameHandle = null;
			render(true);
			if (animating) scheduleFrame();
		});
	}

	/**
	 * Rebuild the projected FeatureCollection off the LIVE clock and push it to the
	 * source. Throttled frames (the rAF loop) coalesce to ~30fps; a re-feed renders
	 * unthrottled so a fresh fix lands at once. Records each bus's displayed
	 * coord/bearing so the next fix's ease-correct can originate from it.
	 */
	function render(throttled: boolean): void {
		if (entries.length === 0) {
			if (!throttled) setVehicleSourceData(map, { type: 'FeatureCollection', features: [] });
			return;
		}
		if (throttled && now() - lastSetDataMs < MIN_RENDER_INTERVAL_MS) return;
		const serverNow = serverNowFn();
		const nowMs = now();
		// Seed any new-tick ease-correct blends NOW, off THIS render's clock, so the
		// blend's elapsed-time (`nowMs - startMs` in projectEntry) starts at zero on
		// the frame that first paints the new fix — never pre-aged by the gap between
		// `set` and this render. The origin is each bus's CURRENT displayed position
		// (captured at `set`); a bus with no prior display gets no blend (it appears
		// at its projection directly).
		if (pendingBlendOrigins) {
			for (const [id, origin] of pendingBlendOrigins) {
				blends.set(id, { fromCoord: origin.coord, fromBearing: origin.bearing, startMs: nowMs });
			}
			pendingBlendOrigins = null;
		}
		const features = entries.map((entry) => {
			const id = entry.feature.properties.id;
			const blend = blends.get(id);
			const { feature } = projectEntry(entry, serverNow, nowMs, shapeFor, blend);
			const coord = feature.geometry.coordinates as Coord;
			displayed.set(id, { coord, bearing: feature.properties.bearing });
			// A finished blend is dropped so steady-state frames skip the lerp.
			if (blend && nowMs - blend.startMs >= BLEND_MS) blends.delete(id);
			return feature;
		});
		lastSetDataMs = now();
		setVehicleSourceData(map, { type: 'FeatureCollection', features });
	}

	/** Push the reported positions verbatim (no projection) — the reduced-motion /
	 *  global-stale path. Stops the loop and clears in-flight blends. */
	function snap(features: VehicleFC): void {
		stopLoop();
		blends.clear();
		pendingBlendOrigins = null;
		displayed.clear();
		for (const f of features.features) {
			const coord = f.geometry.coordinates as Coord;
			displayed.set(f.properties.id, { coord, bearing: f.properties.bearing });
		}
		lastSetDataMs = now();
		setVehicleSourceData(map, features);
	}

	function adoptEntries(features: VehicleFC, fixFor: FixResolver | undefined): void {
		entries = features.features.map((feature) => ({
			feature,
			fix: fixFor?.(feature.properties.id) ?? null,
		}));
	}

	return {
		set(next: VehicleFC, options: VehicleMotionOptions = {}) {
			const nextTickKey = options.tickKey ?? null;
			const animate = options.animate ?? shouldAnimate('motion-gated');
			shapeFor = options.shapeFor;
			if (options.serverNowFn) serverNowFn = options.serverNowFn;

			// Global stale or reduced-motion: show the reported positions, no
			// projection, no animation loop. (Per-BUS staleness still freezes inside
			// projectVehicle on the animated path; this is the WHOLE-feed gate.)
			if (options.stale || !animate) {
				tickKey = nextTickKey;
				adoptEntries(next, options.fixFor);
				snap(next);
				return;
			}

			const sameTick = nextTickKey === tickKey && tickKey !== null;
			adoptEntries(next, options.fixFor);
			tickKey = nextTickKey;

			if (!sameTick) {
				// A genuinely NEW file (new fix for every bus): record an ease-correct
				// blend ORIGIN from each bus's CURRENT displayed position so the
				// correction glides in instead of snapping. The blend `startMs` is set
				// when the render that paints this fix runs (see `render`), NOT here, so
				// the blend window is timed from when rendering actually begins. A bus we
				// have never displayed (first frame ever, or a brand-new vehicle) has no
				// origin → no blend (it appears at its projection directly).
				const origins = new Map<string, { coord: Coord; bearing: number }>();
				for (const entry of entries) {
					const id = entry.feature.properties.id;
					const prior = displayed.get(id);
					if (prior) origins.set(id, { coord: prior.coord, bearing: prior.bearing });
					else blends.delete(id);
				}
				pendingBlendOrigins = origins;
			}
			// Same tick (filter/hover re-feed): keep any in-flight blends untouched so
			// the correction continues without restart.

			animating = true;
			// Render immediately (unthrottled) so the new fix lands this frame, then the
			// rAF loop keeps projecting forward off the live clock.
			render(false);
			scheduleFrame();
		},
		destroy() {
			stopLoop();
		},
	};
}
