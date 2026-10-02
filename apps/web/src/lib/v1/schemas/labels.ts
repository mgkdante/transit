import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

export const LabelsSchema = z.record(z.string(), z.string());
export type Labels = z.infer<typeof LabelsSchema>;

export const LabelsFileSchema = z.object({
	generated_utc: isoUtc(),
	labels: LabelsSchema,
	...payloadEnvelopeFields(),
});
export type LabelsFile = z.infer<typeof LabelsFileSchema>;
