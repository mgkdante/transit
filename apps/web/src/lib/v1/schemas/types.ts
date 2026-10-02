import { z } from 'zod';

export const StatusCodeSchema = z.enum(['early', 'on_time', 'late', 'severe', 'unknown']);
export type StatusCode = z.infer<typeof StatusCodeSchema>;

export const OccupancyCodeSchema = z.enum(['empty', 'many_seats', 'few_seats', 'standing', 'full']);
export type OccupancyCode = z.infer<typeof OccupancyCodeSchema>;

export const SeverityCodeSchema = z.enum(['critical', 'high', 'watch']);
export type SeverityCode = z.infer<typeof SeverityCodeSchema>;

export const GrainSchema = z.enum(['live', 'day', 'week', 'month']);
export type Grain = z.infer<typeof GrainSchema>;

export const STATUS_CODES = StatusCodeSchema.options;
export const OCCUPANCY_CODES = OccupancyCodeSchema.options;
export const SEVERITY_CODES = SeverityCodeSchema.options;
export const GRAINS = GrainSchema.options;

declare const IsoUtcBrand: unique symbol;

export type IsoUtc = string & { readonly [IsoUtcBrand]: true };

export const isoUtc = (): z.ZodType<IsoUtc> =>
	z
		.string()
		.min(1)
		.transform((s) => s as IsoUtc);

export const payloadEnvelopeFields = () => ({
	schema_version: z.number().int().optional(),
	methodology_version: z.string().nullable().optional(),
	publish_generation_id: z.string().nullable().optional(),
});

export const CapabilitySchema = z.enum(['enabled', 'partial', 'unavailable', 'not_applicable']);
export type Capability = z.infer<typeof CapabilitySchema>;

export type { Manifest } from './manifest';
export type { Labels } from './labels';
