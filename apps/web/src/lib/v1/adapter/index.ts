import { r2Adapter } from './r2';

export const adapter = r2Adapter;

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
