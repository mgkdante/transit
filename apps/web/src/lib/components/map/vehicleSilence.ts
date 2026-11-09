import { DEFAULT_LIVE_TTL_S } from '#lib/v1/freshness.ts';
export { DEFAULT_LIVE_TTL_S } from '#lib/v1/freshness.ts';

export function liveTtlS(ttlFromManifest: number | null | undefined): number {
	return Math.max(1, ttlFromManifest ?? DEFAULT_LIVE_TTL_S);
}
