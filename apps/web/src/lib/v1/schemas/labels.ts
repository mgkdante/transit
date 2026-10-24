import { z } from 'zod';
import { LabelsFileSchema } from './generated/static_labels';
export { LabelsFileSchema, type LabelsFile } from './generated/static_labels';

export const LabelsSchema = LabelsFileSchema.shape.labels;
export type Labels = z.infer<typeof LabelsSchema>;
