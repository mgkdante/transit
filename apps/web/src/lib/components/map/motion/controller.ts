import type { GeoJSONFeatureDiff, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
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

type RevisionedShapeResolver = ShapeResolver & { revision?: () => number };

export interface VehicleMotionOptions {
	tickKey?: string | null;
	stale?: boolean;
	animate?: boolean;
	fixFor?: FixResolver;
	shapeFor?: ShapeResolver;
	serverNowFn?: () => number;
}

export interface VehicleMotionController {
	set(features: VehicleFC, options?: VehicleMotionOptions): void;
	destroy(): void;
}

interface VehicleWrite {
	source: GeoJSONSource;
	previous: VehicleFC | null;
	pending: VehicleFC | null;
	full: boolean;
	writing: boolean;
	cleanup?: () => void;
}

export function createVehicleMotionController(
	map: MapLibreMap,
	runtime: MotionRuntime = {},
	publishFrame?: (features: VehicleFC) => void,
): VehicleMotionController {
	const { requestFrame, cancelFrame, now } = resolveMotionRuntime(runtime);

	let entries: VehicleEntry[] = [];
	let tickKey: string | null = null;
	let shapeFor: RevisionedShapeResolver | undefined;
	let serverNowFn: () => number = () => Date.now();
	let animating = false;
	let frameHandle: number | null = null;
	let uniqueIds = true;
	let sourceWrite: VehicleWrite | null = null;
	const blends = new Map<string, BlendState>();
	let pendingBlendOrigins: Map<string, { coord: Coord; bearing: number }> | null = null;
	const displayed = new Map<string, { coord: Coord; bearing: number; stale: number }>();
	let lastRenderMs = Number.NEGATIVE_INFINITY;
	const invariantCache = new Map<string, { tickKey: string; invariants: ProjectionInvariants }>();
	const invariantMissCache = new Map<string, { tickKey: string; missRevision: number }>();

	function clearSourceWrite(): void {
		sourceWrite?.cleanup?.();
		sourceWrite = null;
	}

	function flushSource(state: VehicleWrite): void {
		if (
			state !== sourceWrite ||
			state.writing ||
			!state.pending ||
			map.getSource(VEHICLE_SOURCE) !== state.source
		)
			return;
		const features = state.pending;
		const previous = state.previous;
		let full = state.full || !previous;
		const update: GeoJSONFeatureDiff[] = [];
		if (!full && previous) {
			full = previous.features.length !== features.features.length;
			for (let i = 0; !full && i < features.features.length; i++) {
				const next = features.features[i];
				const prior = previous.features[i];
				if (prior.properties.id !== next.properties.id) {
					full = true;
					break;
				}
				const [lon, lat] = next.geometry.coordinates;
				const geometryChanged =
					prior.geometry.coordinates[0] !== lon || prior.geometry.coordinates[1] !== lat;
				const bearingChanged = prior.properties.bearing !== next.properties.bearing;
				const staleChanged = prior.properties.stale !== next.properties.stale;
				if (!geometryChanged && !bearingChanged && !staleChanged) continue;
				const diff: GeoJSONFeatureDiff = { id: next.properties.id };
				if (geometryChanged) diff.newGeometry = { type: 'Point', coordinates: [lon, lat] };
				if (bearingChanged)
					diff.addOrUpdateProperties = [{ key: 'bearing', value: next.properties.bearing }];
				if (staleChanged)
					(diff.addOrUpdateProperties ??= []).push({ key: 'stale', value: next.properties.stale });
				update.push(diff);
			}
		}
		state.pending = null;
		state.full = false;
		state.writing = true;
		let sourceErrored = false;
		const subscription = state.source.on('error', () => {
			sourceErrored = true;
		});
		state.cleanup = () => subscription.unsubscribe();
		const finish = (accepted: boolean, error?: unknown) => {
			state.cleanup?.();
			state.cleanup = undefined;
			if (state !== sourceWrite || map.getSource(VEHICLE_SOURCE) !== state.source) return;
			state.writing = false;
			state.previous = accepted && !sourceErrored ? features : null;
			if (!accepted && !sourceErrored)
				map.fire('error', { error: error instanceof Error ? error : new Error(String(error)) });
			flushSource(state);
		};
		try {
			const result = full
				? state.source.setData(features as unknown as Parameters<GeoJSONSource['setData']>[0])
				: update.length
					? state.source.updateData({ update })
					: undefined;
			void Promise.resolve(result).then(
				() => finish(true),
				(error) => finish(false, error),
			);
		} catch (error) {
			finish(false, error);
		}
	}

	function publish(features: VehicleFC, full: boolean): void {
		if (publishFrame) {
			publishFrame(features);
			return;
		}
		const source = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
		if (!source) {
			clearSourceWrite();
			return;
		}
		if (typeof source.updateData !== 'function') {
			clearSourceWrite();
			source.setData(features as unknown as Parameters<GeoJSONSource['setData']>[0]);
			return;
		}
		if (sourceWrite?.source !== source) {
			clearSourceWrite();
			sourceWrite = { source, previous: null, pending: null, full: true, writing: false };
		}
		sourceWrite.pending = features;
		sourceWrite.full ||= full || !uniqueIds || source.promoteId !== 'id';
		flushSource(sourceWrite);
	}

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

	function render(throttled: boolean): void {
		if (entries.length === 0) {
			if (!throttled) publish({ type: 'FeatureCollection', features: [] }, true);
			return;
		}
		if (throttled && now() - lastRenderMs < MIN_RENDER_INTERVAL_MS) return;
		const serverNow = serverNowFn();
		const nowMs = now();
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
			if (blend && nowMs - blend.startMs >= BLEND_MS) blends.delete(id);
			return feature;
		});
		lastRenderMs = now();
		if (throttled && !dirty) return;
		publish({ type: 'FeatureCollection', features }, !throttled);
	}

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
		publish(features, true);
	}

	function adoptEntries(features: VehicleFC, fixFor: FixResolver | undefined): void {
		uniqueIds =
			new Set(features.features.map((feature) => feature.properties.id)).size ===
			features.features.length;
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
			adoptEntries(next, options.fixFor);
			tickKey = nextTickKey;

			if (!sameTick) {
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
			clearSourceWrite();
			stopLoop();
		},
	};
}
