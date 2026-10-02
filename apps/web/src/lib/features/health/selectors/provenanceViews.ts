import type { Provenance } from '$lib/v1/schemas';

export type FreshnessAspect = 'on_time' | 'late' | 'unknown';

export interface StatusVerdictLabels {
	readonly ok: string;
	readonly running: string;
	readonly failed: string;
	readonly unknown: string;
}

export interface FreshnessVerdict {
	readonly aspect: FreshnessAspect;
	readonly label: string;
}

export function verdictFor(
	status: string | null | undefined,
	labels: StatusVerdictLabels,
): FreshnessVerdict {
	switch (status) {
		case 'succeeded':
			return { aspect: 'on_time', label: labels.ok };
		case 'failed':
			return { aspect: 'late', label: labels.failed };
		case 'running':
		case 'pending':
			return { aspect: 'unknown', label: labels.running };
		default:
			return { aspect: 'unknown', label: labels.unknown };
	}
}

export function freshnessOf(p: Provenance) {
	return p.freshness ?? [];
}
export function sourcesOf(p: Provenance) {
	return p.sources ?? [];
}
export function gapsOf(p: Provenance) {
	return p.gaps ?? [];
}

export type PipelineNoteKind = 'definition' | 'math' | 'caveat' | 'pipeline-note';

export interface PipelineNote {
	readonly key: string;
	readonly label: string;
	readonly text: string;
	readonly kind: PipelineNoteKind;
}

export function pipelineNotesOf(
	p: Provenance,
	threadedKeys: Readonly<Record<string, unknown>>,
	labels: Readonly<Record<string, string>>,
	kinds: Readonly<Record<string, PipelineNoteKind>> = {},
): PipelineNote[] {
	const methodology = p.methodology;
	if (!methodology) return [];
	return Object.entries(methodology)
		.filter(([key, value]) => !(key in threadedKeys) && typeof value === 'string')
		.map(([key, value]) => ({
			key,
			label: labels[key] ?? key.replace(/_/g, ' '),
			text: (value as string).trim(),
			kind: kinds[key] ?? 'pipeline-note',
		}))
		.filter((n) => n.text.length > 0);
}

export function retentionOf(p: Provenance): { detail: number | null; aggregate: number | null } {
	const r = p.retention ?? {};
	const detail = typeof r.detail_days === 'number' ? r.detail_days : null;
	const aggregate = typeof r.aggregate_days === 'number' ? r.aggregate_days : null;
	return { detail, aggregate };
}
