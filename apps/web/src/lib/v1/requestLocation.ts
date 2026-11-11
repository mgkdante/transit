export interface ApproximateLocation {
	readonly lat: number;
	readonly lon: number;
}

/** Cloudflare request metadata is optional; headers and URL parameters are not authorities. */
export function readRequestLocation(request: Request): ApproximateLocation | null {
	if (!('cf' in request) || !request.cf || typeof request.cf !== 'object') return null;
	const cf = request.cf;
	if (!('latitude' in cf) || !('longitude' in cf)) return null;
	if (typeof cf.latitude !== 'string' || typeof cf.longitude !== 'string') return null;
	if (!cf.latitude.trim() || !cf.longitude.trim()) return null;
	const lat = Number(cf.latitude);
	const lon = Number(cf.longitude);
	return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
		? { lat, lon }
		: null;
}
