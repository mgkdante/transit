import { ProvenanceSchema } from '$lib/v1/schemas/provenance';
import type { AdapterCtx } from './types';
import { R2_DEFAULTS as DEFAULTS, MUTABLE_CACHE, loadManifest, readWhole } from './r2.core';

export const provenancePort = {
	async get(ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.provenance ?? DEFAULTS.provenance,
			ProvenanceSchema,
			'provenance',
			MUTABLE_CACHE,
			ctx,
		);
	},
};
