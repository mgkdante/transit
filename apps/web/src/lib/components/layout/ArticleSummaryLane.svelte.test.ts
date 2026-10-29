import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ArticleSummaryLane from './ArticleSummaryLane.svelte';

const summary = createRawSnippet(() => ({
	render: () => '<p data-testid="summary-copy">Reliability summary</p>',
}));

describe('ArticleSummaryLane', () => {
	it('renders one reusable lane and forwards attributes', () => {
		const { container, getByTestId } = render(ArticleSummaryLane, {
			props: { children: summary, class: 'route-summary', 'data-owner': 'route' },
		});
		const lane = container.querySelector('[data-slot="article-summary-lane"]');

		expect(lane).toHaveClass('article-summary-lane', 'route-summary');
		expect(lane).toHaveAttribute('data-owner', 'route');
		expect(getByTestId('summary-copy')).toHaveTextContent('Reliability summary');
	});
});
