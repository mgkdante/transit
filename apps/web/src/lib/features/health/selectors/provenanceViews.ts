// provenanceViews — pure view-model selectors for the provenance sections of
// /status (freshness, sources, gaps, pipeline-notes, retention, conformance).
//
// Lifted VERBATIM out of HealthStatus.svelte's inline logic so the orchestrator
// stays thin and each derivation is unit-testable off the DOM. i18n stays OUT of
// this module: callers pass already-localized label functions / maps. Every
// selector is honest — an absent/empty slice yields an empty array / null so the
// section stands DOWN, never a fabricated value.

import type { Provenance } from '$lib/v1/schemas';

// ── Per-feed freshness verdict ──────────────────────────────────────────────
// freshness[].status is the LAST INGESTION-RUN status (succeeded/failed/running/
// pending), NOT a freshness band. Map it to a dataviz status aspect + a caller-
// supplied verdict label. An unknown/absent status → the neutral "unknown" aspect
// (honest about a verdict we do not recognize).
export type FreshnessAspect = 'on_time' | 'late' | 'unknown';

/** Localized verdict words the selector fills in (i18n stays at the call site). */
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

// ── Section presence guards ─────────────────────────────────────────────────
// Each returns the (possibly empty) slice; an empty result stands the section
// DOWN at the call site.
export function freshnessOf(p: Provenance) {
	return p.freshness ?? [];
}
export function sourcesOf(p: Provenance) {
	return p.sources ?? [];
}
export function gapsOf(p: Provenance) {
	return p.gaps ?? [];
}

// ── Pipeline notes: EVERY published methodology string with no /metrics card ──
// A note is any methodology entry whose key is NOT threaded to a /metrics metric
// AND whose value is a non-empty string. We iterate the FULL published dict (never
// a hardcoded subset) so a new pipeline key the DB starts publishing renders
// automatically — a known key gets its localized label, an unknown one falls back
// to its humanized key (underscores → spaces), so no note is ever dropped.
export interface PipelineNote {
	readonly key: string;
	readonly label: string;
	readonly text: string;
}

export function pipelineNotesOf(
	p: Provenance,
	/** Provenance keys already threaded to a /metrics card (excluded here). */
	threadedKeys: Readonly<Record<string, unknown>>,
	/** key → localized label; a key absent here falls back to its humanized form. */
	labels: Readonly<Record<string, string>>,
): PipelineNote[] {
	const methodology = p.methodology;
	if (!methodology) return [];
	return Object.entries(methodology)
		.filter(([key, value]) => !(key in threadedKeys) && typeof value === 'string')
		.map(([key, value]) => ({
			key,
			label: labels[key] ?? key.replace(/_/g, ' '),
			text: (value as string).trim(),
		}))
		.filter((n) => n.text.length > 0);
}

// ── Retention ───────────────────────────────────────────────────────────────
/** detail/aggregate retention days, each present only when the key exists. */
export function retentionOf(p: Provenance): { detail: number | null; aggregate: number | null } {
	const r = p.retention ?? {};
	const detail = typeof r.detail_days === 'number' ? r.detail_days : null;
	const aggregate = typeof r.aggregate_days === 'number' ? r.aggregate_days : null;
	return { detail, aggregate };
}
