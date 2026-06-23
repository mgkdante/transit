// map/motion/controller.ts — the kinetic-motion engine orchestrator.
//
// Owns the rAF projection loop: it schedules ~30fps frames, projects each bus
// forward from its own latest fix to estimated-now (projector.ts), eases a
// corrected position in on a new fix (the BLEND_MS blend), and pushes the rebuilt
// FeatureCollection to the GL source. The reduced-motion / global-stale path snaps
// to the reported positions with no loop. The only GL touch is `setData`.

import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '$lib/motion/policy';
import { VEHICLE_SOURCE, type VehicleFC } from '../vehicleLayer';
import type { Coord } from '../polyline';
import { BLEND_MS, MIN_RENDER_INTERVAL_MS } from './constants';
import {
	projectEntry,
	type BlendState,
	type FixResolver,
	type ShapeResolver,
	type VehicleEntry,
} from './projector';
import { resolveMotionRuntime, type MotionRuntime } from './runtime';

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

function setVehicleSourceData(map: MapLibreMap, features: VehicleFC): void {
	const source = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
	source?.setData(features as unknown as Parameters<GeoJSONSource['setData']>[0]);
}

export function createVehicleMotionController(
	map: MapLibreMap,
	runtime: MotionRuntime = {},
): VehicleMotionController {
	const { requestFrame, cancelFrame, now } = resolveMotionRuntime(runtime);

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
