import type { FetchFn } from '$lib/v1/http';
import type { Manifest } from '$lib/v1/schemas/manifest';
import type { r2Adapter } from './r2';
import type { labelsPort, manifestPort } from './r2.core';
import type { historicPort, provenancePort } from './r2.historic';
import type { dataHealthPort, livePort } from './r2.live';
import type { basemapPort, staticPort } from './r2.static';

/**
 * Adapter read context. SSR loads thread it from `event` for request dedupe;
 * browser consumers can reuse an already-loaded manifest across related reads.
 */
export interface AdapterCtx {
	/** SSR fetch (event.fetch); defaults to the global fetch when omitted. */
	fetch?: FetchFn;
	/** Authoritative manifest already loaded by the caller; avoids resolving it again. */
	manifest?: Manifest;
	/** Per-request memo (App.Locals.v1Cache) so manifest/labels fetch once per request. */
	cache?: Map<string, unknown>;
	/** Optional abort signal for the underlying requests. */
	signal?: AbortSignal;
	/** Force one immediate retained-history pointer re-read with cache busting. */
	freshHistoryParent?: boolean;
}

/** Async snapshot reads; optional entities return null when their file is absent. */
export type ContentAdapter = typeof r2Adapter;
export type ManifestPort = typeof manifestPort;
export type LabelsPort = typeof labelsPort;
export type LivePort = typeof livePort;
export type StaticPort = typeof staticPort;
export type HistoricPort = typeof historicPort;
export type ProvenancePort = typeof provenancePort;
export type DataHealthPort = typeof dataHealthPort;
export type BasemapPort = typeof basemapPort;
