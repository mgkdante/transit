// $lib/v1 is the stable contract and shared-kernel facade. Runtime data callers
// import the repository leaf that owns their tier; the facade keeps cross-domain
// types and shared computation available without hiding fetch or split points.

export type { SlimStopEntry, SlimStopsIndex } from './repositories/stopsSlim';

// --- retained-history selection, partition loading, and typed failures -------
export * from './history';

// --- boot + label resolution + context ---------------------------------------
export { bootV1, loadManifest, resolveLabel, getV1Context, setV1Context } from './boot';
export type { V1Context } from './boot';

// --- freshness ---------------------------------------------------------------
export { tierFreshness, freshnessAgeSeconds, freshnessRelative } from './freshness';
export type {
	Freshness,
	FreshnessTier,
	PublishedFreshness,
	UnpublishedFreshness,
} from './freshness';

// --- live (store + index + aggregate) ----------------------------------------
export { createLiveStore } from './live/store.svelte';
export type { LiveStore } from './live/store.svelte';
export { buildLiveIndex, emptyLiveIndex } from './live/index';
export type { LiveIndex, LiveSnapshot } from './live/index';
export { aggregateLive } from './live/aggregate';
export type {
	LiveAggregate,
	OccupancyMix as LiveOccupancyMix,
	StatusDist as LiveStatusDist,
} from './live/aggregate';
export { deriveRouteStopPredictions } from './live/routeStopPredictions';
export type { StopPrediction } from './live/routeStopPredictions';

// --- config (snapshot URL resolution) ----------------------------------------
export { v1BaseUrl, v1Provider, resolveUrl, entityUrl } from './config';

// --- affected-alerts selectors (narrow live alerts to one stop / route) -------
export { alertsForRoute, alertsForStop } from './affectedAlerts';

// --- reliability snapshot (shared lazy list-row loader + verdict) -------------
export { createReliabilityLoader } from './reliabilitySnapshot.svelte';
export type {
	ReliabilityLoader,
	ReliabilityKind,
	ReliabilityPhase,
	ReliabilitySnapshot,
} from './reliabilitySnapshot.svelte';
export {
	otpVerdict,
	isProblemVerdict,
	PROBLEM_VERDICTS,
	OTP_ON_TIME_FLOOR,
	OTP_LATE_FLOOR,
} from './reliabilityVerdict';

// The plain-language reliability verdict engine (the §0 sentence + Wilson-hedged BAN),
// hoisted from lines/reliability so every OTP-headline surface reuses the ONE engine +
// the ONE VerdictBanner presenter without a cross-feature import.
export {
	selectVerdict,
	wilsonInterval,
	VERDICT_MIN_N,
	VERDICT_RELIABLE_FLOOR,
	VERDICT_PATCHY_FLOOR,
} from './verdict';
export type {
	VerdictResult,
	VerdictStatus,
	VerdictHeadline,
	VerdictCopy,
	VerdictSentenceArgs,
} from './verdict';
export { wilsonBounds } from './stats';

// --- schemas (enums + contract types) — re-export the typed contract surface --
export * from './schemas';

// --- enum display vocabulary — the one bilingual rendering of the closed enums ---
export * from './enumLabels';
