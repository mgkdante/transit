import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { DataHealth } from '$lib/v1/schemas';

export async function getDataHealth(ctx?: AdapterCtx): Promise<DataHealth | null> {
	return adapter.dataHealth.get(ctx);
}
