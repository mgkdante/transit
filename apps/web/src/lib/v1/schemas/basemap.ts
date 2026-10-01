import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const BasemapFileSchema = z.object({
	url: z.string(),
	attribution: z.string(),
	generated_utc: isoUtc(),
	format: z.string().optional(),
	min_zoom: z.number().int().optional(),
	max_zoom: z.number().int().optional(),
	style_url: z.string().nullable().optional(),
	...payloadEnvelopeFields(),
});
export type BasemapFile = z.infer<typeof BasemapFileSchema>;
