import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ArticleSummaryLane from './ArticleSummaryLane.svelte';

const componentPath = resolve(process.cwd(), 'src/lib/components/layout/ArticleSummaryLane.svelte');
const barrelPath = resolve(process.cwd(), 'src/lib/components/layout/index.ts');

const summary = createRawSnippet(() => ({
	render: () => '<p data-testid="summary-copy">Reliability summary</p>',
}));

describe('ArticleSummaryLane', () => {
	it('ships as the one centered summary primitive through the layout barrel', () => {
		const source = readFileSync(componentPath, 'utf-8');
		const barrel = readFileSync(barrelPath, 'utf-8');

		expect(barrel).toContain(
			"export { default as ArticleSummaryLane } from './ArticleSummaryLane.svelte';",
		);
		expect(source).toMatch(/\.article-summary-lane\s*\{[^}]*display:\s*flex;/s);
		expect(source).toMatch(/\.article-summary-lane\s*\{[^}]*justify-content:\s*center;/s);
		expect(source).toMatch(
			/\.article-summary-lane\s*\{[^}]*margin-block-end:\s*var\(--space-card-gap\);/s,
		);
		expect(source).toMatch(/\.article-summary-lane__content\s*\{[^}]*text-align:\s*center;/s);
	});

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
