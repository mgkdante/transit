// MetricDisplay.test.ts — the big-number stat primitive, DOM gate.
//
// Doctrine: the metric VALUE speaks the amber wayfinding voice (.metric-value /
// text-accent-text); an ABSENT value speaks the QUIET muted-mono no-data voice
// (.metric-empty) — never a bare "·" and never a fabricated 0.
//
// Gates:
//   - a real value renders in the amber .metric-value voice.
//   - a null / undefined / "" value renders the muted .metric-empty label
//     (NOT the amber voice, NOT a "·"), and only when an emptyLabel is given.
//   - an empty value with no emptyLabel renders nothing (no empty amber span).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MetricDisplay from './MetricDisplay.svelte';

const valueEl = (c: HTMLElement) => c.querySelector('.metric-value') as HTMLElement | null;
const emptyEl = (c: HTMLElement) =>
	c.querySelector('[data-slot="metric-empty"]') as HTMLElement | null;

describe('MetricDisplay — present value (amber voice)', () => {
	it('renders the value in the .metric-value voice and no empty label', () => {
		const { container, getByText } = render(MetricDisplay, {
			props: { value: '82%', label: 'On-time' },
		});
		expect(getByText('82%')).toBeInTheDocument();
		expect(valueEl(container)).not.toBeNull();
		expect(valueEl(container)).toHaveClass('text-accent-text');
		expect(emptyEl(container)).toBeNull();
	});
});

describe('MetricDisplay — absent value (honest no-data, never "·")', () => {
	for (const empty of [null, undefined, ''] as const) {
		it(`renders the muted emptyLabel (not the amber voice) for value=${JSON.stringify(empty)}`, () => {
			const { container, getByText } = render(MetricDisplay, {
				props: { value: empty, emptyLabel: 'no data', label: 'p90 delay' },
			});
			// The muted no-data label is shown.
			const note = getByText('no data');
			expect(note).toBeInTheDocument();
			expect(note).toHaveClass('metric-empty');
			// It is NOT the amber metric-value voice.
			expect(valueEl(container)).toBeNull();
			// And NEVER a bare middot sentinel.
			expect(container.textContent).not.toContain('·');
		});
	}

	it('renders nothing for the value when both value and emptyLabel are empty', () => {
		const { container } = render(MetricDisplay, {
			props: { value: null, emptyLabel: '', label: 'p90 delay' },
		});
		// No amber value, no empty label span — the label still renders.
		expect(valueEl(container)).toBeNull();
		expect(emptyEl(container)).toBeNull();
		expect(container.textContent).not.toContain('·');
	});
});
