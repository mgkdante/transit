import { z } from 'zod';
import { CapabilitySchema, isoUtc, payloadEnvelopeFields } from './types';

export const ProviderCapabilitiesSchema = z.object({
	live_map: CapabilitySchema.nullable().optional(),
	network_health: CapabilitySchema.nullable().optional(),
	lookups: CapabilitySchema.nullable().optional(),
	reliability: CapabilitySchema.nullable().optional(),
	accountability: CapabilitySchema.nullable().optional(),
	data_trust: CapabilitySchema.nullable().optional(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ManifestLiveFilesSchema = z.object({
	generated_utc: isoUtc(),
	network: z.string().optional(),
	vehicles: z.string().optional(),
	trips: z.string().optional(),
	stop_departures: z.string().optional(),
	alerts: z.string().optional(),
	data_health: z.string().optional(),
	ttl_s: z.number().int().optional(),
});
export type ManifestLiveFiles = z.infer<typeof ManifestLiveFilesSchema>;

export const ManifestStaticFilesSchema = z.object({
	generated_utc: isoUtc().nullable().optional(),
	routes_index: z.string().optional(),
	routes_prefix: z.string().optional(),
	stops_index: z.string().optional(),
	stops_prefix: z.string().optional(),
	basemap: z.string().nullable().optional(),
	ttl_s: z.number().int().optional(),
});
export type ManifestStaticFiles = z.infer<typeof ManifestStaticFilesSchema>;

export const ManifestHistoricFilesSchema = z.object({
	generated_utc: isoUtc().nullable().optional(),
	route_reliability_prefix: z.string().optional(),
	route_reliability_index: z.string().optional(),
	stop_reliability_prefix: z.string().optional(),
	receipts_index: z.string().optional(),
	receipts_prefix: z.string().optional(),
	repeat_offenders: z.string().optional(),
	hotspots: z.string().optional(),
	network_trend: z.string().optional(),
	alert_history: z.string().optional(),
	alerts_index: z.string().optional(),
	history_index: z.string().optional(),
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
	short_name: z.string().nullable().optional(),
	city: z.string().nullable().optional(),
	bbox: z.array(z.number()),
	attribution: z.string(),
	dataset_version: z.string(),
	labels: z.record(z.string(), z.string()),
	files: ManifestFilesSchema,
	surfaces: z.array(z.string()),
	capabilities: ProviderCapabilitiesSchema.nullable().optional(),
	basemap: z.string().nullable().optional(),
	default_lang: z.string().optional(),
	tz: z.string().optional(),
	...payloadEnvelopeFields(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
