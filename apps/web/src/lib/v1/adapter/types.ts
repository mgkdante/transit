// ContentAdapter contract — every read the v1 client makes against the snapshot
// content layer. The R2 adapter (r2.ts) implements this via fetch + parsePort;
// the single `export const adapter` in index.ts is the swap point.
//
// Signature rules (mirrors the yesid.dev adapter contract, adapted to fetch/R2):
//   - Every method is async (`Promise<T>`).
//   - Collections / list shapes are validated whole files (RoutesIndex, etc.).
//   - Per-entity getters (route / stop / receipt / *_reliability) return
//     `T | null`: `null` == HTTP 404 == "no data for this entity" (render an
//     empty state, NOT an error). The 404-as-empty contract is in
//     snapshots/contract.py; http.ts surfaces 404 as `undefined` and the ports
//     normalize that to `null` to match the repository signatures in $lib/v1.
//   - Every method accepts an optional trailing `ctx?: AdapterCtx` carrying the
//     SSR `fetch` (event.fetch for request dedupe) plus a per-request memo.
//
// Type alignment: the leaf types are imported from the per-family schema modules
// (stable names). The repositories in $lib/v1 import the same inferred types via
// the $lib/v1/schemas barrel (RouteDetail/StopDetail are barrel aliases of
// RouteFile/StopFile) — structurally identical, so the ports satisfy them.

import type { Locale } from '$lib/i18n';
import type { FetchFn, RawJsonEntity } from '$lib/v1/http';

import type { Manifest } from '$lib/v1/schemas/manifest';
import type { VehiclesFile } from '$lib/v1/schemas/vehicles';
import type { TripsFile } from '$lib/v1/schemas/trips';
import type { StopDeparturesFile } from '$lib/v1/schemas/stop_departures';
import type { AlertsFile } from '$lib/v1/schemas/alerts';
import type { NetworkFile } from '$lib/v1/schemas/network';
import type { RoutesIndex } from '$lib/v1/schemas/routes_index';
import type { RouteFile } from '$lib/v1/schemas/route';
import type { StopsIndex } from '$lib/v1/schemas/stops_index';
import type { StopFile } from '$lib/v1/schemas/stop';
import type { NetworkTrend } from '$lib/v1/schemas/network_trend';
import type { Hotspots } from '$lib/v1/schemas/hotspots';
import type { HistoricHotspotsDay } from '$lib/v1/schemas/hotspots';
import type { HistoricRepeatOffendersDay, RepeatOffenders } from '$lib/v1/schemas/repeat_offenders';
import type { AlertHistory } from '$lib/v1/schemas/alert_history';
import type { ReceiptsIndex } from '$lib/v1/schemas/receipts_index';
import type { RouteReliabilityIndex } from '$lib/v1/schemas/route_reliability_index';
import type { Receipt } from '$lib/v1/schemas/receipts';
import type { RouteReliability } from '$lib/v1/schemas/route_reliability';
import type { StopReliability } from '$lib/v1/schemas/stop_reliability';
import type { Provenance } from '$lib/v1/schemas/provenance';
import type { DataHealth } from '$lib/v1/schemas/data_health';
import type { BasemapFile } from '$lib/v1/schemas/basemap';
import type { AlertArchiveIndex, AlertArchivePage } from '$lib/v1/schemas/alert_archive';
import type {
	HistoricAvailabilityIndex,
	HistoricCollectionIndex,
	HistoricEntityDirectoryIndex,
	LineHistoryPartition,
	NetworkHistoryPartition,
	StopHistoryPartition,
} from '$lib/v1/schemas/history';

/**
 * Adapter read context. SSR loads thread it from `event` for request dedupe;
 * browser consumers can reuse an already-loaded manifest across related reads.
 */
export interface AdapterCtx {
	/** SSR fetch (event.fetch); defaults to the global fetch when omitted. */
	fetch?: FetchFn;
	/** Authoritative manifest already loaded by the caller; avoids resolving it again. */
	manifest?: Manifest;
	/** Per-request memo (App.Locals.v1Cache) so manifest/labels fetch once per request. */
	cache?: Map<string, unknown>;
	/** Optional abort signal for the underlying requests. */
	signal?: AbortSignal;
	/** Force one immediate retained-history pointer re-read with cache busting. */
	freshHistoryParent?: boolean;
}

/** Snapshot root pointer. Read first — every other family resolves relative to it. */
export interface ManifestPort {
	get(ctx?: AdapterCtx): Promise<Manifest>;
}

/** Code -> human-text dictionary for a UI language. Missing file -> empty map (fail-soft). */
export interface LabelsPort {
	get(lang: Locale, ctx?: AdapterCtx): Promise<Record<string, string>>;
}

/** Live tier (short TTL): whole-file reads of the five realtime snapshots. */
export interface LivePort {
	vehicles(ctx?: AdapterCtx): Promise<VehiclesFile>;
	trips(ctx?: AdapterCtx): Promise<TripsFile>;
	stopDepartures(ctx?: AdapterCtx): Promise<StopDeparturesFile>;
	alerts(ctx?: AdapterCtx): Promise<AlertsFile>;
	network(ctx?: AdapterCtx): Promise<NetworkFile>;
}

