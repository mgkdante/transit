import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ArticleSectionStack from './ArticleSectionStack.svelte';
import ArticleSectionStackHarness from './__fixtures__/ArticleSectionStackHarness.svelte';

const section = createRawSnippet(() => ({
	render: () =>
		'<div data-slot="card" class="section-card" data-testid="section-card">Section</div>',
}));

describe('ArticleSectionStack', () => {
	it('renders only the supplied section snippet and forwards a custom class', () => {
		const { container, getByTestId } = render(ArticleSectionStack, {
			props: { class: 'route-sections', children: section },
		});
		const stack = container.querySelector('[data-slot="article-section-stack"]');

		expect(stack).toHaveClass('article-section-stack', 'route-sections');
		expect(stack?.children).toHaveLength(1);
		expect(getByTestId('section-card')).toHaveTextContent('Section');
		expect(stack?.querySelector('[data-slot="separator"]')).toBeNull();
	});

	it('lays out direct cards and generic wrappers without inserting separators', () => {
		const { container, getByTestId } = render(ArticleSectionStackHarness);
		const stack = container.querySelector('[data-slot="article-section-stack"]');

		expect(stack).toHaveClass('fixture-stack');
		expect(stack?.children).toHaveLength(4);
		expect(getByTestId('section-wrapper').firstElementChild).toBe(getByTestId('section-card'));
		expect(getByTestId('anchor-wrapper').firstElementChild).toBe(getByTestId('anchor-card'));
		expect(getByTestId('component-root').firstElementChild).toBe(getByTestId('component-card'));
		expect(stack?.querySelector('[data-slot="separator"]')).toBeNull();
	});
});
