import { render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet, type Component, type Snippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import EntityList from './EntityList.svelte';

interface StringEntityListProps {
	items: readonly string[];
	key: (item: string) => string;
	row: Snippet<[string]>;
	cards?: boolean;
	grid?: boolean;
	minTile?: string;
	max?: number;
	truncatedLabel?: string;
}

const StringEntityList = EntityList as unknown as Component<StringEntityListProps>;

const rows = ['Green line', 'Orange line'];
const row = createRawSnippet<[string]>((getItem) => ({
	render: () => `<span>${getItem()}</span>`,
}));
const key = (item: string) => item;
const source = readFileSync(
	resolve(process.cwd(), 'src/lib/components/surface/EntityList.svelte'),
	'utf8',
);

describe('EntityList cards presentation', () => {
	it('wraps every semantic list item in the shared non-interactive Card chassis', () => {
		render(StringEntityList, { props: { items: rows, key, row, cards: true } });

		const list = screen.getByRole('list');
		const items = within(list).getAllByRole('listitem');
		expect(list.tagName).toBe('UL');
		expect(list).toHaveClass('entity-list--cards');
		expect(items).toHaveLength(2);
		for (const item of items) {
			const card = item.querySelector('[data-slot="card"]');
			expect(card).not.toBeNull();
			expect(card).toHaveClass('entity-list-card');
			expect(card).not.toHaveAttribute('data-interactive');
		}
	});

	it('keeps the DashboardGrid semantic ul and its grid contract in cards mode', () => {
		render(StringEntityList, {
			props: { items: rows, key, row, cards: true, grid: true, minTile: '360px' },
		});

		const list = screen.getByRole('list');
		expect(list).toHaveClass('dashboard-grid', 'entity-list--grid', 'entity-list--cards');
		expect(list).toHaveStyle('--min-tile: 360px');
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
	});

	it('uses the Yesid listing frame without changing the default row presentation', () => {
		const { rerender } = render(StringEntityList, {
			props: { items: rows, key, row },
		});

		expect(screen.getByRole('list')).not.toHaveClass('entity-list--cards');
		expect(document.querySelector('[data-slot="card"]')).toBeNull();

		rerender({ items: rows, key, row, cards: true });
		expect(source).toMatch(
			/:global\(\.card-surface\.entity-list-card\)\s*\{[^}]*border-width:\s*3px;/s,
		);
	});

	it('keeps a truncated-result notice available to assistive technology', () => {
		render(StringEntityList, {
			props: {
				items: [...rows, 'Blue line'],
				key,
				row,
				max: 2,
				truncatedLabel: '1 more result — refine your search',
			},
		});

		const notice = screen.getByText('1 more result — refine your search');
		expect(notice).toHaveClass('entity-list-more');
		expect(notice).not.toHaveAttribute('aria-hidden');
	});
});
