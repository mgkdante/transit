import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { Provenance } from '$lib/v1/schemas';

export async function getProvenance(ctx?: AdapterCtx): Promise<Provenance> {
	return adapter.provenance.get(ctx);
}
