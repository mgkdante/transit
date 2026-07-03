// provenanceViews.test.ts — the provenance section view-model selectors.

import { describe, it, expect } from 'vitest';
import {
	verdictFor,
	pipelineNotesOf,
	retentionOf,
	type StatusVerdictLabels,
} from './provenanceViews';
import type { Provenance, IsoUtc } from '$lib/v1/schemas';

const iso = (s: string) => s as unknown as IsoUtc;

const verdictLabels: StatusVerdictLabels = {
	ok: 'loaded',
	running: 'loading',
	failed: 'load failed',
	unknown: 'unknown',
};

describe('verdictFor', () => {
	it('maps run statuses to a dataviz aspect + label', () => {
		expect(verdictFor('succeeded', verdictLabels)).toEqual({ aspect: 'on_time', label: 'loaded' });
		expect(verdictFor('failed', verdictLabels)).toEqual({ aspect: 'late', label: 'load failed' });
		expect(verdictFor('running', verdictLabels)).toEqual({ aspect: 'unknown', label: 'loading' });
		expect(verdictFor('pending', verdictLabels)).toEqual({ aspect: 'unknown', label: 'loading' });
	});

	it('falls back to the neutral unknown aspect for an unrecognized / absent status', () => {
		expect(verdictFor('weird', verdictLabels)).toEqual({ aspect: 'unknown', label: 'unknown' });
		expect(verdictFor(null, verdictLabels)).toEqual({ aspect: 'unknown', label: 'unknown' });
		expect(verdictFor(undefined, verdictLabels)).toEqual({ aspect: 'unknown', label: 'unknown' });
	});
});

describe('pipelineNotesOf', () => {
	const threaded = { otp_definition: 'otp', cancellation: 'cancellation' };
	const labels = { network_no_data: 'Network no-data honesty', wilson_z: 'CI z-score' };

	it('iterates the FULL dict, dropping threaded keys and keeping every un-threaded string', () => {
		const p = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			methodology: {
				otp_definition: 'threaded — excluded',
				network_no_data: 'null not 0',
				wilson_z: 'z = 1.96',
				brand_new_key: 'a note with no explicit label',
			},
		} as unknown as Provenance;
		const notes = pipelineNotesOf(p, threaded, labels);
		const keys = notes.map((n) => n.key);
		expect(keys).toContain('network_no_data');
		expect(keys).toContain('wilson_z');
		// An UNKNOWN key still renders, humanized (never dropped).
		expect(keys).toContain('brand_new_key');
		// The threaded key is excluded.
		expect(keys).not.toContain('otp_definition');
		// A labelled key uses its label; an unlabelled one falls back to the humanized key.
		expect(notes.find((n) => n.key === 'network_no_data')?.label).toBe('Network no-data honesty');
		expect(notes.find((n) => n.key === 'brand_new_key')?.label).toBe('brand new key');
	});

	it('drops non-string and empty-string values, and returns [] when the dict is absent', () => {
		const p = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			methodology: { a: '', b: 42, c: '   ', d: 'kept' },
		} as unknown as Provenance;
		const notes = pipelineNotesOf(p, {}, {});
		expect(notes.map((n) => n.key)).toEqual(['d']);
		expect(pipelineNotesOf({ generated_utc: iso('x') } as unknown as Provenance, {}, {})).toEqual(
			[],
		);
	});
});

describe('retentionOf', () => {
	it('returns present day-counts and null for missing keys', () => {
		expect(
			retentionOf({
				generated_utc: iso('x'),
				retention: { detail_days: 14, aggregate_days: 365 },
			} as unknown as Provenance),
		).toEqual({ detail: 14, aggregate: 365 });
		expect(
			retentionOf({
				generated_utc: iso('x'),
				retention: { detail_days: 7 },
			} as unknown as Provenance),
		).toEqual({
			detail: 7,
			aggregate: null,
		});
		expect(retentionOf({ generated_utc: iso('x') } as unknown as Provenance)).toEqual({
			detail: null,
			aggregate: null,
		});
	});
});
