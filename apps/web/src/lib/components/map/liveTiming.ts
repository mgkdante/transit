import { projectionHorizon, STALE_CUTOFF_S } from './vehicleProjection';

type TimingManifest = { files: { live: { ttl_s?: number; source_lag_s?: number } } };

export function liveTimingFor(manifest?: TimingManifest | null) {
	const ttlS = manifest?.files?.live?.ttl_s ?? 30;
	const sourceLagS = manifest?.files?.live?.source_lag_s ?? 0;
	return {
		ttlS,
		sourceLagS,
		staleCutoffS: STALE_CUTOFF_S + sourceLagS,
		horizonS: projectionHorizon(ttlS, sourceLagS),
	};
}
