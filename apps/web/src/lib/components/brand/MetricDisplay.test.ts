// MetricDisplay.test.ts — the big-number stat primitive, DOM gate.
//
// Doctrine: the metric VALUE speaks the amber wayfinding voice (.metric-value /
// text-accent-text); an ABSENT value routes through the shared AbsentValue chassis
// with typed bilingual copy — never a local string and never a fabricated 0.
//
// Gates:
//   - a real value renders in the amber .metric-value voice.
//   - a null / undefined / "" value renders canonical short + why copy.
//   - an empty value with no typed reason renders nothing (no empty amber span).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MetricDisplay from './MetricDisplay.svelte';

const valueEl = (c: HTMLElement) => c.querySelector('.metric-value') as HTMLElement | null;
it('does not expose a feature-copy bypass around the shared absence vocabulary', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/components/brand/MetricDisplay.svelte'),
		'utf8',
	);
	expect(source).not.toMatch(/\bemptyLabel\b/);
});

describe('MetricDisplay — present value (amber voice)', () => {
	it('renders the value in the .metric-value voice and no empty label', () => {
		const { container, getByText } = render(MetricDisplay, {
			props: { value: '82%', label: 'On-time' },
		});
		expect(getByText('82%')).toBeInTheDocument();
		expect(valueEl(container)).not.toBeNull();
		expect(valueEl(container)).toHaveClass('text-accent-text');
		expect(container.querySelector('[data-slot="absent-value"]')).toBeNull();
	});
});

describe('MetricDisplay — absent value (honest no-data, never "·")', () => {
	for (const empty of [null, undefined, ''] as const) {
		it(`renders the typed shared absence for value=${JSON.stringify(empty)}`, () => {
			const { container, getByText } = render(MetricDisplay, {
				props: {
					value: empty,
					absentReason: 'no-observations',
					locale: 'en',
					label: 'p90 delay',
				},
			});
			const absence = container.querySelector('[data-slot="absent-value"]');
			expect(absence).toBeInTheDocument();
			expect(getByText('No data')).toBeInTheDocument();
			expect(getByText('not enough readings yet')).toBeInTheDocument();
			expect(valueEl(container)).toBeNull();
			expect(absence).toHaveAttribute('data-density', 'chip');
		});
	}

	it('renders nothing for the value when no typed reason is supplied', () => {
		const { container } = render(MetricDisplay, {
			props: { value: null, label: 'p90 delay' },
		});
		expect(valueEl(container)).toBeNull();
		expect(container.querySelector('[data-slot="absent-value"]')).toBeNull();
	});
});
