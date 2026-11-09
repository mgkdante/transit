import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MetricDisplay from './MetricDisplay.svelte';

const valueEl = (c: HTMLElement) => c.querySelector('.metric-value') as HTMLElement | null;

describe('MetricDisplay — absent value (honest no-data, never "·")', () => {
	for (const empty of [null, undefined, ''] as const) {
		it(`renders the typed shared absence for value=${JSON.stringify(empty)}`, () => {
			const { container, getByRole } = render(MetricDisplay, {
				props: {
					value: empty,
					absentReason: 'no-observations',
					locale: 'en',
					label: 'p90 delay',
				},
			});
			const absence = container.querySelector('[data-slot="absent-value"]');
			expect(absence).toBeInTheDocument();
			const trigger = getByRole('button', { name: 'No data, not enough readings yet' });
			expect(trigger).toHaveTextContent('No data');
			expect(trigger).not.toHaveTextContent('not enough readings yet');
			expect(trigger).toHaveAccessibleDescription('not enough readings yet');
			expect(valueEl(container)).toBeNull();
			expect(absence).toHaveAttribute('data-density', 'compact');
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
