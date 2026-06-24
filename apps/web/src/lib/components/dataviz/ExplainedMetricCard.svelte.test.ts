// ExplainedMetricCard.svelte.test.ts — DOM gate for the slice-S6 wide 2-col card.
//
// Pins the operator's "top metric card" contract:
//   1. POPULATED — label + value in col1, the long explanation in col2, with the
//      caller's (i) affordance + an optional caveat note rendered in col1.
//   2. HONEST ABSENCE — a null value routes through the shared honest-absence
//      layer (AbsentValue), never a bare dot or a fabricated 0.

import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import ExplainedMetricCard from './ExplainedMetricCard.svelte';

describe('ExplainedMetricCard', () => {
	it('renders the label, value, and the explanation in its own column', () => {
		const { container } = render(ExplainedMetricCard, {
			props: {
				label: 'On-time %',
				value: '82%',
				explanation: 'The share of readings that landed on time.',
				locale: 'en',
			},
		});

		expect(screen.getByText('On-time %')).toBeInTheDocument();
		expect(screen.getByText('82%')).toBeInTheDocument();

		const card = container.querySelector('[data-slot="explained-metric-card"]');
		expect(card).not.toBeNull();

		const text = container.querySelector('[data-slot="explained-metric-text"]');
		expect(text).not.toBeNull();
		expect(text!.textContent).toContain('landed on time');
	});

	it('renders the caller-supplied (i) affordance inside col1 (the figure)', () => {
		const info = createRawSnippet(() => ({
			render: () => `<button data-testid="info-trigger">i</button>`,
		}));
		const { container } = render(ExplainedMetricCard, {
			props: {
				label: 'On-time %',
				value: '82%',
				explanation: 'x',
				info,
				locale: 'en',
			},
		});

		const slot = container.querySelector(
			'[data-slot="explained-metric-figure"] [data-slot="explained-metric-info"]',
		);
		expect(slot).not.toBeNull();
		expect(slot!.querySelector('[data-testid="info-trigger"]')).not.toBeNull();
	});

	it('renders an optional caveat note (e.g. ramp-in) under the figure', () => {
		const { container } = render(ExplainedMetricCard, {
			props: {
				label: 'Cancellation rate',
				value: '1.4%',
				explanation: 'x',
				note: 'Data accrues forward; no historical backfill.',
				locale: 'en',
			},
		});
		const note = container.querySelector('[data-slot="explained-metric-note"]');
		expect(note).not.toBeNull();
		expect(note!.textContent).toContain('no historical backfill');
	});

	it('routes a null value through the honest-absence layer with a reason', () => {
		const { container } = render(ExplainedMetricCard, {
			props: {
				label: 'Worst-case delay',
				value: null,
				explanation: '90th-percentile delay.',
				absentReason: 'no-observations',
				locale: 'en',
			},
		});
		// The styled honest-absence chip — never a fabricated 0 / bare dot.
		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(screen.queryByText('0')).not.toBeInTheDocument();
	});
});
