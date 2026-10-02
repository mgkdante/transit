export type Coord = readonly [number, number];

const M_PER_DEG_LAT = 111_320;
const REF_LAT_RAD = (45.5 * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(REF_LAT_RAD);

function toMetres(dLon: number, dLat: number): { x: number; y: number } {
	return { x: dLon * M_PER_DEG_LON, y: dLat * M_PER_DEG_LAT };
}

function bearingFromDelta(dLon: number, dLat: number): number {
	const { x, y } = toMetres(dLon, dLat);
	if (x === 0 && y === 0) return 0;
	const deg = (Math.atan2(x, y) * 180) / Math.PI;
	return ((deg % 360) + 360) % 360;
}

const _lengthsCache = new WeakMap<readonly Coord[], number[]>();

export function cumulativeLengths(coords: readonly Coord[]): number[] {
	const cached = _lengthsCache.get(coords);
	if (cached !== undefined) return cached;
	const out: number[] = [];
	if (coords.length === 0) {
		return out;
	}
	out.push(0);
	for (let i = 1; i < coords.length; i++) {
		const [aLon, aLat] = coords[i - 1];
		const [bLon, bLat] = coords[i];
		const { x, y } = toMetres(bLon - aLon, bLat - aLat);
		out.push(out[i - 1] + Math.hypot(x, y));
	}
	_lengthsCache.set(coords, out);
	return out;
}

export interface PolylineProjection {
	s: number;
	point: Coord;
	distance: number;
}

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
	coord: Coord;
	bearing: number;
}

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

	let low = 1;
	let high = cum.length - 1;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (cum[mid] < clamped) low = mid + 1;
		else high = mid;
	}
	const i = low;
	const [aLon, aLat] = coords[i - 1];
	const [bLon, bLat] = coords[i];
	const segLen = cum[i] - cum[i - 1];
	const t = segLen > 0 ? (clamped - cum[i - 1]) / segLen : 0;
	return {
		coord: [aLon + (bLon - aLon) * t, aLat + (bLat - aLat) * t],
		bearing: bearingFromDelta(bLon - aLon, bLat - aLat),
	};
}

export type PathInterpolator = (progress: number) => PathSample;

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
	if (Math.abs(sTo - sFrom) < 1) return null;

	return (progress: number) => {
		const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
		const s = sFrom + (sTo - sFrom) * t;
		return walkAlong(coords, s, lengths) as PathSample;
	};
}

export function chordBearing(fromPoint: Coord, toPoint: Coord): number | null {
	const dLon = toPoint[0] - fromPoint[0];
	const dLat = toPoint[1] - fromPoint[1];
	const { x, y } = toMetres(dLon, dLat);
	if (x === 0 && y === 0) return null;
	return bearingFromDelta(dLon, dLat);
}
