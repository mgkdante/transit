import { z } from 'zod';

export function parsePort<T>(label: string, schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new Error(`[adapter.${label}] ${z.prettifyError(result.error)}`);
	}
	return result.data;
}
