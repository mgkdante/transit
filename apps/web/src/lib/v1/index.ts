// $lib/v1 — the ONLY import surface the surface slices (9.3–9.7) use.
//
// Everything the UI needs to read the snapshot contract is re-exported here:
//   - repositories  : per-family async data ports (manifest/labels/live/static/
//                     historic/provenance) + their flat function aliases.
//   - boot          : bootV1() + V1Context + getV1Context/setV1Context +
//                     resolveLabel(code, labels).
//   - freshness     : tierFreshness() + the Freshness verdict types.
//   - live          : the runes live store (createLiveStore), the O(1) index
//                     builder, and the facet aggregator.
//   - config        : v1BaseUrl()/v1Provider()/resolveUrl()/entityUrl() URL helpers.
//   - schemas       : the closed enums + inferred contract types (StatusCode,
//                     OccupancyCode, SeverityCode, Grain, Manifest, *File, …).
//
// Import from `$lib/v1` and nothing deeper — the sub-paths are implementation
// detail that may move.

// --- repositories (per-family ports + flat aliases) --------------------------
export {
	repositories,
	getManifest,
	getLabels,
	getVehicles,
	getTrips,
	getStopDepartures,
	getAlerts,
	getNetwork,
	getRoutesIndex,
	getRoute,
	getStopsIndex,
	getStop,
	getNetworkTrend,
	getHotspots,
	getRepeatOffenders,
	getAlertHistory,
	getReceiptsIndex,
	getReceipt,
	getRouteReliability,
	getStopReliability,
	getProvenance,
	getBasemap,
} from './repositories';

// --- boot + label resolution + context ---------------------------------------
export { bootV1, loadManifest, resolveLabel, getV1Context, setV1Context } from './boot';
export type { V1Context } from './boot';

// --- freshness ---------------------------------------------------------------
export { tierFreshness } from './freshness';
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

// --- config (snapshot URL resolution) ----------------------------------------
export { v1BaseUrl, v1Provider, resolveUrl, entityUrl } from './config';

// --- schemas (enums + contract types) — re-export the typed contract surface --
export * from './schemas';
