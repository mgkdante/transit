import type { z } from 'zod';
import type { Locale } from '$lib/i18n';
import { entityUrl, resolveUrl } from '$lib/v1/config';
import { getEntityJson, type FetchFn } from '$lib/v1/http';
import { LabelsFileSchema } from '$lib/v1/schemas/labels';
import { ManifestSchema, type Manifest } from '$lib/v1/schemas/manifest';
import { browserAdapterManifest } from './browserManifest';
import type { AdapterCtx, LabelsPort, ManifestPort } from './types';

export const R2_DEFAULTS = {
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

export const MUTABLE_CACHE: RequestCache = 'default';
export const IMMUTABLE_CACHE: RequestCache = 'force-cache';

export function fetchOf(ctx?: AdapterCtx): FetchFn {
	return ctx?.fetch ?? fetch;
}

export async function loadManifest(ctx?: AdapterCtx): Promise<Manifest> {
	if (ctx?.manifest !== undefined) return ctx.manifest;
	const bootManifest = browserAdapterManifest();
	if (bootManifest !== null) return bootManifest;

	const memo = ctx?.cache;
	if (memo?.has(MANIFEST_MEMO_KEY)) {
		return await (memo.get(MANIFEST_MEMO_KEY) as Manifest | Promise<Manifest>);
	}

	const url = resolveUrl(R2_DEFAULTS.manifest);
	const pending = getEntityJson(url, ManifestSchema, 'manifest', fetchOf(ctx), {
		cache: MUTABLE_CACHE,
		signal: ctx?.signal,
	}).then((manifest) => {
		if (manifest === undefined) {
			throw new Error(`[v1.manifest] manifest not found at ${url}`);
		}
		return manifest;
	});
	memo?.set(MANIFEST_MEMO_KEY, pending);

	try {
		const manifest = await pending;
		memo?.set(MANIFEST_MEMO_KEY, manifest);
		return manifest;
	} catch (error) {
		if (memo?.get(MANIFEST_MEMO_KEY) === pending) memo.delete(MANIFEST_MEMO_KEY);
		throw error;
	}
}

export async function readWhole<T>(
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
	if (value === undefined) {
		throw new Error(`[v1.${label}] expected file not found at ${url}`);
	}
	return value;
}

export async function readOptionalWhole<T>(
	relativePath: string,
	schema: z.ZodType<T>,
	label: string,
	ctx?: AdapterCtx,
): Promise<T | null> {
	const url = resolveUrl(relativePath);
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache: MUTABLE_CACHE,
		signal: ctx?.signal,
	});
	return value ?? null;
}

export async function readEntity<T>(
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

export const manifestPort: ManifestPort = {
	get: loadManifest,
};

export const labelsPort: LabelsPort = {
	async get(lang: Locale, ctx?: AdapterCtx): Promise<Record<string, string>> {
		const manifest = await loadManifest(ctx);
		const relativePath = manifest.labels?.[lang] ?? `labels/${lang}.json`;
		const file = await getEntityJson(
			resolveUrl(relativePath),
			LabelsFileSchema,
			'labels',
			fetchOf(ctx),
			{ cache: MUTABLE_CACHE, signal: ctx?.signal },
		);
		return file?.labels ?? {};
	},
};
