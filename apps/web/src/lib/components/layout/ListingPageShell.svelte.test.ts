import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListingPageShell from './ListingPageShell.svelte';

const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('$lib/nav', () => ({
	isDesktopViewport: () => viewport.desktop,
	layout: {
		get isDesktop() {
			return viewport.desktop;
		},
	},
}));

const header = createRawSnippet(() => ({
	render: () => '<header data-testid="header">Header</header>',
}));
const filters = createRawSnippet(() => ({
	render: () =>
		'<div data-testid="filter-controls"><input aria-label="Filter query"><button type="button">Apply filters</button></div>',
}));
const search = createRawSnippet(() => ({
	render: () => '<input data-testid="listing-search" aria-label="Search the catalogue">',
}));
const children = createRawSnippet(() => ({
	render: () => '<div data-testid="listing-results">Results</div>',
}));

const src = readFileSync(
	join(process.cwd(), 'src/lib/components/layout/ListingPageShell.svelte'),
	'utf8',
);

beforeEach(() => {
	viewport.desktop = false;
});

describe('ListingPageShell', () => {
	it('matches the Blog/Projects edge-title, hazard, filter-rail, and content order', () => {
		const { container } = render(ListingPageShell, {
			props: {
				heading: 'Lines',
				filterLabel: 'Filters',
				header,
				filters,
				children,
			},
		});

		const shell = container.querySelector('[data-slot="listing-page-shell"]');
		const edgeTitle = shell?.querySelector('[data-slot="listing-edge-title"]');
		const separator = shell?.querySelector('[data-testid="listing-page-separator"]');
		const rail = shell?.querySelector('[data-slot="listing-filter-column"]');
		const results = screen.getByTestId('listing-results');

		expect(edgeTitle).toHaveTextContent('Lines.');
		expect(shell?.querySelector('[data-slot="listing-accent-rail"]')).not.toBeNull();
		expect(separator).not.toBeNull();
		expect(rail?.tagName.toLowerCase()).toBe('aside');
		expect(screen.getAllByTestId('filter-controls')).toHaveLength(1);
		expect(separator?.compareDocumentPosition(rail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(rail?.compareDocumentPosition(results)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('keeps search immediately visible while secondary filters use one mobile disclosure', async () => {
		const { container } = render(ListingPageShell, {
			props: {
				heading: 'Stops',
				filterLabel: 'Filters',
				header,
				search,
				filters,
				children,
			},
		});

		const toggle = screen.getByRole('button', { name: 'Filters' });
		const searchField = screen.getByRole('textbox', { name: 'Search the catalogue' });
		const filterBody = container.querySelector('[data-slot="listing-filter-body"]');

		expect(searchField).toBeVisible();
		expect(searchField.compareDocumentPosition(filterBody as Node)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(filterBody).toHaveAttribute('data-state', 'open');
		expect(screen.getAllByRole('textbox', { name: 'Filter query' })).toHaveLength(1);
	});

	it('keeps the mobile disclosure in flow between search and results like Blog and Projects', async () => {
		const { container } = render(ListingPageShell, {
			props: {
				heading: 'Lines',
				filterLabel: 'Filters',
				header,
				search,
				filters,
				children,
			},
		});

		const toggle = screen.getByRole('button', { name: 'Filters' });
		const searchField = screen.getByRole('textbox', { name: 'Search the catalogue' });
		const results = screen.getByTestId('listing-results');
		expect(toggle).toHaveAttribute('data-slot', 'listing-filter-toggle');
		expect(searchField.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(toggle.compareDocumentPosition(results)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(container.querySelector('[data-slot="listing-filter-backdrop"]')).toBeNull();

		await fireEvent.click(toggle);
		expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
		expect(document.body.style.overflow).not.toBe('hidden');

		const mobileToggleRule = src.match(/\.mobile-filter-toggle\s*\{(?<body>[\s\S]*?)\n\s*\}/);
		expect(mobileToggleRule?.groups?.body).toMatch(/width:\s*100%/);
		expect(mobileToggleRule?.groups?.body).not.toMatch(/position:\s*fixed|bottom:/);
	});

	it('removes closed in-flow filters from keyboard navigation and restores them when open', async () => {
		const { container } = render(ListingPageShell, {
			props: {
				heading: 'Lines',
				filterLabel: 'Filters',
				header,
				filters,
				children,
			},
		});

		const toggle = screen.getByRole('button', { name: 'Filters' });
		const filterInput = screen.getByRole('textbox', { name: 'Filter query', hidden: true });
		expect(filterInput.closest('[inert]')).not.toBeNull();

		await fireEvent.click(toggle);
		expect(filterInput.closest('[inert]')).toBeNull();
		expect(container.querySelector('[data-slot="listing-filter-body"]')).toHaveAttribute(
			'data-state',
			'open',
		);
	});

	it('keeps the visible desktop filter rail open and interactive', () => {
		viewport.desktop = true;
		const { container } = render(ListingPageShell, {
			props: {
				heading: 'Lines',
				filterLabel: 'Filters',
				header,
				filters,
				children,
			},
		});
		const body = container.querySelector('[data-slot="listing-filter-body"]');

		expect(body).toHaveAttribute('data-state', 'open');
		expect(body).not.toHaveAttribute('inert');
		expect(body).not.toHaveAttribute('aria-hidden');
		expect(screen.getByRole('textbox', { name: 'Filter query' })).toBeInTheDocument();
		expect(body).not.toHaveAttribute('role');
		expect(body).not.toHaveAttribute('aria-modal');
	});

	it('uses the shared wider control-rail token only at the desktop breakpoint', () => {
		const desktopCss = src.slice(src.indexOf('@media (min-width: 1024px)'));

		expect(src).toMatch(/\.listing-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
		expect(desktopCss).toMatch(
			/\.listing-grid\s*\{[\s\S]*?grid-template-columns:\s*var\(--layout-control-rail-width\)\s+minmax\(0,\s*1fr\)/,
		);
		expect(desktopCss).toMatch(
			/\.listing-filter-shell\s*\{[^}]*margin-top:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;/s,
		);
	});
});
