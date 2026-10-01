import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const RouteReliabilityIndexSchema = z.object({
	generated_utc: isoUtc(),
	route_ids: z.array(z.string()).optional(),
	...payloadEnvelopeFields(),
});
export type RouteReliabilityIndex = z.infer<typeof RouteReliabilityIndexSchema>;
