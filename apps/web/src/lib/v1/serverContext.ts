import type { AdapterCtx } from './adapter';
import { bindingFetch, r2BucketFetch } from './binding';

export interface IdentitySeed {
	id: string;
	name: string;
}

interface ServerV1Event {
	fetch: typeof fetch;
	locals: { v1Cache?: Map<string, unknown> };
	platform?: App.Platform;
	url: URL;
}

/** Build the per-request repository context for server loaders. */
export function serverV1Context(event: ServerV1Event): AdapterCtx {
	const snapshots = event.platform?.env?.SNAPSHOTS;
	const binding = event.platform?.env?.DATA;
	const compatibilityFetch = binding ? bindingFetch(binding, event.url.origin) : null;
	const directFetch = snapshots ? r2BucketFetch(snapshots, event.url.origin) : null;
	const snapshotFetch = directFetch
		? compatibilityFetch
			? async (...args: Parameters<typeof directFetch>) => {
					try {
						return await directFetch(...args);
					} catch {
						return compatibilityFetch(...args);
					}
				}
			: directFetch
		: (compatibilityFetch ?? event.fetch);
	return {
		fetch: snapshotFetch,
		cache: event.locals.v1Cache,
	};
}
