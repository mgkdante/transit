import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { Provenance } from '$lib/v1/schemas';

export const getProvenance: (ctx?: AdapterCtx) => Promise<Provenance> = (ctx) =>
	adapter.provenance.get(ctx);
