import { adapter } from '#lib/v1/adapter/index.ts';
import type { AdapterCtx } from '#lib/v1/adapter/index.ts';
import type { Provenance } from '#lib/v1/schemas/index.ts';

export const getProvenance: (ctx?: AdapterCtx) => Promise<Provenance> = (ctx) =>
	adapter.provenance.get(ctx);
