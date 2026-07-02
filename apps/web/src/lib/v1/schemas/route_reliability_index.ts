import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

/**
 * The route-reliability discovery index (historic/route_reliability/index.json): the
 * always-current daily set of routes WITH a published per-route reliability file. The
 * list-badge availability gate reads THIS instead of the static routes_index
 * `reliability` flag (which lags the spine + edge-caches). `route_ids` optional so a
 * snapshot published before this index existed still parses.
 */
export const RouteReliabilityIndexSchema = z.object({
	generated_utc: isoUtc(),
	route_ids: z.array(z.string()).optional(),
	...payloadEnvelopeFields(),
});
export type RouteReliabilityIndex = z.infer<typeof RouteReliabilityIndexSchema>;
