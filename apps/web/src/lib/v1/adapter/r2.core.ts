import type { z } from 'zod';
import type { Locale } from '$lib/i18n';
import { entityUrl, resolveUrl, v1Provider } from '$lib/v1/config';
import { getEntityJson, type FetchFn } from '$lib/v1/http';
import { LabelsFileSchema } from '$lib/v1/schemas/labels';
import { ManifestSchema, type Manifest } from '$lib/v1/schemas/manifest';
import { assertProviderGeneration } from '$lib/v1/schemas/parse';
import { browserAdapterManifest } from './browserManifest';
import type { AdapterCtx } from './types';

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

export const MUTABLE_CACHE: RequestCache = 'default';
export const IMMUTABLE_CACHE: RequestCache = 'force-cache';

export function fetchOf(ctx?: AdapterCtx): FetchFn {
	return ctx?.fetch ?? fetch;
}

export function providerOf(ctx?: AdapterCtx): string {
	return (
		ctx?.providerId ?? ctx?.manifest?.provider ?? browserAdapterManifest()?.provider ?? v1Provider()
	);
}

function checkedManifest(manifest: Manifest, provider: string): Manifest {
	if (manifest.provider !== provider) throw new Error('[v1.manifest] unexpected provider');
	assertProviderGeneration('manifest', manifest, provider);
	return manifest;
}

export async function loadManifest(ctx?: AdapterCtx): Promise<Manifest> {
	const provider = providerOf(ctx);
	if (ctx?.manifest !== undefined) return checkedManifest(ctx.manifest, provider);
	const bootManifest = browserAdapterManifest();
	if (bootManifest?.provider === provider) return checkedManifest(bootManifest, provider);

	const memo = ctx?.cache;
	const memoKey = `v1:${provider}:manifest`;
	if (memo?.has(memoKey)) {
		return checkedManifest(await (memo.get(memoKey) as Manifest | Promise<Manifest>), provider);
	}

	const url = resolveUrl(R2_DEFAULTS.manifest, provider);
	const pending = getEntityJson(url, ManifestSchema, 'manifest', fetchOf(ctx), {
		cache: MUTABLE_CACHE,
		providerId: providerOf(ctx),
		signal: ctx?.signal,
	}).then((manifest) => {
		if (manifest === undefined) {
			throw new Error(`[v1.manifest] manifest not found at ${url}`);
		}
		return checkedManifest(manifest, provider);
	});
	memo?.set(memoKey, pending);

	try {
		const manifest = await pending;
		memo?.set(memoKey, manifest);
		return manifest;
	} catch (error) {
		if (memo?.get(memoKey) === pending) memo.delete(memoKey);
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
	const url = resolveUrl(relativePath, providerOf(ctx));
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache,
		providerId: providerOf(ctx),
		signal: ctx?.signal,
	});
	if (value === undefined) {
		throw new Error(`[v1.${label}] expected file not found at ${url}`);
	}
	return value;
}

export async function loadManifestFresh(ctx?: AdapterCtx): Promise<Manifest> {
	const provider = providerOf(ctx);
	return checkedManifest(
		await readWhole(R2_DEFAULTS.manifest, ManifestSchema, 'manifest', MUTABLE_CACHE, ctx),
		provider,
	);
}

export async function readOptionalWhole<T>(
	relativePath: string,
	schema: z.ZodType<T>,
	label: string,
	ctx?: AdapterCtx,
): Promise<T | null> {
	const url = resolveUrl(relativePath, providerOf(ctx));
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache: MUTABLE_CACHE,
		providerId: providerOf(ctx),
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
	const url = entityUrl(tier, prefix, id, providerOf(ctx));
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), {
		cache,
		providerId: providerOf(ctx),
		signal: ctx?.signal,
	});
	return value ?? null;
}

export const manifestPort = {
	get: loadManifest,
	getFresh: loadManifestFresh,
};

export const labelsPort = {
	async get(lang: Locale, ctx?: AdapterCtx): Promise<Record<string, string>> {
		const manifest = await loadManifest(ctx);
		const relativePath = manifest.labels?.[lang] ?? `labels/${lang}.json`;
		const file = await getEntityJson(
			resolveUrl(relativePath, providerOf(ctx)),
			LabelsFileSchema,
			'labels',
			fetchOf(ctx),
			{ cache: MUTABLE_CACHE, providerId: providerOf(ctx), signal: ctx?.signal },
		);
		return file?.labels ?? {};
	},
};
