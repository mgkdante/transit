// map/motion/controller.ts — the kinetic-motion engine orchestrator.
//
// Owns the rAF projection loop: it schedules ~30fps frames, projects each bus
// forward from its own latest fix to estimated-now (projector.ts), eases a
// corrected position in on a new fix (the BLEND_MS blend), and pushes the rebuilt
// FeatureCollection to the GL source. The reduced-motion / global-stale path snaps
// to the reported positions with no loop. The only GL touch is `setData`.

import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '@yesid/motion/policy';
import { VEHICLE_SOURCE, type VehicleFC } from '../vehicleLayer';
import { cumulativeLengths, projectToPolyline, type Coord } from '../polyline';
import { BLEND_MS, MIN_RENDER_INTERVAL_MS } from './constants';
import {
	projectEntry,
	type BlendState,
	type FixResolver,
	type ProjectionInvariants,
	type ShapeResolver,
	type VehicleEntry,
} from './projector';
import { resolveMotionRuntime, type MotionRuntime } from './runtime';

// The options type keeps the plain `ShapeResolver` shape (pinned by exact equality
// in mapLayerModules.test.ts); a supplier MAY additionally carry a monotonic
// `revision(): number` accessor (mapShapeCache does). The controller feature-detects
// it to memoize per-tick resolution misses; plain resolvers retry every frame.
type RevisionedShapeResolver = ShapeResolver & { revision?: () => number };

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
	let shapeFor: RevisionedShapeResolver | undefined;
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
	// Last displayed moving fields per vehicle (the blend origin and dirty-check
	// baseline) so a correction starts from exactly where the dot sits, never snaps.
	const displayed = new Map<string, { coord: Coord; bearing: number; stale: number }>();
	// Monotonic timestamp of the last evaluated render, to coalesce work to ~30fps
	// even when the resulting upload is skipped as byte-identical.
	let lastRenderMs = Number.NEGATIVE_INFINITY;
	// A non-null tickKey identifies one immutable feature-coordinate snapshot, so
	// successful geometry is pinned by (tickKey, vehicle id). This positive lookup
	// stays ahead of revision logic: a global supply advance cannot invalidate a
	// same-tick success. Revision-aware deterministic misses are also tick-scoped;
	// plain resolvers retain the legacy per-frame retry path.
	const invariantCache = new Map<string, { tickKey: string; invariants: ProjectionInvariants }>();
	const invariantMissCache = new Map<string, { tickKey: string; missRevision: number }>();

	function memoizeInvariantMiss(id: string, missRevision: number | undefined): null {
		if (tickKey !== null && missRevision !== undefined) {
			invariantMissCache.set(id, { tickKey, missRevision });
		}
		return null;
	}

	function resolveInvariants(entry: VehicleEntry): ProjectionInvariants | null {
		const id = entry.feature.properties.id;
		if (tickKey !== null) {
			const cached = invariantCache.get(id);
			if (cached?.tickKey === tickKey) return cached.invariants;
		}
		if (!entry.fix) return null;
		const revision = shapeFor?.revision?.();
		if (tickKey !== null && revision !== undefined) {
			const cachedMiss = invariantMissCache.get(id);
			if (cachedMiss?.tickKey === tickKey && cachedMiss.missRevision === revision) return null;
		}
		const shape = shapeFor?.(entry.feature) ?? null;
		if (!shape || shape.length < 2) return memoizeInvariantMiss(id, revision);
		const lengths = cumulativeLengths(shape);
		if (lengths[lengths.length - 1] <= 0) return memoizeInvariantMiss(id, revision);
		const coord = entry.feature.geometry.coordinates as Coord;
		const projection = projectToPolyline(shape, coord, lengths);
		if (!projection) return memoizeInvariantMiss(id, revision);
		const rawFixUtc = entry.fix.reportedUtc ?? entry.fix.updatedUtc;
		const invariants = {
			fixEpochMs: Date.parse(rawFixUtc),
			shape,
			lengths,
			s0: projection.s,
		};
		if (tickKey !== null) {
			invariantMissCache.delete(id);
			invariantCache.set(id, { tickKey, invariants });
		}
		return invariants;
	}

	function pruneForNewTick(): void {
		const currentIds = new Set(entries.map((entry) => entry.feature.properties.id));
		for (const id of blends.keys()) {
			if (!currentIds.has(id)) blends.delete(id);
		}
		for (const id of displayed.keys()) {
			if (!currentIds.has(id)) displayed.delete(id);
		}
		// Every cached value belongs to the prior tick. Clearing releases the positive
		// shape-array pins and miss records; same-tick re-feeds never enter this helper.
		invariantCache.clear();
		invariantMissCache.clear();
	}

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
		if (throttled && now() - lastRenderMs < MIN_RENDER_INTERVAL_MS) return;
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
		let dirty = false;
		const features = entries.map((entry) => {
			const id = entry.feature.properties.id;
			const blend = blends.get(id);
			const invariants = resolveInvariants(entry);
			const { feature } = projectEntry(
				entry,
				serverNow,
				nowMs,
				undefined,
				blend,
				invariants ?? undefined,
			);
			const coord = feature.geometry.coordinates as Coord;
			const bearing = feature.properties.bearing;
			const stale = feature.properties.stale;
			const prior = displayed.get(id);
			if (
				!prior ||
				prior.coord[0] !== coord[0] ||
				prior.coord[1] !== coord[1] ||
				prior.bearing !== bearing ||
				prior.stale !== stale
			) {
				dirty = true;
			}
			displayed.set(id, { coord, bearing, stale });
			// A finished blend is dropped so steady-state frames skip the lerp.
			if (blend && nowMs - blend.startMs >= BLEND_MS) blends.delete(id);
			return feature;
		});
		lastRenderMs = now();
		if (throttled && !dirty) return;
		setVehicleSourceData(map, { type: 'FeatureCollection', features });
	}

	/** Push the reported positions verbatim (no projection) — the reduced-motion /
	 *  global-stale path. Stops the loop and clears in-flight blends. */
	function snap(features: VehicleFC): void {
		stopLoop();
		blends.clear();
		invariantCache.clear();
		invariantMissCache.clear();
		pendingBlendOrigins = null;
		displayed.clear();
		for (const f of features.features) {
			const coord = f.geometry.coordinates as Coord;
			displayed.set(f.properties.id, {
				coord,
				bearing: f.properties.bearing,
				stale: f.properties.stale,
			});
		}
		lastRenderMs = now();
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
			const nextShapeFor = options.shapeFor;
			// Only a resolver identity change invalidates same-tick geometry. MapHero's
			// stable resolver therefore preserves both caches across style re-feeds.
			if (nextShapeFor !== shapeFor) {
				invariantCache.clear();
				invariantMissCache.clear();
			}
			shapeFor = nextShapeFor;
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
				pruneForNewTick();
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
