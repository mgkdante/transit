import type { VehicleFeature } from '../vehicleLayer';
import { type Coord } from '../polyline';
import { fixAgeS, projectVehicle, type ProjectVehicleResult } from '../vehicleProjection';
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

export type { ProjectionInvariants } from '../vehicleProjection';
import type { ProjectionInvariants } from '../vehicleProjection';

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
	const result = projectVehicle({
		coord,
		shape: invariants?.shape ?? shapeFor?.(feature) ?? null,
		invariants,
		speedMps: fix?.speedMps ?? null,
		ageS: invariants
			? fix && !Number.isNaN(invariants.fixEpochMs)
				? Math.max(0, (serverNow - invariants.fixEpochMs) / 1000)
				: Infinity
			: fix
				? fixAgeS(fix.reportedUtc, fix.updatedUtc, serverNow)
				: Infinity,
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
