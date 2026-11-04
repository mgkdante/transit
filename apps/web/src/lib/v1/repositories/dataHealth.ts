import { adapter } from '#lib/v1/adapter/index.ts';
import type { AdapterCtx } from '#lib/v1/adapter/index.ts';
import type { DataHealth } from '#lib/v1/schemas/index.ts';

export const getDataHealth: (ctx?: AdapterCtx) => Promise<DataHealth | null> = (ctx) =>
	adapter.dataHealth.get(ctx);
