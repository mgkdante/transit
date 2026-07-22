import { resolveUrl } from '$lib/v1/config';
import { getEntityJson } from '$lib/v1/http';
import { BasemapFileSchema } from '$lib/v1/schemas/basemap';
import { RouteFileSchema } from '$lib/v1/schemas/route';
import { RoutesIndexSchema } from '$lib/v1/schemas/routes_index';
import { StopFileSchema } from '$lib/v1/schemas/stop';
import { StopsIndexSchema } from '$lib/v1/schemas/stops_index';
import {
	fetchOf,
	loadManifest,
	MUTABLE_CACHE,
	R2_DEFAULTS,
	readEntity,
	readWhole,
} from './r2.core';
import type { BasemapPort, StaticPort } from './types';

export const staticPort: StaticPort = {
	async routesIndex(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.static?.routes_index ?? R2_DEFAULTS.static.routes_index,
			RoutesIndexSchema,
			'static.routesIndex',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async route(routeId, ctx) {
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
	async stopsIndex(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.static?.stops_index ?? R2_DEFAULTS.static.stops_index,
			StopsIndexSchema,
			'static.stopsIndex',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async stop(stopId, ctx) {
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

export const basemapPort: BasemapPort = {
	async get(ctx) {
		const manifest = await loadManifest(ctx);
		const relativePath = manifest.basemap ?? R2_DEFAULTS.basemap;
		const value = await getEntityJson(
			resolveUrl(relativePath),
			BasemapFileSchema,
			'basemap',
			fetchOf(ctx),
			{ cache: MUTABLE_CACHE, signal: ctx?.signal },
		);
		return value ?? null;
	},
};
