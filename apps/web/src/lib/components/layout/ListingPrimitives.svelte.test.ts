import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import EntityResultRow from '$lib/components/surface/EntityResultRow.svelte';

const entityResultRowSource = readFileSync(
	resolve(process.cwd(), 'src/lib/components/surface/EntityResultRow.svelte'),
	'utf8',
);

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

	it('keeps the action in the far-right grid area when status is absent', () => {
		const { container, getByRole } = render(EntityResultRow, {
			props: { children: main, action },
		});

		const row = container.querySelector('[data-slot="entity-result-row"]');
		expect(row?.querySelector('[data-slot="entity-result-status"]')).toBeNull();
		expect(row?.querySelector('[data-slot="entity-result-action"]')).toContainElement(
			getByRole('link', { name: 'Map' }),
		);
		expect(entityResultRowSource).toMatch(/grid-template-areas:\s*'main status action'/);
		expect(entityResultRowSource).toMatch(/\.entity-result-action\s*\{[^}]*grid-area:\s*action;/s);
	});
});
