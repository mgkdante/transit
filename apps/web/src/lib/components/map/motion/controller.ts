import type { VehicleFC } from '../vehicleLayer';
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

type RevisionedShapeResolver = ShapeResolver & { revision?: () => number };

export interface VehicleMotionOptions {
	tickKey?: string | null;
	stale?: boolean;
	animate?: boolean;
	fixFor?: FixResolver;
	shapeFor?: ShapeResolver;
	serverNowFn?: () => number;
	subscribeShapes?: (listener: () => void) => () => void;
}

export interface VehicleMotionController {
	set(features: VehicleFC, options?: VehicleMotionOptions): void;
	destroy(): void;
}

export function createVehicleMotionController(
	runtime: MotionRuntime = {},
	publishFrame: (features: VehicleFC) => void,
): VehicleMotionController {
	const { requestFrame, cancelFrame, now } = resolveMotionRuntime(runtime);
	const setTimer =
		runtime.setTimer ??
		((cb: () => void, ms: number) => globalThis.setTimeout(cb, ms) as unknown as number);
	const clearTimer = runtime.clearTimer ?? ((handle: number) => globalThis.clearTimeout(handle));

	let entries: VehicleEntry[] = [];
	let tickKey: string | null = null;
	let shapeFor: RevisionedShapeResolver | undefined;
	let serverNowFn: () => number = () => Date.now();
	let animating = false;
	let enabled = false;
	let unsubscribeShapes: (() => void) | undefined;
	let wake: number | undefined;
	const drawnShapes = new Map<string, readonly Coord[]>();
	const heldFeatures = new WeakMap<
		VehicleEntry,
		{ feature: VehicleEntry['feature']; invariants: ProjectionInvariants | null; expires: number }
	>();
	let activating = false;
	let frameHandle: number | null = null;
	const blends = new Map<string, BlendState>();
	let pendingBlendOrigins: Map<string, { coord: Coord; bearing: number }> | null = null;
	const displayed = new Map<string, { coord: Coord; bearing: number; stale: number }>();
	let lastRenderMs = Number.NEGATIVE_INFINITY;
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
			stopS: entry.fix.nextStop
				? projectToPolyline(shape, entry.fix.nextStop, lengths)?.s
				: undefined,
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
			if (!currentIds.has(id)) {
				displayed.delete(id);
				drawnShapes.delete(id);
			}
		}
		invariantCache.clear();
		invariantMissCache.clear();
	}

	function stopLoop(): void {
		if (wake != null) clearTimer(wake);
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

	function render(throttled: boolean): void {
		if (entries.length === 0) {
			animating = false;
			if (!throttled) publishFrame({ type: 'FeatureCollection', features: [] });
			return;
		}
		if (throttled && now() - lastRenderMs < MIN_RENDER_INTERVAL_MS) return;
		const serverNow = serverNowFn();
		const nowMs = now();
		if (pendingBlendOrigins) {
			for (const [id, origin] of pendingBlendOrigins) {
				blends.set(id, {
					fromCoord: origin.coord,
					fromBearing: origin.bearing,
					startMs: nowMs,
					activation: activating,
				});
			}
			pendingBlendOrigins = null;
		}
		let dirty = false;
		let moving = false;
		let wakeIn = Infinity;
		const features = entries.map((entry) => {
			const id = entry.feature.properties.id;
			const invariants = resolveInvariants(entry);
			const prior = displayed.get(id);
			if (invariants && drawnShapes.get(id) !== invariants.shape) {
				entry.drawnS = undefined;
				const previousShape = drawnShapes.get(id);
				drawnShapes.set(id, invariants.shape);
				if (prior && !previousShape)
					blends.set(id, {
						fromCoord: prior.coord,
						fromBearing: prior.bearing,
						startMs: nowMs,
						activation: true,
					});
				else if (previousShape) blends.delete(id);
			}
			let blend = blends.get(id);
			if (!invariants) {
				blends.delete(id);
				blend = undefined;
			}
			const held = heldFeatures.get(entry);
			if (throttled && !blend && held?.invariants === invariants && serverNow < held.expires) {
				wakeIn = Math.min(wakeIn, held.expires - serverNow);
				return held.feature;
			}
			if (blend && invariants && blend.fromS == null) {
				const origin = projectToPolyline(invariants.shape, blend.fromCoord, invariants.lengths);
				const target = projectEntry(
					entry,
					serverNow,
					nowMs,
					undefined,
					undefined,
					invariants,
				).feature;
				entry.drawnS = undefined;
				const destination = projectToPolyline(
					invariants.shape,
					target.geometry.coordinates as Coord,
					invariants.lengths,
				);
				if (
					!origin ||
					!destination ||
					origin.distance > 60 ||
					(!blend.activation && Math.abs(destination.s - origin.s) > 300)
				) {
					blends.delete(id);
					blend = undefined;
				} else {
					blend.fromS = origin.s;
					entry.drawnS = origin.s;
				}
			}
			const { feature, result } = projectEntry(
				entry,
				serverNow,
				nowMs,
				undefined,
				blend,
				invariants ?? undefined,
			);
			if (result.stale && prior && drawnShapes.has(id)) {
				feature.geometry.coordinates = [...prior.coord];
				feature.properties.bearing = prior.bearing;
			}
			const coord = feature.geometry.coordinates as Coord;
			const bearing = feature.properties.bearing;
			const stale = feature.properties.stale;
			if (result.frozen && !blend)
				heldFeatures.set(entry, {
					feature,
					invariants,
					expires: result.stale
						? Infinity
						: (invariants?.fixEpochMs ??
								Date.parse(entry.fix?.reportedUtc ?? entry.fix?.updatedUtc ?? '')) + 150000,
				});
			moving ||= !result.frozen || (!!blend && nowMs - blend.startMs < BLEND_MS);
			if (entry.fix && !result.stale)
				wakeIn = Math.min(
					wakeIn,
					(invariants?.fixEpochMs ?? Date.parse(entry.fix.reportedUtc ?? entry.fix.updatedUtc)) +
						150000 -
						serverNow,
				);
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
			if (blend && nowMs - blend.startMs >= BLEND_MS) blends.delete(id);
			return feature;
		});
		animating = moving;
		if (wake != null) clearTimer(wake);
		if (!moving && Number.isFinite(wakeIn) && wakeIn > 0)
			wake = setTimer(() => {
				if (enabled) render(false);
			}, wakeIn);
		lastRenderMs = now();
		if (throttled && !dirty) return;
		publishFrame({ type: 'FeatureCollection', features });
	}

	function snap(features: VehicleFC): void {
		stopLoop();
		blends.clear();
		invariantCache.clear();
		invariantMissCache.clear();
		pendingBlendOrigins = null;
		displayed.clear();
		drawnShapes.clear();
		for (const f of features.features) {
			const coord = f.geometry.coordinates as Coord;
			displayed.set(f.properties.id, {
				coord,
				bearing: f.properties.bearing,
				stale: f.properties.stale,
			});
		}
		lastRenderMs = now();
		publishFrame(features);
	}

	function adoptEntries(features: VehicleFC, fixFor: FixResolver | undefined): void {
		const previous = new Map(entries.map((entry) => [entry.feature.properties.id, entry]));
		entries = features.features.map((feature) => {
			const id = feature.properties.id;
			const prior = displayed.get(id);
			const shape = drawnShapes.get(id);
			return {
				feature,
				fix: fixFor?.(id) ?? null,
				drawnS:
					previous.get(id)?.drawnS ??
					(prior && shape ? projectToPolyline(shape, prior.coord)?.s : undefined),
			};
		});
	}

	return {
		set(next: VehicleFC, options: VehicleMotionOptions = {}) {
			const wasEnabled = enabled;
			enabled = !!options.animate && !options.stale;
			unsubscribeShapes?.();
			unsubscribeShapes = options.subscribeShapes?.(() => {
				if (!enabled) return;
				invariantCache.clear();
				invariantMissCache.clear();
				animating = true;
				render(false);
				scheduleFrame();
			});
			const nextTickKey = options.tickKey ?? null;
			const animate = options.animate ?? false;
			const nextShapeFor = options.shapeFor;
			if (nextShapeFor !== shapeFor) {
				invariantCache.clear();
				invariantMissCache.clear();
			}
			shapeFor = nextShapeFor;
			if (options.serverNowFn) serverNowFn = options.serverNowFn;

			if (options.stale || !animate) {
				tickKey = nextTickKey;
				adoptEntries(next, options.fixFor);
				snap(next);
				return;
			}

			const sameTick = nextTickKey === tickKey && tickKey !== null;
			activating = !wasEnabled;
			adoptEntries(next, options.fixFor);
			tickKey = nextTickKey;

			if (!sameTick || !wasEnabled) {
				for (const entry of entries) entry.drawnS = undefined;
				pruneForNewTick();
				const origins = new Map<string, { coord: Coord; bearing: number }>();
				for (const entry of entries) {
					const id = entry.feature.properties.id;
					const prior = displayed.get(id);
					if (prior) origins.set(id, { coord: prior.coord, bearing: prior.bearing });
					else blends.delete(id);
				}
				pendingBlendOrigins = origins;
			}

			animating = true;
			render(false);
			scheduleFrame();
		},
		destroy() {
			enabled = false;
			unsubscribeShapes?.();
			stopLoop();
		},
	};
}
