import type { FetchFn } from '$lib/v1/http';
import type { Manifest } from '$lib/v1/schemas/manifest';

export interface AdapterCtx {
	fetch?: FetchFn;
	manifest?: Manifest;
	cache?: Map<string, unknown>;
	signal?: AbortSignal;
	freshHistoryParent?: boolean;
}
