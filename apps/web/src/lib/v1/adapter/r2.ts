// r2Adapter — the active ContentAdapter implementation.
//
// Reads the published snapshot contract over HTTP (R2 / Cloudflare Pages
// same-origin static path). Every read goes through `getEntityJson` (fetch +
// parsePort validation + 404-as-empty), and every URL is built from config.ts
// (`resolveUrl` / `entityUrl`) — this module never hardcodes the snapshot host.
//
// Manifest-first resolution: the per-tier file paths and per-entity prefixes are
// NOT hardcoded here — they come from `manifest.files.{live,static,historic}`.
// `loadManifest(ctx)` fetches + memoizes the manifest (once per request via
// ctx.cache), so a load() that touches several families pays one manifest fetch.
// We fall back to the contract defaults (snapshots/contract.py) when a manifest
// pointer is omitted, so a partial manifest still resolves.
//
// Cache policy: the live tier reads with `cache: 'default'` (short TTL, freshness
// matters); static + historic are long-TTL daily builds and read with
// `cache: 'force-cache'`. The caller's `event.fetch` (ctx.fetch) is used in SSR
// for request dedupe + payload inlining; otherwise the global fetch.

import type { z } from 'zod';
import { resolveUrl, entityUrl } from '$lib/v1/config';
import { getEntityJson, type FetchFn } from '$lib/v1/http';
import type { AdapterCtx, ContentAdapter } from './types';

import { ManifestSchema, type Manifest } from '$lib/v1/schemas/manifest';
import { LabelsFileSchema } from '$lib/v1/schemas/labels';
import { VehiclesFileSchema } from '$lib/v1/schemas/vehicles';
import { TripsFileSchema } from '$lib/v1/schemas/trips';
import { StopDeparturesFileSchema } from '$lib/v1/schemas/stop_departures';
import { AlertsFileSchema } from '$lib/v1/schemas/alerts';
import { NetworkFileSchema } from '$lib/v1/schemas/network';
import { RoutesIndexSchema } from '$lib/v1/schemas/routes_index';
import { RouteFileSchema } from '$lib/v1/schemas/route';
import { StopsIndexSchema } from '$lib/v1/schemas/stops_index';
import { StopFileSchema } from '$lib/v1/schemas/stop';
import { NetworkTrendSchema } from '$lib/v1/schemas/network_trend';
import { HotspotsSchema } from '$lib/v1/schemas/hotspots';
import { RepeatOffendersSchema } from '$lib/v1/schemas/repeat_offenders';
import { AlertHistorySchema } from '$lib/v1/schemas/alert_history';
import { ReceiptsIndexSchema } from '$lib/v1/schemas/receipts_index';
import { RouteReliabilityIndexSchema } from '$lib/v1/schemas/route_reliability_index';
import { ReceiptSchema } from '$lib/v1/schemas/receipts';
import { RouteReliabilitySchema } from '$lib/v1/schemas/route_reliability';
import { StopReliabilitySchema } from '$lib/v1/schemas/stop_reliability';
import { ProvenanceSchema } from '$lib/v1/schemas/provenance';
import { DataHealthSchema } from '$lib/v1/schemas/data_health';
import { BasemapFileSchema } from '$lib/v1/schemas/basemap';
import { AlertArchiveIndexSchema, AlertArchivePageSchema } from '$lib/v1/schemas/alert_archive';
import { HistoricAvailabilityIndexSchema } from '$lib/v1/schemas/history';
import { assertSafeHistoryArtifactPath } from '$lib/v1/history';

import type { Locale } from '$lib/i18n';

// ---------------------------------------------------------------------------
// Contract defaults — used when a manifest pointer/prefix is omitted. These
// mirror the Pydantic defaults in db/snapshots/contract.py so a partial
// manifest still resolves every family.
// ---------------------------------------------------------------------------

