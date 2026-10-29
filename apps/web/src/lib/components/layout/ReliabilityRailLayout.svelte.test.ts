import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ReliabilityRailLayout from './ReliabilityRailLayout.svelte';
const snippet = (text: string) =>
	createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('ReliabilityRailLayout — shared detail geometry contract', () => {
	it('places the same centered article summary at the top of content while the rail starts level', () => {
		const { container, getByRole } = render(ReliabilityRailLayout, {
			props: {
				rail: snippet('Rail'),
				content: snippet('Content'),
				articleSummary: snippet('Reliability summary'),
				label: 'Reliability controls',
				openAria: 'Open controls',
				closeAria: 'Close controls',
			},
		});
		const layout = container.querySelector('[data-slot="reliability-rail-layout"]');
		const rail = getByRole('complementary', { name: 'Reliability controls' });
		const content = container.querySelector('[data-slot="reliability-rail-content"]');
		const summary = container.querySelector('[data-slot="reliability-rail-summary"]');

		expect(rail?.parentElement).toBe(layout);
		expect(content?.parentElement).toBe(layout);
		expect(summary?.closest('[data-slot="reliability-rail-content"]')).toBe(content);
		expect(content?.firstElementChild).toBe(summary);
		expect(summary).toHaveTextContent('Reliability summary');
	});
});
