export const DEFAULT_LIVE_TTL_S = 30;

export function silenceAgeS(updatedUtc: string | null | undefined, serverNow: number): number {
	if (updatedUtc == null) return Number.POSITIVE_INFINITY;
	const reportedMs = Date.parse(updatedUtc);
	if (Number.isNaN(reportedMs)) return Number.POSITIVE_INFINITY;
	return Math.max(0, (serverNow - reportedMs) / 1000);
}

export function liveTtlS(ttlFromManifest: number | null | undefined): number {
	return Math.max(1, ttlFromManifest ?? DEFAULT_LIVE_TTL_S);
}
