import { type Coord, projectToPolyline, walkAlong, cumulativeLengths } from './polyline';

export const PROJECTION_HORIZON_S = 50;

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
	return speedMps * (a - (a * a) / (2 * horizon));
}

export interface ProjectVehicleInput {
	coord: Coord;
	shape: readonly Coord[] | null;
	speedMps: number | null;
	ageS: number;
	bearing: number;
	cutoff?: number;
	horizon?: number;
}

export interface ProjectVehicleResult {
	coord: Coord;
	bearing: number;
	frozen: boolean;
	stale: boolean;
}

export function projectVehicle(input: ProjectVehicleInput): ProjectVehicleResult {
	const { coord, shape, speedMps, ageS, bearing } = input;
	const cutoff = input.cutoff ?? STALE_CUTOFF_S;
	const horizon = input.horizon ?? PROJECTION_HORIZON_S;

	const stale = isVehicleStale(ageS, cutoff);

	if (stale || !shape || shape.length < 2 || speedMps == null || speedMps <= 0) {
		return { coord, bearing, frozen: true, stale };
	}

	const lengths = cumulativeLengths(shape);
	if (lengths[lengths.length - 1] <= 0) {
		return { coord, bearing, frozen: true, stale };
	}

	const proj = projectToPolyline(shape, coord, lengths);
	if (!proj) {
		return { coord, bearing, frozen: true, stale };
	}

	const d = projectedDistanceM(speedMps, ageS, horizon);
	const sample = walkAlong(shape, proj.s + d, lengths);
	if (!sample) {
		return { coord, bearing, frozen: true, stale };
	}

	return { coord: sample.coord, bearing: sample.bearing, frozen: false, stale: false };
}