const DEFAULTS = {
	manifest: 'manifest.json',
	provenance: 'provenance.json',
	basemap: 'static/basemap.json',
	live: {
		vehicles: 'live/vehicles.json',
		trips: 'live/trips.json',
		alerts: 'live/alerts.json',
		network: 'live/network.json',
		stop_departures: 'live/stop_departures.json',
		data_health: 'status/data_health.json',
	},
	static: {
		routes_index: 'static/routes_index.json',
		stops_index: 'static/stops_index.json',
		routes_prefix: 'static/routes/',
		stops_prefix: 'static/stops/',
	},
	historic: {
		history_index: 'historic/history/index.json',
		alerts_index: 'historic/alerts/index.json',
		network_trend: 'historic/network_trend.json',
		hotspots: 'historic/hotspots.json',
		repeat_offenders: 'historic/repeat_offenders.json',
		alert_history: 'historic/alert_history.json',
		receipts_index: 'historic/receipts/index.json',
		route_reliability_prefix: 'historic/route_reliability/',
		route_reliability_index: 'historic/route_reliability/index.json',
		stop_reliability_prefix: 'historic/stop_reliability/',
		receipts_prefix: 'historic/receipts/',
	},
} as const;

const MANIFEST_MEMO_KEY = 'v1:manifest';

// Per-tier cache hints. Live is short-TTL (freshness); static/historic are
// daily builds and may serve from cache.
const LIVE_CACHE: RequestCache = 'default';
const SLOW_CACHE: RequestCache = 'force-cache';

function fetchOf(ctx?: AdapterCtx): FetchFn {
	return ctx?.fetch ?? fetch;
}

/**
 * Fetch + memoize the manifest. Memoized on `ctx.cache` (App.Locals.v1Cache) so
 * a request that reads several families pays one manifest round-trip.
 */
async function loadManifest(ctx?: AdapterCtx): Promise<Manifest> {
	const memo = ctx?.cache;
	if (memo?.has(MANIFEST_MEMO_KEY)) {
		return memo.get(MANIFEST_MEMO_KEY) as Manifest;
	}
	const url = resolveUrl(DEFAULTS.manifest);
	const manifest = await getEntityJson(url, ManifestSchema, 'manifest', fetchOf(ctx), {
		cache: SLOW_CACHE,
		signal: ctx?.signal,
	});
	// The manifest is the snapshot root — a 404 here is a real misconfig, not an
	// empty entity. getEntityJson returns undefined on 404; surface it loudly.
	if (manifest === undefined) {
		throw new Error(`[v1.manifest] manifest not found at ${url}`);
	}
	memo?.set(MANIFEST_MEMO_KEY, manifest);
	return manifest;
}

/** Read a whole-file family from a manifest-resolved relative path. */
async function readWhole<T>(
	relativePath: string,
	schema: z.ZodType<T>,
	label: string,
	cache: RequestCache,
	ctx?: AdapterCtx,
): Promise<T> {
	const url = resolveUrl(relativePath);
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache,
		signal: ctx?.signal,
	});
	// Whole-file families are always-published roots; a 404 is a real error, not
	// an empty entity (only per-entity prefix reads use the 404-as-null path).
	if (value === undefined) {
		throw new Error(`[v1.${label}] expected file not found at ${url}`);
	}
	return value;
}

/** Read an optional whole-file collection root; 404 means rollout absence. */
async function readOptionalWhole<T>(
	relativePath: string,
	schema: z.ZodType<T>,
	label: string,
	ctx?: AdapterCtx,
): Promise<T | null> {
	const url = resolveUrl(relativePath);
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache: SLOW_CACHE,
		signal: ctx?.signal,
	});
	return value ?? null;
}

/** Read a per-entity file under a manifest prefix; 404 -> null (render empty). */
async function readEntity<T>(
	tier: 'live' | 'static' | 'historic',
	prefix: string,
	id: string,
	schema: z.ZodType<T>,
	label: string,
	cache: RequestCache,
	ctx?: AdapterCtx,
): Promise<T | null> {
	const url = entityUrl(tier, prefix, id);
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache,
		signal: ctx?.signal,
	});
	return value ?? null;
}

