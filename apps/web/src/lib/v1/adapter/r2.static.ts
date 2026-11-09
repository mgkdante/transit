import { normalizeSnapshotPointer, resolveUrl } from '#lib/v1/config.ts';
import { getEntityJson } from '#lib/v1/http.ts';
import { BasemapFileSchema } from '#lib/v1/schemas/basemap.ts';
import { RouteFileSchema } from '#lib/v1/schemas/route.ts';
import { RoutesIndexSchema } from '#lib/v1/schemas/routes_index.ts';
import { StopFileSchema } from '#lib/v1/schemas/stop.ts';
import { StopsIndexSchema } from '#lib/v1/schemas/stops_index.ts';
import {
	fetchOf,
	providerOf,
	loadManifest,
	MUTABLE_CACHE,
	R2_DEFAULTS,
	readEntity,
	readWhole,
} from './r2.core';
import type { AdapterCtx } from './types';

export const staticPort = {
	async routesIndex(ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.static?.routes_index ?? R2_DEFAULTS.static.routes_index,
			RoutesIndexSchema,
			'static.routesIndex',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async route(routeId: string, ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		return readEntity(
			'static',
			manifest.files.static?.routes_prefix ?? R2_DEFAULTS.static.routes_prefix,
			routeId,
			RouteFileSchema,
			'static.route',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async stopsIndex(ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.static?.stops_index ?? R2_DEFAULTS.static.stops_index,
			StopsIndexSchema,
			'static.stopsIndex',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async stop(stopId: string, ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		return readEntity(
			'static',
			manifest.files.static?.stops_prefix ?? R2_DEFAULTS.static.stops_prefix,
			stopId,
			StopFileSchema,
			'static.stop',
			MUTABLE_CACHE,
			ctx,
		);
	},
};

export const basemapPort = {
	async get(ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		const relativePath = manifest.basemap ?? R2_DEFAULTS.basemap;
		const value = await getEntityJson(
			resolveUrl(relativePath, providerOf(ctx)),
			BasemapFileSchema,
			'basemap',
			fetchOf(ctx),
			{ cache: MUTABLE_CACHE, providerId: providerOf(ctx), signal: ctx?.signal },
		);
		if (value === undefined) return null;
		return { ...value, url: normalizeSnapshotPointer(value.url, providerOf(ctx)) };
	},
};
