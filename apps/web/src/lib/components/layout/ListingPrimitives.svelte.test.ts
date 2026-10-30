import { createRawSnippet } from 'svelte';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import EntityResultRow from '$lib/components/surface/EntityResultRow.svelte';

const main = createRawSnippet(() => ({
	render: () => '<a href="/lines/24">24 Sherbrooke</a>',
}));

const status = createRawSnippet(() => ({
	render: () => '<span>94%</span>',
}));

const action = createRawSnippet(() => ({
	render: () => '<a href="/map?route=24">Map</a>',
}));

describe('shared listing primitives', () => {
	it('owns one row grid for the entity, status, and far-right action', () => {
		const { container, getByRole } = render(EntityResultRow, {
			props: { children: main, status, action, class: 'line-result' },
		});

		const row = container.querySelector('[data-slot="entity-result-row"]');
		expect(row).toHaveClass('entity-result-row', 'line-result');
		expect(row?.querySelector('[data-slot="entity-result-main"]')).toContainElement(
			getByRole('link', { name: '24 Sherbrooke' }),
		);
		expect(row?.querySelector('[data-slot="entity-result-status"]')).toHaveTextContent('94%');
		expect(row?.lastElementChild).toContainElement(getByRole('link', { name: 'Map' }));
	});
});