/** Static tier (daily TTL): GTFS reference indexes + per-entity detail (404 -> null). */
export interface StaticPort {
	routesIndex(ctx?: AdapterCtx): Promise<RoutesIndex>;
	route(routeId: string, ctx?: AdapterCtx): Promise<RouteFile | null>;
	stopsIndex(ctx?: AdapterCtx): Promise<StopsIndex>;
	stop(stopId: string, ctx?: AdapterCtx): Promise<StopFile | null>;
}

/** Historic tier (daily TTL): rollups + per-entity detail/receipts (404 -> null). */
export interface HistoricPort {
	historyIndex(ctx?: AdapterCtx): Promise<HistoricAvailabilityIndex | null>;
	networkHistoryIndex(path: string, ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null>;
	hotspotsHistoryIndex(path: string, ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null>;
	repeatOffendersHistoryIndex(
		path: string,
		ctx?: AdapterCtx,
	): Promise<HistoricCollectionIndex | null>;
	lineHistoryDirectory(
		path: string,
		ctx?: AdapterCtx,
	): Promise<HistoricEntityDirectoryIndex | null>;
	stopHistoryDirectory(
		path: string,
		ctx?: AdapterCtx,
	): Promise<HistoricEntityDirectoryIndex | null>;
	lineHistoryIndex(
		entityId: string,
		path: string,
		ctx?: AdapterCtx,
	): Promise<HistoricCollectionIndex | null>;
	stopHistoryIndex(
		entityId: string,
		path: string,
		ctx?: AdapterCtx,
	): Promise<HistoricCollectionIndex | null>;
	networkHistoryPartition(
		path: string,
		ctx?: AdapterCtx,
	): Promise<RawJsonEntity<NetworkHistoryPartition> | null>;
	lineHistoryPartition(
		entityId: string,
		path: string,
		ctx?: AdapterCtx,
	): Promise<RawJsonEntity<LineHistoryPartition> | null>;
	stopHistoryPartition(
		entityId: string,
		path: string,
		ctx?: AdapterCtx,
	): Promise<RawJsonEntity<StopHistoryPartition> | null>;
	hotspotsHistoryDay(
		date: string,
		path: string,
		ctx?: AdapterCtx,
	): Promise<RawJsonEntity<HistoricHotspotsDay> | null>;
	repeatOffendersHistoryDay(
		date: string,
		path: string,
		ctx?: AdapterCtx,
	): Promise<RawJsonEntity<HistoricRepeatOffendersDay> | null>;
	alertArchiveIndex(ctx?: AdapterCtx): Promise<AlertArchiveIndex | null>;
	alertArchivePage(path: string, ctx?: AdapterCtx): Promise<AlertArchivePage | null>;
	networkTrend(ctx?: AdapterCtx): Promise<NetworkTrend>;
	hotspots(ctx?: AdapterCtx): Promise<Hotspots>;
	repeatOffenders(ctx?: AdapterCtx): Promise<RepeatOffenders>;
	alertHistory(ctx?: AdapterCtx): Promise<AlertHistory>;
	receiptsIndex(ctx?: AdapterCtx): Promise<ReceiptsIndex>;
	routeReliabilityIndex(ctx?: AdapterCtx): Promise<RouteReliabilityIndex | null>;
	receipt(date: string, ctx?: AdapterCtx): Promise<Receipt | null>;
	routeReliability(routeId: string, ctx?: AdapterCtx): Promise<RouteReliability | null>;
	stopReliability(stopId: string, ctx?: AdapterCtx): Promise<StopReliability | null>;
}

/** Provenance / honesty document: per-feed freshness, sources, gaps, methodology. */
export interface ProvenancePort {
	get(ctx?: AdapterCtx): Promise<Provenance>;
}

/**
 * Data-health document: per-lane publish freshness + last gate outcome, served on
 * the LIVE lane every cycle. 404 -> null so /status stands the pipeline-lanes
 * section DOWN on a legacy publish (no data_health yet) rather than erroring.
 */
export interface DataHealthPort {
	get(ctx?: AdapterCtx): Promise<DataHealth | null>;
}

/** Basemap pointer: the hosted PMTiles archive descriptor, or null when none. */
export interface BasemapPort {
	get(ctx?: AdapterCtx): Promise<BasemapFile | null>;
}

/**
 * The full content-adapter surface. One implementation is active at a time
 * (r2Adapter today); swap it in adapter/index.ts without touching consumers.
 */
export interface ContentAdapter {
	manifest: ManifestPort;
	labels: LabelsPort;
	live: LivePort;
	static: StaticPort;
	historic: HistoricPort;
	provenance: ProvenancePort;
	dataHealth: DataHealthPort;
	basemap: BasemapPort;
}
