// map/polyline.ts — pure geometry for HONEST path-following motion.
//
// The kinetic map tweens a bus BETWEEN two real reported fixes. Straight-line
// lerp cuts a diagonal CHORD across blocks; this module lets the tween instead
// walk ALONG the route's published shape, so the bus appears to follow the
// street it is actually on. This is still strictly INTERPOLATION between two
// known reports — never extrapolation:
//   · we project the two real fixes onto the polyline (arc-lengths s_from, s_to)
//   · the tween samples positions only on the arc BETWEEN those two projections
//   · the heading at any sample is the polyline TANGENT (the direction of travel)
// If the shape is missing/degenerate, or a fix sits implausibly far from the
// line (wrong-direction variant, off-route GPS), the caller falls back to the
// straight chord — correctness for every bus, fancy path only when it is safe.
//
// Distances use an equirectangular metres approximation at Montréal's latitude.
// At city scale the error vs. haversine is negligible (<0.2%) and it is far
// cheaper — and we only ever use these lengths for RATIOS along one polyline, so
// any small uniform scale factor cancels out entirely.

export type Coord = readonly [number, number];

/** Metres per degree of latitude (WGS84 mean) — constant enough at city scale. */
const M_PER_DEG_LAT = 111_320;
/**
 * Reference latitude for the lon→metres scaling (Montréal ≈ 45.5°N). The cos
 * factor only needs to be roughly right because every length on a given polyline
 * shares it, so it cancels in the arc-length RATIOS the tween consumes.
 */