export const r2Adapter: ContentAdapter = {
	manifest: {
		get: (ctx) => loadManifest(ctx),
	},

	labels: {
		// The manifest's `labels` field maps lang -> relative path
		// ("labels/fr.json"). Resolve the path for the requested lang, fetch the
		// LabelsFile, and return its flat code->text map. Any miss (no entry for
		// the lang, or a 404 on the file) resolves to an EMPTY map so
		// resolveLabel() falls back to the raw code — fail-soft, never throws on
		// a missing label table.
		async get(lang: Locale, ctx?: AdapterCtx): Promise<Record<string, string>> {
			const manifest = await loadManifest(ctx);
			const rel = manifest.labels?.[lang] ?? `labels/${lang}.json`;
			const url = resolveUrl(rel);
			const file = await getEntityJson(url, LabelsFileSchema, 'labels', fetchOf(ctx), {
				cache: SLOW_CACHE,
				signal: ctx?.signal,
			});
			return file?.labels ?? {};
		},
	},

	live: {
		vehicles: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.live.vehicles ?? DEFAULTS.live.vehicles,
				VehiclesFileSchema,
				'live.vehicles',
				LIVE_CACHE,
				ctx,
			);
		},
		trips: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.live.trips ?? DEFAULTS.live.trips,
				TripsFileSchema,
				'live.trips',
				LIVE_CACHE,
				ctx,
			);
		},
		stopDepartures: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.live.stop_departures ?? DEFAULTS.live.stop_departures,
				StopDeparturesFileSchema,
				'live.stopDepartures',
				LIVE_CACHE,
				ctx,
			);
		},
		alerts: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.live.alerts ?? DEFAULTS.live.alerts,
				AlertsFileSchema,
				'live.alerts',
				LIVE_CACHE,
				ctx,
			);
		},
		network: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.live.network ?? DEFAULTS.live.network,
				NetworkFileSchema,
				'live.network',
				LIVE_CACHE,
				ctx,
			);
		},
	},

	static: {
		routesIndex: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.static?.routes_index ?? DEFAULTS.static.routes_index,
				RoutesIndexSchema,
				'static.routesIndex',
				SLOW_CACHE,
				ctx,
			);
		},
		route: async (routeId, ctx) => {
			const m = await loadManifest(ctx);
			return readEntity(
				'static',
				m.files.static?.routes_prefix ?? DEFAULTS.static.routes_prefix,
				routeId,
				RouteFileSchema,
				'static.route',
				SLOW_CACHE,
				ctx,
			);
		},
		stopsIndex: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.static?.stops_index ?? DEFAULTS.static.stops_index,
				StopsIndexSchema,
				'static.stopsIndex',
				SLOW_CACHE,
				ctx,
			);
		},
		stop: async (stopId, ctx) => {
			const m = await loadManifest(ctx);
			return readEntity(
				'static',
				m.files.static?.stops_prefix ?? DEFAULTS.static.stops_prefix,
				stopId,
				StopFileSchema,
				'static.stop',
				SLOW_CACHE,
				ctx,
			);
		},
	},

	historic: {
		historyIndex: async (ctx) => {
			const m = await loadManifest(ctx);
			return readOptionalWhole(
				m.files.historic?.history_index ?? DEFAULTS.historic.history_index,
				HistoricAvailabilityIndexSchema,
				'historic.historyIndex',
				ctx,
			);
		},
		alertArchiveIndex: async (ctx) => {
			const m = await loadManifest(ctx);
			return readOptionalWhole(
				m.files.historic?.alerts_index ?? DEFAULTS.historic.alerts_index,
				AlertArchiveIndexSchema,
				'historic.alertArchiveIndex',
				ctx,
			);
		},
		alertArchivePage: async (path, ctx) => {
			const safePath = assertSafeHistoryArtifactPath(path);
			const url = resolveUrl(safePath);
			const value = await getEntityJson(
				url,
				AlertArchivePageSchema,
				'historic.alertArchivePage',
				fetchOf(ctx),
				{ cache: SLOW_CACHE, signal: ctx?.signal },
			);
			return value ?? null;
		},
		networkTrend: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.historic?.network_trend ?? DEFAULTS.historic.network_trend,
				NetworkTrendSchema,
				'historic.networkTrend',
				SLOW_CACHE,
				ctx,
			);
		},
		hotspots: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.historic?.hotspots ?? DEFAULTS.historic.hotspots,
				HotspotsSchema,
				'historic.hotspots',
				SLOW_CACHE,
				ctx,
			);
		},
		repeatOffenders: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.historic?.repeat_offenders ?? DEFAULTS.historic.repeat_offenders,
				RepeatOffendersSchema,
				'historic.repeatOffenders',
				SLOW_CACHE,
				ctx,
			);
		},
		alertHistory: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.historic?.alert_history ?? DEFAULTS.historic.alert_history,
				AlertHistorySchema,
				'historic.alertHistory',
				SLOW_CACHE,
				ctx,
			);
		},
		receiptsIndex: async (ctx) => {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.historic?.receipts_index ?? DEFAULTS.historic.receipts_index,
				ReceiptsIndexSchema,
				'historic.receiptsIndex',
				SLOW_CACHE,
				ctx,
			);
		},
		routeReliabilityIndex: async (ctx) => {
			const m = await loadManifest(ctx);
			const url = resolveUrl(
				m.files.historic?.route_reliability_index ?? DEFAULTS.historic.route_reliability_index,
			);
			// 404 -> null (the index is not published yet): the list loader falls back to the
			// legacy routes_index `reliability` flag, so the rollout window never breaks.
			const value = await getEntityJson(
				url,
				RouteReliabilityIndexSchema,
				'historic.routeReliabilityIndex',
				fetchOf(ctx),
				{ cache: SLOW_CACHE, signal: ctx?.signal },
			);
			return value ?? null;
		},
		receipt: async (date, ctx) => {
			const m = await loadManifest(ctx);
			return readEntity(
				'historic',
				m.files.historic?.receipts_prefix ?? DEFAULTS.historic.receipts_prefix,
				date,
				ReceiptSchema,
				'historic.receipt',
				SLOW_CACHE,
				ctx,
			);
		},
		routeReliability: async (routeId, ctx) => {
			const m = await loadManifest(ctx);
			return readEntity(
				'historic',
				m.files.historic?.route_reliability_prefix ?? DEFAULTS.historic.route_reliability_prefix,
				routeId,
				RouteReliabilitySchema,
				'historic.routeReliability',
				SLOW_CACHE,
				ctx,
			);
		},
		stopReliability: async (stopId, ctx) => {
			const m = await loadManifest(ctx);
			return readEntity(
				'historic',
				m.files.historic?.stop_reliability_prefix ?? DEFAULTS.historic.stop_reliability_prefix,
				stopId,
				StopReliabilitySchema,
				'historic.stopReliability',
				SLOW_CACHE,
				ctx,
			);
		},
	},

	basemap: {
		// The basemap pointer is a TOP-LEVEL manifest field (null until a PMTiles
		// archive is hosted), NOT under files.*. 404 → null (no basemap) so the
		// map degrades to the minimal-dark style. Falls back to the default path
		// when the manifest pointer is absent so a hosted-but-unpointered archive
		// (e.g. uploaded out-of-band) still resolves.
		async get(ctx?: AdapterCtx) {
			const m = await loadManifest(ctx);
			const rel = m.basemap ?? DEFAULTS.basemap;
			const url = resolveUrl(rel);
			const file = await getEntityJson(url, BasemapFileSchema, 'basemap', fetchOf(ctx), {
				cache: SLOW_CACHE,
				signal: ctx?.signal,
			});
			return file ?? null;
		},
	},

	provenance: {
		async get(ctx?: AdapterCtx) {
			const m = await loadManifest(ctx);
			return readWhole(
				m.files.historic?.provenance ?? DEFAULTS.provenance,
				ProvenanceSchema,
				'provenance',
				SLOW_CACHE,
				ctx,
			);
		},
	},

	dataHealth: {
		// Manifest-first like every live file, falling back to the contract default
		// path when the pointer is absent (pre-S11 manifest). A 404 → null: /status
		// stands the pipeline-lanes section DOWN on a legacy publish rather than
		// erroring, so the surface degrades honestly during the rollout window.
		async get(ctx?: AdapterCtx) {
			const m = await loadManifest(ctx);
			const rel = m.files.live.data_health ?? DEFAULTS.live.data_health;
			const url = resolveUrl(rel);
			const value = await getEntityJson(url, DataHealthSchema, 'dataHealth', fetchOf(ctx), {
				cache: LIVE_CACHE,
				signal: ctx?.signal,
			});
			return value ?? null;
		},
	},
};
