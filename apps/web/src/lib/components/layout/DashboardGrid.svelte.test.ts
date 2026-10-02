import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DashboardGrid from './DashboardGrid.svelte';

const tiles = createRawSnippet(() => ({
	render: () => `<div><span data-testid="tile-a">A</span><span data-testid="tile-b">B</span></div>`,
}));

const gridEl = (container: HTMLElement) =>
	container.querySelector('[data-slot="dashboard-grid"]') as HTMLElement;

describe('DashboardGrid align', () => {
	it('defaults to stretch (equal-height cells) when align is unset', () => {
		const { container } = render(DashboardGrid, { props: { children: tiles } });
		expect(gridEl(container).getAttribute('style')).toContain('--board-align: stretch');
	});

	it('sets align-items:start via --board-align when align="start"', () => {
		const { container } = render(DashboardGrid, {
			props: { children: tiles, align: 'start' },
		});
		expect(gridEl(container).getAttribute('style')).toContain('--board-align: start');
	});

	it('renders the caller tiles regardless of alignment', () => {
		const { getByTestId } = render(DashboardGrid, {
			props: { children: tiles, align: 'start' },
		});
		expect(getByTestId('tile-a')).toBeTruthy();
		expect(getByTestId('tile-b')).toBeTruthy();
	});
});
