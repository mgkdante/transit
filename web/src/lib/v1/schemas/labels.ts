// labels.ts — Zod mirror of static_labels.schema.json (title: "LabelsFile").
// The labels file is the code->display dictionary. `resolveLabel(code, labels)`
// ($lib/v1) reads `labels` (a flat Record<string,string>) to turn codes like
// 'on_time' / route ids into human strings, falling back to the code itself.

import { z } from 'zod';
import { isoUtc } from './types';

/** The flat code->text dictionary carried by both the labels file and manifest. */
export const LabelsSchema = z.record(z.string(), z.string());
export type Labels = z.infer<typeof LabelsSchema>;

export const LabelsFileSchema = z.object({
	generated_utc: isoUtc(),
	labels: LabelsSchema,
});
export type LabelsFile = z.infer<typeof LabelsFileSchema>;
