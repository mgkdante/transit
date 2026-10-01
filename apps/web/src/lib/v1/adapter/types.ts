import type { FetchFn } from '$lib/v1/http';
import type { Manifest } from '$lib/v1/schemas/manifest';
import type { r2Adapter } from './r2';
import type { labelsPort, manifestPort } from './r2.core';
import type { historicPort } from './r2.historic';
import type { provenancePort } from './r2.provenance';
import type { dataHealthPort, livePort } from './r2.live';
import type { basemapPort, staticPort } from './r2.static';

export interface AdapterCtx {
	fetch?: FetchFn;
	manifest?: Manifest;
	cache?: Map<string, unknown>;
	signal?: AbortSignal;
	freshHistoryParent?: boolean;
}

export type ContentAdapter = typeof r2Adapter;
export type ManifestPort = typeof manifestPort;
export type LabelsPort = typeof labelsPort;
export type LivePort = typeof livePort;
export type StaticPort = typeof staticPort;
export type HistoricPort = typeof historicPort;
export type ProvenancePort = typeof provenancePort;
export type DataHealthPort = typeof dataHealthPort;
export type BasemapPort = typeof basemapPort;
