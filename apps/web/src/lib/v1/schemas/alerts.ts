import { z } from 'zod';
import { isoUtc, SeverityCodeSchema, payloadEnvelopeFields } from './types';
import { AlertActivePeriodSchema, AlertMessageProvenanceSchema } from './alert_history';

export const AlertSchema = z.object({
	id: z.string(),
	message: AlertMessageProvenanceSchema.nullable().optional(),
	severity: SeverityCodeSchema,
	header_key: z.string(),
	header_text: z.string().optional(),
	header_text_en: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	description_en: z.string().nullable().optional(),
	routes: z.array(z.string()).optional(),
	stops: z.array(z.string()).optional(),
	start_utc: isoUtc().nullable().optional(),
	end_utc: isoUtc().nullable().optional(),
	cause: z.string().nullable().optional(),
	effect: z.string().nullable().optional(),
	severity_level: z.string().nullable().optional(),
	url: z.string().nullable().optional(),
	url_en: z.string().nullable().optional(),
	active_periods: z.array(AlertActivePeriodSchema).optional(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertsFileSchema = z.object({
	generated_utc: isoUtc(),
	alerts: z.array(AlertSchema),
	...payloadEnvelopeFields(),
});
export type AlertsFile = z.infer<typeof AlertsFileSchema>;
