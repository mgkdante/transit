import { resolveUrl } from '$lib/v1/config';
import { getEntityJson } from '$lib/v1/http';
import { AlertsFileSchema } from '$lib/v1/schemas/alerts';
import { DataHealthSchema } from '$lib/v1/schemas/data_health';
import { NetworkFileSchema } from '$lib/v1/schemas/network';
import { StopDeparturesFileSchema } from '$lib/v1/schemas/stop_departures';
import { TripsFileSchema } from '$lib/v1/schemas/trips';
import { VehiclesFileSchema } from '$lib/v1/schemas/vehicles';
import { fetchOf, loadManifest, MUTABLE_CACHE, R2_DEFAULTS, readWhole } from './r2.core';
import type { DataHealthPort, LivePort } from './types';

export const livePort: LivePort = {
	async vehicles(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.live.vehicles ?? R2_DEFAULTS.live.vehicles,
			VehiclesFileSchema,
			'live.vehicles',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async trips(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.live.trips ?? R2_DEFAULTS.live.trips,
			TripsFileSchema,
			'live.trips',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async stopDepartures(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.live.stop_departures ?? R2_DEFAULTS.live.stop_departures,
			StopDeparturesFileSchema,
			'live.stopDepartures',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async alerts(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.live.alerts ?? R2_DEFAULTS.live.alerts,
			AlertsFileSchema,
			'live.alerts',
			MUTABLE_CACHE,
			ctx,
		);
	},
	async network(ctx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.live.network ?? R2_DEFAULTS.live.network,
			NetworkFileSchema,
			'live.network',
			MUTABLE_CACHE,
			ctx,
		);
	},
};

export const dataHealthPort: DataHealthPort = {
	async get(ctx) {
		const manifest = await loadManifest(ctx);
		const relativePath = manifest.files.live.data_health ?? R2_DEFAULTS.live.data_health;
		const value = await getEntityJson(
			resolveUrl(relativePath),
			DataHealthSchema,
			'dataHealth',
			fetchOf(ctx),
			{ cache: MUTABLE_CACHE, signal: ctx?.signal },
		);
		return value ?? null;
	},
};
