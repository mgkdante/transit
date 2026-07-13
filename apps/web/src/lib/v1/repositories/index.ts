// v1 repository barrel.
//
// Two shapes, one source of truth:
//   1. Per-family objects (manifest/labels/live/static/historic/provenance) —
//      the `repositories` grouping the SHARED CONTRACT exposes (each method
//      async). Consumers reach a port via `repositories.live.vehicles()`.
//   2. The flat named functions (getManifest, getVehicles, …) for direct import.
//
// Every method is a thin delegator to the adapter port (which owns fetch/URL/
// parse). NO fetch or URL literals live in this layer.

import { getManifest } from './manifest';
import { getLabels } from './labels';
import { getAlerts, getNetwork, getStopDepartures, getTrips, getVehicles } from './live';
import { getRoute, getRoutesIndex, getStop, getStopsIndex, getStopsIndexSlim } from './static';
import {
	getAlertHistory,
	getAdvertisedReceipt,
	getAlertArchiveIndex,
	getAlertArchiveRange,
	getHotspots,
	getHistoricAvailability,
	getNetworkTrend,
	getReceipt,
	getReceiptsIndex,
	getRepeatOffenders,
	getRouteReliability,
	getRouteReliabilityIndex,
	getStopReliability,
} from './historic';
import { getProvenance } from './provenance';
import { getDataHealth } from './dataHealth';
import { getBasemap } from './basemap';

/** Per-family repository ports — the `repositories` grouping in $lib/v1. */
export const repositories = {
	manifest: {
		get: getManifest,
	},
	labels: {
		get: getLabels,
	},
	live: {
		vehicles: getVehicles,
		trips: getTrips,
		stopDepartures: getStopDepartures,
		alerts: getAlerts,
		network: getNetwork,
	},
	static: {
		routesIndex: getRoutesIndex,
		route: getRoute,
		stopsIndex: getStopsIndex,
		stopsIndexSlim: getStopsIndexSlim,
		stop: getStop,
	},
	historic: {
		historyIndex: getHistoricAvailability,
		alertArchiveIndex: getAlertArchiveIndex,
		alertArchiveRange: getAlertArchiveRange,
		networkTrend: getNetworkTrend,
		hotspots: getHotspots,
		repeatOffenders: getRepeatOffenders,
		alertHistory: getAlertHistory,
		receiptsIndex: getReceiptsIndex,
		receipt: getReceipt,
		advertisedReceipt: getAdvertisedReceipt,
		routeReliability: getRouteReliability,
		routeReliabilityIndex: getRouteReliabilityIndex,
		stopReliability: getStopReliability,
	},
	provenance: {
		get: getProvenance,
	},
	dataHealth: {
		get: getDataHealth,
	},
	basemap: {
		get: getBasemap,
	},
} as const;

// Flat named exports — direct-import path for callers that want one function.
export { getManifest, getManifestFresh } from './manifest';
export { getLabels } from './labels';
export { getAlerts, getNetwork, getStopDepartures, getTrips, getVehicles } from './live';
export { getRoute, getRoutesIndex, getStop, getStopsIndex, getStopsIndexSlim } from './static';
export type { SlimStopEntry, SlimStopsIndex } from './stopsSlim';
export { toSlimStop, toSlimStopsIndex } from './stopsSlim';
export {
	getAlertHistory,
	getAdvertisedReceipt,
	getAlertArchiveIndex,
	getAlertArchiveRange,
	getHotspots,
	getHistoricAvailability,
	getNetworkTrend,
	getReceipt,
	getReceiptsIndex,
	getRepeatOffenders,
	getRouteReliability,
	getRouteReliabilityIndex,
	getStopReliability,
} from './historic';
export { getProvenance } from './provenance';
export { getDataHealth } from './dataHealth';
export { getBasemap } from './basemap';
