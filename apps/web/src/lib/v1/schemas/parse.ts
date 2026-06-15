import { z } from 'zod';

/**
 * Adapter-boundary parse helper.
 *
 * Every snapshot port (manifest / labels / live / static / historic /
 * provenance) crosses the R2 -> client trust boundary as unknown-shaped JSON.
 * Wrap that parse here so a contract drift throws an error that names the port
 * that produced the bad data: `[adapter.network] ...`. The repository layer
 * ($lib/v1) calls this once per fetched family — the stack trace alone tells us
 * which snapshot file broke.
 */
export function parsePort<T>(label: string, schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new Error(`[adapter.${label}] ${z.prettifyError(result.error)}`);
	}
	return result.data;
}
