export type { SlimStopEntry, SlimStopsIndex } from './repositories/stopsSlim';

export * from './history';

export { bootV1, loadManifest, resolveLabel, getV1Context, setV1Context } from './boot';
export type { V1Context } from './boot';

export { tierFreshness, freshnessAgeSeconds, freshnessRelative } from './freshness';
export type {
	Freshness,
	FreshnessTier,
	PublishedFreshness,
	UnpublishedFreshness,
} from './freshness';

export { createLiveStore } from './live/store.svelte';
export type { LiveStore } from './live/store.svelte';
export { buildLiveIndex, emptyLiveIndex } from './live/index';
export type { LiveIndex, LiveSnapshot } from './live/index';
export { deriveRouteStopPredictions } from './live/routeStopPredictions';
export type { StopPrediction } from './live/routeStopPredictions';

export { v1BaseUrl, v1Provider, resolveUrl, entityUrl } from './config';

export { alertsForRoute, alertsForStop } from './affectedAlerts';

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

export * from './schemas';

export * from './enumLabels';
