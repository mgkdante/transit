import type { VehicleFeature } from '../vehicleLayer';
import { walkAlong, type Coord } from '../polyline';
import {
	fixAgeS,
	isVehicleStale,
	projectedDistanceM,
	projectVehicle,
	type ProjectVehicleResult,
} from '../vehicleProjection';
import { BLEND_MS } from './constants';
import { blendBearing, normalizeBearing, power1Out, roundCoordinate } from './easing';

export interface VehicleFix {
	reportedUtc: string | null | undefined;
	updatedUtc: string;
	speedMps: number | null;
}

export type FixResolver = (id: string) => VehicleFix | null;

export type ShapeResolver = (feature: VehicleFeature) => readonly Coord[] | null;

export interface BlendState {
	fromCoord: Coord;
	fromBearing: number;
	startMs: number;
}

export interface VehicleEntry {
	feature: VehicleFeature;
	fix: VehicleFix | null;
}

export interface ProjectionInvariants {
	fixEpochMs: number;
	shape: readonly Coord[];
	lengths: readonly number[];
	s0: number;
}

function projectWithInvariants(
	entry: VehicleEntry,
	serverNow: number,
	invariants: ProjectionInvariants,
): ProjectVehicleResult {
	const { feature, fix } = entry;
	const coord = feature.geometry.coordinates as Coord;
	const ageS =
		fix && !Number.isNaN(invariants.fixEpochMs)
			? Math.max(0, (serverNow - invariants.fixEpochMs) / 1000)
			: Infinity;
	const stale = isVehicleStale(ageS);
	const speedMps = fix?.speedMps ?? null;
	if (stale || speedMps == null || speedMps <= 0) {
		return { coord, bearing: feature.properties.bearing, frozen: true, stale };
	}
	const distanceM = projectedDistanceM(speedMps, ageS);
	const sample = walkAlong(invariants.shape, invariants.s0 + distanceM, invariants.lengths);
	if (!sample) return { coord, bearing: feature.properties.bearing, frozen: true, stale };
	return { coord: sample.coord, bearing: sample.bearing, frozen: false, stale: false };
}

export function projectEntry(
	entry: VehicleEntry,
	serverNow: number,
	nowMs: number,
	shapeFor: ShapeResolver | undefined,
	blend: BlendState | undefined,
	invariants?: ProjectionInvariants,
): { feature: VehicleFeature; result: ProjectVehicleResult } {
	const { feature, fix } = entry;
	const coord = feature.geometry.coordinates as Coord;
	const result = invariants
		? projectWithInvariants(entry, serverNow, invariants)
		: projectVehicle({
				coord,
				shape: shapeFor?.(feature) ?? null,
				speedMps: fix?.speedMps ?? null,
				ageS: fix ? fixAgeS(fix.reportedUtc, fix.updatedUtc, serverNow) : Infinity,
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
			properties: { ...feature.properties, bearing, stale: result.stale ? 1 : 0 },
		},
		result,
	};
}
