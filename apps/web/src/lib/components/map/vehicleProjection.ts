import type { Vehicle } from '#lib/v1/schemas/index.ts';
import { type Coord, projectToPolyline, walkAlong, cumulativeLengths } from './polyline';

export function notReporting(
	vehicle: Pick<Vehicle, 'reported_utc' | 'updated_utc'>,
	serverNow: number,
): { ageS: number } | null {
	const ageS = fixAgeS(vehicle.reported_utc, vehicle.updated_utc, serverNow);
	return isVehicleStale(ageS) ? { ageS } : null;
}

export const PROJECTION_HORIZON_S = 90;

export function projectionHorizon(ttlS = 30): number {
	return Math.min(STALE_CUTOFF_S, 2 * (Number.isFinite(ttlS) && ttlS > 0 ? ttlS : 30) + 30);
}

export const STALE_CUTOFF_S = 150;

export function fixAgeS(
	reportedUtc: string | null | undefined,
	updatedUtc: string,
	serverNow: number,
): number {
	const raw = reportedUtc ?? updatedUtc;
	const ms = Date.parse(raw);
	if (Number.isNaN(ms)) return Infinity;
	const ageS = (serverNow - ms) / 1000;
	return ageS > 0 ? ageS : 0;
}

export function isVehicleStale(ageS: number, cutoff: number = STALE_CUTOFF_S): boolean {
	return ageS >= cutoff;
}

export function projectedDistanceM(
	speedMps: number,
	ageS: number,
	horizon: number = PROJECTION_HORIZON_S,
): number {
	if (speedMps <= 0) return 0;
	if (horizon <= 0) return 0;
	const a = ageS <= 0 ? 0 : ageS >= horizon ? horizon : ageS;
	return speedMps * a;
}

export interface ProjectionInvariants {
	fixEpochMs: number;
	shape: readonly Coord[];
	lengths: readonly number[];
	s0: number;
	stopS?: number;
}

export interface ProjectVehicleInput {
	invariants?: ProjectionInvariants;
	coord: Coord;
	shape: readonly Coord[] | null;
	speedMps: number | null;
	ageS: number;
	bearing: number;
	cutoff?: number;
	horizon?: number;
	nextStop?: Coord | null;
}

export interface ProjectVehicleResult {
	coord: Coord;
	bearing: number;
	frozen: boolean;
	stale: boolean;
	s?: number;
}

export function projectVehicle(input: ProjectVehicleInput): ProjectVehicleResult {
	const { coord, shape, speedMps, ageS, bearing } = input;
	const cutoff = input.cutoff ?? STALE_CUTOFF_S;
	const horizon = input.horizon ?? PROJECTION_HORIZON_S;

	const stale = isVehicleStale(ageS, cutoff);

	if (stale || !shape || shape.length < 2 || speedMps == null || speedMps <= 0) {
		return { coord, bearing, frozen: true, stale };
	}

	const lengths = input.invariants?.lengths ?? cumulativeLengths(shape);
	if (lengths[lengths.length - 1] <= 0) {
		return { coord, bearing, frozen: true, stale };
	}

	const proj = input.invariants
		? { s: input.invariants.s0 }
		: projectToPolyline(shape, coord, lengths);
	if (!proj) {
		return { coord, bearing, frozen: true, stale };
	}

	const d = projectedDistanceM(speedMps, ageS, Math.min(horizon, cutoff));
	const stopS =
		input.invariants?.stopS ??
		(input.nextStop ? projectToPolyline(shape, input.nextStop, lengths)?.s : undefined);
	const end = Math.min(
		lengths[lengths.length - 1],
		stopS == null ? Infinity : Math.max(proj.s, stopS),
	);
	const sample = walkAlong(shape, Math.min(proj.s + d, end), lengths);
	if (!sample) {
		return { coord, bearing, frozen: true, stale };
	}

	return {
		coord: sample.coord,
		bearing: sample.bearing,
		s: Math.min(proj.s + d, end),
		frozen: ageS >= horizon || proj.s + d >= end,
		stale: false,
	};
}
