import { z } from 'zod';

export function assertProviderGeneration(label: string, value: unknown, provider: string): void {
	if (!value || typeof value !== 'object' || !('publish_generation_id' in value)) return;
	const generation = value.publish_generation_id;
	if (
		generation != null &&
		(typeof generation !== 'string' || !generation.startsWith(`${provider}@`))
	) {
		throw new Error(`[adapter.${label}] unexpected publication generation provider`);
	}
}

export function parsePort<T>(
	label: string,
	schema: z.ZodType<T>,
	value: unknown,
	provider?: string,
): T {
	if (provider !== undefined) assertProviderGeneration(label, value, provider);
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new Error(`[adapter.${label}] ${z.prettifyError(result.error)}`);
	}
	return result.data;
}
