// map/vehicleProjection.ts — pure FORWARD dead-reckoning for live vehicle motion.
//
// PR-A gave each vehicle its OWN fix time (`reported_utc`, the GTFS-RT timestamp;
// nullable → fall back to `updated_utc`, the uniform snapshot capture time). This
// module turns that into an HONEST estimate of where a bus is at "now":
//
//   · BACKWARD interpolation (vehicleMotion) eases a bus between two PAST fixes —
//     it always lags reality by one poll. FORWARD dead-reckoning instead projects
//     each bus FORWARD from its latest fix toward estimated-now, ALONG its route
//     shape, so the dot tracks where the bus most plausibly IS, not where it was.
//
//   · It is BOUNDED, DECAYING, and SELF-CORRECTING. Effective speed decays
//     linearly to zero over a short horizon (PROJECTION_HORIZON_S): we trust a
//     fresh fix's velocity for a few seconds, then stop inventing travel. The next
//     fix snaps the dot back to truth — projection never compounds.
//
//   · It is HONEST about staleness. Past STALE_CUTOFF_S the fix is too old to
//     project from at all: the bus FREEZES at its last position and is FLAGGED
//     (the per-bus "!" the S5 global reshape dropped — now correctly per-bus, off
//     each bus's OWN `reported_utc`, not a single global snapshot clock).
//
// We only ever dead-reckon along the route SHAPE tangent — never on the GTFS-RT
// `bearing`, which is not guaranteed to be route-aligned (it can point at a turn
// the bus already finished, or be noise). No shape, or no/zero speed → FREEZE at
// the fix. Correctness for every bus; forward motion only when it is safe.

import { type Coord, projectToPolyline, walkAlong, cumulativeLengths } from './polyline';

/**
 * Forward-projection horizon (seconds). The effective speed used to advance the
 * bus decays LINEARLY from its reported value at the fix to ZERO at this horizon,
 * so we trust a fix's velocity briefly then stop inventing travel. The advanced
 * distance therefore pins at `v·H/2` for any age ≥ H (see `projectedDistanceM`).
 * Tunable.
 */
export const PROJECTION_HORIZON_S = 50;

/**
 * Staleness cutoff (seconds). A fix older than this is too stale to project from:
 * the bus freezes at its last reported position and is flagged. Chosen well above
 * the horizon so the dot is genuinely pinned (distance already saturated) before
 * we declare it stale. Tunable.
 */
export const STALE_CUTOFF_S = 150;

/**
 * Age of a vehicle's fix in seconds on the server clock: `serverNow` minus the
 * parsed `reported_utc` (the bus's OWN GTFS-RT fix time) or, when that is absent,
 * `updated_utc` (the uniform snapshot capture time). Clamped to ≥ 0 so clock skew
 * or an out-of-order fix can never yield negative (future) age. Returns
 * `Infinity` when neither timestamp parses — an unparseable fix is treated as
 * infinitely stale (→ freeze + flag), never silently projected.
 *
 * @param reportedUtc the vehicle's own fix time (ISO 8601), or null/undefined
 * @param updatedUtc  the uniform snapshot capture time (ISO 8601) — the fallback
 * @param serverNow   estimated server-clock "now" in epoch milliseconds
 */
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

/**
 * True when a fix is too old to project from (`ageS >= cutoff`). The boundary is
 * INCLUSIVE: exactly `cutoff` seconds counts as stale. `Infinity` (unparseable
 * fix) is stale.
 */
export function isVehicleStale(ageS: number, cutoff: number = STALE_CUTOFF_S): boolean {
	return ageS >= cutoff;
}

/**
 * Distance (metres) a bus has advanced along its route since its fix, under the
 * decaying-speed model. Effective speed decays linearly from `speedMps` at the
 * fix to 0 at the horizon `H`, so the distance is the closed-form integral of
 * `v·(1 − t/H)` over `[0, a]`:
 *
 *     d(a) = v·(a − a²/(2H)),   a = clamp(ageS, 0, H)
 *
 * Because `a` is clamped to the horizon, the distance is monotonic in age and
 * SATURATES at `v·H/2` for any age ≥ H — we never invent unbounded travel from a
 * single fix. Returns 0 for a non-positive speed (a stationary bus does not move).
 *
 * @param speedMps speed in metres/second (≤ 0 → 0)
 * @param ageS     fix age in seconds (clamped into [0, horizon])
 * @param horizon  decay horizon in seconds (defaults to PROJECTION_HORIZON_S)
 */
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
	/** The bus's last reported position (lon/lat). */
	coord: Coord;
	/** The route shape (ordered lon/lat polyline) for this bus, or null. */
	shape: readonly Coord[] | null;
	/** Reported speed in metres/second (≤ 0 or null → freeze). */
	speedMps: number | null;
	/** Fix age in seconds (from `fixAgeS`). */
	ageS: number;
	/** The reported GTFS-RT bearing (kept on the frozen result; never projected on). */
	bearing: number;
	/** Staleness cutoff override (seconds). Defaults to STALE_CUTOFF_S. */
	cutoff?: number;
	/** Projection horizon override (seconds). Defaults to PROJECTION_HORIZON_S. */
	horizon?: number;
}

export interface ProjectVehicleResult {
	/** Estimated current position. The fix `coord` when frozen. */
	coord: Coord;
	/** Estimated heading: the route-shape TANGENT at the advanced point when
	 *  projected; the reported `bearing` when frozen. */
	bearing: number;
	/** True when the bus was held at its fix (stale, or no shape, or no/zero speed). */
	frozen: boolean;
	/** True when the fix is past the staleness cutoff (drives the per-bus flag). */
	stale: boolean;
}

/**
 * Project ONE vehicle forward from its last fix to estimated-now, along its route
 * shape. Pure: given the same inputs it always returns the same result.
 *
 * FREEZE (hold at the fix, keep the reported bearing) when ANY of:
 *   · the fix is stale (`ageS >= cutoff`) — too old to trust for projection;
 *   · there is no route shape to follow (we never dead-reckon on the raw bearing);
 *   · the speed is null or ≤ 0 (no travel to project).
 *
 * Otherwise advance `d = projectedDistanceM(speed, age)` metres along the shape
 * from the bus's position PROJECTED ONTO the shape, and return the sampled
 * position + the shape TANGENT there as the heading. If the position cannot be
 * projected onto the shape (degenerate shape), freeze.
 */
export function projectVehicle(input: ProjectVehicleInput): ProjectVehicleResult {
	const { coord, shape, speedMps, ageS, bearing } = input;
	const cutoff = input.cutoff ?? STALE_CUTOFF_S;
	const horizon = input.horizon ?? PROJECTION_HORIZON_S;

	const stale = isVehicleStale(ageS, cutoff);

	// Freeze conditions: stale, no usable shape, or no/zero speed. The reported
	// bearing is kept (it is the bus's last known facing — not projected on).
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
