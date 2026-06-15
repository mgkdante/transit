// basemap.ts — Zod mirror of static_basemap.schema.json (title: "BasemapFile").
// A settings-driven pointer to the hosted PMTiles archive. Published only when
// SNAPSHOT_BASEMAP_PMTILES_URL is configured; until then Manifest.basemap is
// null and no basemap.json object exists.

import { z } from 'zod';
import { isoUtc } from './types';

export const BasemapFileSchema = z.object({
	url: z.string(),
	attribution: z.string(),
	generated_utc: isoUtc(),
	format: z.string().optional(),
	min_zoom: z.number().int().optional(),
	max_zoom: z.number().int().optional(),
	// Optional MapLibre style URL; null when the archive ships without a style.
	style_url: z.string().nullable().optional(),
});
export type BasemapFile = z.infer<typeof BasemapFileSchema>;
