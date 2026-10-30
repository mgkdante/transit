import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ReliabilityRailLayout from './ReliabilityRailLayout.svelte';
const snippet = (text: string) =>
	createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('ReliabilityRailLayout', () => {
	it('renders the named rail and puts the article summary before the content', () => {
		const { getByRole, getByText } = render(ReliabilityRailLayout, {
			props: {
				rail: snippet('Rail'),
				content: snippet('Content'),
				articleSummary: snippet('Reliability summary'),
				label: 'Reliability controls',
				openAria: 'Open controls',
				closeAria: 'Close controls',
			},
		});
		const rail = getByRole('complementary', { name: 'Reliability controls' });
		const summary = getByText('Reliability summary');
		const content = getByText('Content');

		expect(within(rail).getByText('Rail')).toBeInTheDocument();
		expect(
			summary.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});
