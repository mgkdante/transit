// hotspots.ts — Zod mirror of historic_hotspots.schema.json (title: "Hotspots").
// The ranked worst spots on the network: each carries a rank, a type
// discriminator (route/stop), id, optional name, an OTP delta (points) and a
// free-string severity label.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const HotspotSchema = z.object({
	rank: z.number().int(),
	// 'route' | 'stop' discriminator — free string the pipeline owns.
	type: z.string(),
	id: z.string(),
	name: z.string().nullable().optional(),
	otp_delta_pts: z.number().nullable().optional(),
	// Free-string severity from the pipeline (NOT the SeverityCode alert enum).
	severity: z.string().nullable().optional(),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

export const HotspotsSchema = z.object({
	generated_utc: isoUtc(),
	hotspots: z.array(HotspotSchema).optional(),
	...payloadEnvelopeFields(),
});
export type Hotspots = z.infer<typeof HotspotsSchema>;
