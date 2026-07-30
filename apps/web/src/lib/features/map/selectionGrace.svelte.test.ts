import { describe, expect, it } from 'vitest';

import { createSelectionGrace, type VehiclesFamilyTruth } from './selectionGrace.svelte';

type Detail = { id: string; label: string };

const selection = { kind: 'vehicle' as const, id: 'bus-1' };
const detail: Detail = { id: 'bus-1', label: 'Bus 1' };

function vehicles(overrides: Partial<VehiclesFamilyTruth> = {}): VehiclesFamilyTruth {
	return {
		phase: 'ready',
		retainedGeneration: '2026-07-30T12:00:00Z',
		consecutiveFailures: 0,
		error: null,
		successRevision: 1,
		...overrides,
	};
}

describe('selection grace', () => {
	it('retains the selected detail through exactly two omitted vehicle revisions, then closes on the third', () => {
		const grace = createSelectionGrace<Detail>();

		grace.update({ selection, resolvedDetail: detail, vehicles: vehicles() });
		expect(grace.state).toMatchObject({ presence: 'present', detail, omissionCount: 0 });

		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 2 }) });
		expect(grace.state).toMatchObject({ presence: 'missing-grace', detail, omissionCount: 1 });

		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 3 }) });
		expect(grace.state).toMatchObject({ presence: 'missing-grace', detail, omissionCount: 2 });

		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 4 }) });
		expect(grace.state).toMatchObject({ presence: 'gone', detail: null, omissionCount: 3 });
	});

	it('resets its revision baseline and retained detail when committed selection identity changes', () => {
		const grace = createSelectionGrace<Detail>();
		grace.update({ selection, resolvedDetail: detail, vehicles: vehicles() });
		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 2 }) });

		grace.update({
			selection: { kind: 'vehicle', id: 'bus-2' },
			resolvedDetail: { id: 'bus-2', label: 'Bus 2' },
			vehicles: vehicles({ successRevision: 2 }),
		});

		expect(grace.state).toMatchObject({
			presence: 'present',
			detail: { id: 'bus-2', label: 'Bus 2' },
			omissionCount: 0,
		});
	});

	it('resets omission grace when the selected vehicle reappears', () => {
		const grace = createSelectionGrace<Detail>();
		grace.update({ selection, resolvedDetail: detail, vehicles: vehicles() });
		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 2 }) });
		grace.update({ selection, resolvedDetail: detail, vehicles: vehicles({ successRevision: 3 }) });

		expect(grace.state).toMatchObject({ presence: 'present', detail, omissionCount: 0 });
	});

	it('does not count failures, aborts, or trigger-only recomputations without a new vehicle success revision', () => {
		const grace = createSelectionGrace<Detail>();
		grace.update({ selection, resolvedDetail: detail, vehicles: vehicles() });

		// Even a malformed failed response reporting a later revision, an aborted lifecycle
		// request, and refresh/visibility/online/static-publish triggers are not evidence
		// that the bus disappeared.
		grace.update({
			selection,
			resolvedDetail: null,
			vehicles: vehicles({
				phase: 'failed',
				consecutiveFailures: 1,
				error: new Error('500'),
				successRevision: 2,
			}),
		});
		grace.update({
			selection,
			resolvedDetail: null,
			vehicles: vehicles({ phase: 'loading' }),
		});
		grace.update({
			selection,
			resolvedDetail: null,
			vehicles: vehicles({ retainedGeneration: '2026-07-30T12:00:30Z' }),
		});

		expect(grace.state).toMatchObject({ presence: 'present', detail, omissionCount: 0 });

		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 2 }) });
		grace.update({ selection, resolvedDetail: null, vehicles: vehicles({ successRevision: 2 }) });
		expect(grace.state).toMatchObject({ presence: 'missing-grace', detail, omissionCount: 1 });
	});

	it('keeps retained data visible independently from retrying and failed source health', () => {
		const grace = createSelectionGrace<Detail>();
		grace.update({ selection, resolvedDetail: detail, vehicles: vehicles() });

		grace.update({
			selection,
			resolvedDetail: null,
			vehicles: vehicles({ phase: 'loading', consecutiveFailures: 1, error: new Error('retry') }),
		});
		expect(grace.state).toMatchObject({ presence: 'present', detail, sourceHealth: 'retrying' });

		grace.update({
			selection,
			resolvedDetail: null,
			vehicles: vehicles({ phase: 'failed', consecutiveFailures: 2, error: new Error('failed') }),
		});
		expect(grace.state).toMatchObject({ presence: 'present', detail, sourceHealth: 'failed' });
	});
});
