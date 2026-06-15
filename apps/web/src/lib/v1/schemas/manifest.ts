// manifest.ts — Zod mirror of manifest.schema.json (title: "Manifest").
// The manifest is the snapshot root pointer: it names every file path per tier,
// carries the label dictionary, bbox, attribution and dataset version. The web
// client fetches it first, then resolves every other family relative to it.
//
// Honesty rule: where the JSON Schema allows null (anyOf [..., {type:null}]),
// the field is .nullable(). Defaulted-but-not-required string paths stay
// .optional() (the file may omit them and the pipeline backfills the default).

import { z } from 'zod';
import { isoUtc } from './types';

export const ManifestLiveFilesSchema = z.object({
	generated_utc: isoUtc(),
	network: z.string().optional(),
	vehicles: z.string().optional(),
	trips: z.string().optional(),
	stop_departures: z.string().optional(),
	alerts: z.string().optional(),
	ttl_s: z.number().int().optional(),
});
export type ManifestLiveFiles = z.infer<typeof ManifestLiveFilesSchema>;

export const ManifestStaticFilesSchema = z.object({
	// DATA time of the current static dataset; null = static tier never published.
	generated_utc: isoUtc().nullable().optional(),
	routes_index: z.string().optional(),
	routes_prefix: z.string().optional(),
	stops_index: z.string().optional(),
	stops_prefix: z.string().optional(),
	// static/basemap.json pointer; null until SNAPSHOT_BASEMAP_PMTILES_URL is set.
	basemap: z.string().nullable().optional(),
	ttl_s: z.number().int().optional(),
});
export type ManifestStaticFiles = z.infer<typeof ManifestStaticFilesSchema>;

export const ManifestHistoricFilesSchema = z.object({
	// DATA time of the current historic build; null = historic tier never published.
	generated_utc: isoUtc().nullable().optional(),
	route_reliability_prefix: z.string().optional(),
	stop_reliability_prefix: z.string().optional(),
	// HTTP 404 on a per-entity fetch means "no data for this entity" → render
	// empty state, not an error (see prefix field descriptions in the schema).
	receipts_index: z.string().optional(),
	receipts_prefix: z.string().optional(),
	repeat_offenders: z.string().optional(),
	hotspots: z.string().optional(),
	network_trend: z.string().optional(),
	alert_history: z.string().optional(),
	provenance: z.string().optional(),
	ttl_s: z.number().int().optional(),
});
export type ManifestHistoricFiles = z.infer<typeof ManifestHistoricFilesSchema>;

export const ManifestFilesSchema = z.object({
	live: ManifestLiveFilesSchema,
	static: ManifestStaticFilesSchema.optional(),
	historic: ManifestHistoricFilesSchema.optional(),
});
export type ManifestFiles = z.infer<typeof ManifestFilesSchema>;

export const ManifestSchema = z.object({
	provider: z.string(),
	display_name: z.string(),
	// [minLon, minLat, maxLon, maxLat] (the schema only constrains: array of number).
	bbox: z.array(z.number()),
	attribution: z.string(),
	dataset_version: z.string(),
	labels: z.record(z.string(), z.string()),
	files: ManifestFilesSchema,
	surfaces: z.array(z.string()),
	// absolute URL of the basemap pointer; null until a PMTiles archive is hosted.
	basemap: z.string().nullable().optional(),
	default_lang: z.string().optional(),
	tz: z.string().optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
