import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { ListingFilterPanel, ListingFilterSection, ListingSearchField } from './index';

const children = createRawSnippet(() => ({
	render: () => '<div data-testid="filter-groups">Filter groups</div>',
}));

describe('ListingSearchField', () => {
	it('matches the yesid.dev Blog/Projects search treatment with an accessible real icon field', async () => {
		const { container } = render(ListingSearchField, {
			props: {
				value: 'metro',
				label: 'Search lines',
				placeholder: 'Route, mode, or destination',
				testId: 'line-search',
			},
		});

		const root = container.querySelector('[data-slot="listing-search-field"]');
		const input = screen.getByRole('textbox', { name: 'Search lines' });
		const icon = root?.querySelector('svg.lucide-search');

		expect(root).toHaveClass('pt-3', 'mb-6', 'pb-5', 'divider-dashed');
		expect(input).toHaveAttribute('placeholder', 'Route, mode, or destination');
		expect(input).toHaveAttribute('data-testid', 'line-search');
		expect(input).toHaveAttribute('name', 'line-search');
		expect(input).toHaveClass(
			'rounded-lg',
			'border-[var(--input)]',
			'bg-[var(--card)]',
			'px-4',
			'py-3.5',
			'min-h-11',
			'pl-10',
			'font-mono',
			'text-sm',
			'focus:border-[var(--primary)]',
		);
		expect(icon).toBeInTheDocument();
		expect(icon).toHaveAttribute('aria-hidden', 'true');
		expect(icon).toHaveClass('left-3');
		expect(icon).toHaveAttribute('width', '16');
		expect(icon).toHaveAttribute('stroke-width', '1.5');

		await fireEvent.input(input, { target: { value: 'bus' } });
		expect(input).toHaveValue('bus');
	});
});

describe('ListingFilterSection', () => {
	it('provides the exact shared dashed top and spacing wrapper for a filter group', () => {
		const { container } = render(ListingFilterSection, { props: { children } });

		const section = container.querySelector('[data-slot="listing-filter-section"]');
		expect(section).toHaveClass('mt-5', 'divider-dashed', 'pt-3');
		expect(section).toContainElement(screen.getByTestId('filter-groups'));
	});
});

describe('ListingFilterPanel', () => {
	it('keeps the source-parity search visible before the reusable filter groups', () => {
		const { container } = render(ListingFilterPanel, {
			props: {
				children,
				searchValue: '24',
				searchLabel: 'Search lines',
				searchPlaceholder: 'Filter lines',
				searchTestId: 'listing-search',
				testId: 'line-filter-panel',
			},
		});

		const panel = screen.getByTestId('line-filter-panel');
		const search = screen.getByTestId('listing-search');
		const groups = screen.getByTestId('filter-groups');

		expect(panel.tagName.toLowerCase()).toBe('div');
		expect(panel).not.toHaveClass('glass-chrome', 'bg-[var(--card)]');
		expect(container.querySelectorAll('[data-slot="listing-search-field"]')).toHaveLength(1);
		expect(search).toHaveValue('24');
		expect(search.compareDocumentPosition(groups)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('can omit search without hiding its filter groups', () => {
		render(ListingFilterPanel, {
			props: {
				children,
				showSearch: false,
				searchLabel: 'Search lines',
				searchPlaceholder: 'Filter lines',
			},
		});

		expect(screen.queryByRole('textbox', { name: 'Search lines' })).not.toBeInTheDocument();
		expect(screen.getByTestId('filter-groups')).toBeInTheDocument();
	});
});
