import { describe, it, expect } from 'vitest';
import { asDataState } from './data-state';
import type { Resource } from './resource.svelte';
import type { AbsenceReason } from '$lib/site/serviceWindow';

// A minimal Resource<T> stub (settled + idle by default).
function res<T>(p: Partial<Resource<T>>): Resource<T> {
	return { data: null, error: null, loading: false, settled: true, reload: () => {}, ...p };
}

describe('asDataState — the reason-typed load state', () => {
	it('ok narrows a present value to NonNullable on the data branch', () => {
		expect(asDataState(res<number[]>({ data: [1, 2] }))).toEqual({ kind: 'ok', data: [1, 2] });
	});

	it('reason-typed empty when a loaded value is isEmpty', () => {
		const reason: AbsenceReason = { key: 'closed-opens-at', firstDeparture: '06:00' };
		const s = asDataState(res<number[]>({ data: [] }), {
			isEmpty: (d) => d.length === 0,
			emptyReason: reason,
		});
		expect(s).toEqual({ kind: 'empty', reason });
	});

	it('no_results takes priority over isEmpty (a filter excluded everything)', () => {
		const s = asDataState(res<number[]>({ data: [] }), {
			isEmpty: (d) => d.length === 0,
			isNoResults: (d) => d.length === 0,
		});
		expect(s.kind).toBe('no_results');
	});

	it('error only when there is no value, carrying staleAt', () => {
		const s = asDataState(res<number>({ error: new Error('boom') }), {
			staleAt: '2026-06-22T16:00:00Z',
		});
		expect(s).toEqual({ kind: 'error', staleAt: '2026-06-22T16:00:00Z' });
	});

	it('loading before the first settle', () => {
		expect(asDataState(res<number>({ loading: true, settled: false })).kind).toBe('loading');
	});

	it('generic empty (reason null) when settled with no value', () => {
		expect(asDataState(res<number>({ settled: true }))).toEqual({ kind: 'empty', reason: null });
	});

	it('a present value wins over a stale error — shows data, not the error', () => {
		expect(asDataState(res<number>({ data: 42, error: new Error('reload failed') })).kind).toBe(
			'ok',
		);
	});
});
