// The v1 content-adapter swap point.
//
// Repositories ($lib/v1/repositories/**) and the live store import `adapter`
// from here and never know which backend is active. Today that is the R2 / HTTP
// adapter (r2.ts) reading the published snapshot contract; swapping in a mock or
// an alternate transport is a one-line change here, with the `ContentAdapter`
// type annotation as the compile-time gate that the replacement is complete.

import { r2Adapter } from './r2';
import type { ContentAdapter } from './types';

/** The active content adapter. Single swap point — see file header. */
export const adapter: ContentAdapter = r2Adapter;

export type {
	ContentAdapter,
	AdapterCtx,
	ManifestPort,
	LabelsPort,
	LivePort,
	StaticPort,
	HistoricPort,
	ProvenancePort,
} from './types';