const REF_LAT_RAD = (45.5 * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(REF_LAT_RAD);

/** Project a lon/lat delta to local planar metres (equirectangular). */
function toMetres(dLon: number, dLat: number): { x: number; y: number } {
	return { x: dLon * M_PER_DEG_LON, y: dLat * M_PER_DEG_LAT };
}

function bearingFromDelta(dLon: number, dLat: number): number {
	const { x, y } = toMetres(dLon, dLat);
	if (x === 0 && y === 0) return 0;
	// Compass bearing: 0 = north, 90 = east. atan2(east, north).
	const deg = (Math.atan2(x, y) * 180) / Math.PI;
	return ((deg % 360) + 360) % 360;
}

/**
 * Prefix-sum of segment lengths (metres). `lengths[i]` is the cumulative arc
 * length from coords[0] to coords[i]; `lengths[0] === 0`. The final entry is the
 * total polyline length. Returns `[0]` for a single point and `[]` for empty.
 */
export function cumulativeLengths(coords: readonly Coord[]): number[] {
	const out: number[] = [];
	if (coords.length === 0) return out;
	out.push(0);
	for (let i = 1; i < coords.length; i++) {
		const [aLon, aLat] = coords[i - 1];
		const [bLon, bLat] = coords[i];
		const { x, y } = toMetres(bLon - aLon, bLat - aLat);
		out.push(out[i - 1] + Math.hypot(x, y));
	}
	return out;
}

export interface PolylineProjection {
	/** Arc length (metres) from the polyline start to the projected point. */
	s: number;
	/** The projected point on the polyline. */
	point: Coord;
	/** Perpendicular distance (metres) from the input point to the polyline. */
	distance: number;
}

/**
 * Nearest point on the polyline to `point`, returned with its arc-length `s` and
 * the perpendicular `distance` (metres). This is the classic min-over-segments
 * point-to-segment projection. The caller uses `distance` as the honesty guard:
 * a fix far from the line means the wrong shape (or off-route GPS), so it should
 * fall back to the chord rather than snap the bus onto an unrelated street.
 *
 * Returns null when the polyline has fewer than 2 points (nothing to project
 * onto) — again a chord-fallback signal.
 */
export function projectToPolyline(
	coords: readonly Coord[],
	point: Coord,
	lengths?: readonly number[],
): PolylineProjection | null {
	if (coords.length < 2) return null;
	const cum = lengths ?? cumulativeLengths(coords);
	const [pLon, pLat] = point;
	const p = toMetres(pLon, pLat);

	let best: PolylineProjection | null = null;
	for (let i = 1; i < coords.length; i++) {
		const [aLon, aLat] = coords[i - 1];
		const [bLon, bLat] = coords[i];
		const a = toMetres(aLon, aLat);
		const b = toMetres(bLon, bLat);
		const abx = b.x - a.x;
		const aby = b.y - a.y;
		const segLenSq = abx * abx + aby * aby;
		// Parametric position of the foot of the perpendicular, clamped to [0,1]
		// so the projection never escapes the segment's endpoints.
		let t = 0;
		if (segLenSq > 0) {
			t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / segLenSq;
			t = t < 0 ? 0 : t > 1 ? 1 : t;
		}
		const footX = a.x + abx * t;
		const footY = a.y + aby * t;
		const distance = Math.hypot(p.x - footX, p.y - footY);
		if (best === null || distance < best.distance) {
			const segLen = cum[i] - cum[i - 1];
			best = {
				s: cum[i - 1] + segLen * t,
				point: [aLon + (bLon - aLon) * t, aLat + (bLat - aLat) * t],
				distance,
			};
		}
	}
	return best;
}

export interface PathSample {
	/** Interpolated lon/lat at the requested arc length. */
	coord: Coord;
	/** Tangent (direction of travel) at that point, as a compass bearing. */
	bearing: number;
}

/**
 * Position + tangent bearing at arc-length `s` along the polyline. `s` is clamped
 * to `[0, total]` so the walk can NEVER run off the end of the shape (an extra
 * structural no-extrapolation guard on top of the caller's `s_from..s_to`
 * bound). The bearing is the direction of the segment the point sits on — i.e.
 * which way the bus is travelling, not the noisy feed heading.
 */
export function walkAlong(
	coords: readonly Coord[],
	s: number,
	lengths?: readonly number[],
): PathSample | null {
	if (coords.length === 0) return null;
	if (coords.length === 1) return { coord: coords[0], bearing: 0 };
	const cum = lengths ?? cumulativeLengths(coords);
	const total = cum[cum.length - 1];
	if (total <= 0) return { coord: coords[0], bearing: 0 };
	const clamped = s <= 0 ? 0 : s >= total ? total : s;

	// Find the segment containing `clamped` (linear scan; polylines are short).
	let i = 1;
	while (i < cum.length - 1 && cum[i] < clamped) i++;
	const [aLon, aLat] = coords[i - 1];
	const [bLon, bLat] = coords[i];
	const segLen = cum[i] - cum[i - 1];
	const t = segLen > 0 ? (clamped - cum[i - 1]) / segLen : 0;
	return {
		coord: [aLon + (bLon - aLon) * t, aLat + (bLat - aLat) * t],
		bearing: bearingFromDelta(bLon - aLon, bLat - aLat),
	};
}

/**
 * A per-tween sampler: `progress` in [0,1] → the position + travel bearing along
 * the route shape, strictly between the two real fixes. Returned by
 * `buildPathBetween`; null when path-follow is not safe (caller uses the chord).
 */
export type PathInterpolator = (progress: number) => PathSample;

/**
 * Build a path-follow sampler for ONE vehicle between two real fixes, or return
 * null to signal "fall back to the straight chord".
 *
 * Honesty + safety gates (any failure → null → chord):
 *   · the shape must have >= 2 coordinates;
 *   · BOTH fixes must project onto the shape within `maxOffRouteM` (else the
 *     shape is the wrong direction-variant or the GPS is off-route — snapping to
 *     it would invent a position on a street the bus is not on);
 *   · the two projections must not be effectively coincident (no arc to walk).
 *
 * When it returns a sampler, the walk is bounded to `s_from + (s_to - s_from)·t`
 * — purely interpolation along the arc BETWEEN the two known reports. It never
 * walks past `s_to`, so a late next fix cannot make the bus glide into invented
 * territory (the tween also clamps progress, and silence-fade handles staleness).
 */
export function buildPathBetween(
	coords: readonly Coord[],
	fromPoint: Coord,
	toPoint: Coord,
	maxOffRouteM = 60,
): PathInterpolator | null {
	if (coords.length < 2) return null;
	const lengths = cumulativeLengths(coords);
	if (lengths[lengths.length - 1] <= 0) return null;

	const projFrom = projectToPolyline(coords, fromPoint, lengths);
	const projTo = projectToPolyline(coords, toPoint, lengths);
	if (!projFrom || !projTo) return null;
	if (projFrom.distance > maxOffRouteM || projTo.distance > maxOffRouteM) return null;

	const sFrom = projFrom.s;
	const sTo = projTo.s;
	// No measurable travel along the shape → nothing to path-follow; let the
	// (also ~zero) chord handle it so a stationary bus stays put + falls back to
	// the feed bearing for its chevron.
	if (Math.abs(sTo - sFrom) < 1) return null;

	return (progress: number) => {
		const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
		const s = sFrom + (sTo - sFrom) * t;
		// walkAlong cannot return null here (coords.length >= 2, total > 0).
		return walkAlong(coords, s, lengths) as PathSample;
	};
}

/** Compass bearing of the straight chord from `fromPoint` to `toPoint`, or null
 * when the two points coincide (no travel direction to report). Used for the
 * chord-tangent heading when no shape is available. */
export function chordBearing(fromPoint: Coord, toPoint: Coord): number | null {
	const dLon = toPoint[0] - fromPoint[0];
	const dLat = toPoint[1] - fromPoint[1];
	const { x, y } = toMetres(dLon, dLat);
	if (x === 0 && y === 0) return null;
	return bearingFromDelta(dLon, dLat);
}
