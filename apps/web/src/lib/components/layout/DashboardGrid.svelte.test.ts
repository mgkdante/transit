// DashboardGrid.svelte.test.ts — DOM gate for the auto-fit KPI tile field.
//
// Guards the `align` contract introduced for the /network readout board: the
// grid defaults to `stretch` (equal-height cells, so the home explore/pillar
// boards are unchanged) and honors align="start" so a tile-by-tile readout takes
// its natural height (no elongation). The alignment rides the --board-align
// custom prop on the inline style (the same pattern as --min-tile / --board-max),
// which the scoped CSS maps onto `align-items`.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DashboardGrid from './DashboardGrid.svelte';

const tiles = createRawSnippet(() => ({
	// createRawSnippet renders one root node, so wrap the tiles in a fragment div.
	render: () => `<div><span data-testid="tile-a">A</span><span data-testid="tile-b">B</span></div>`,
}));

const gridEl = (container: HTMLElement) =>
	container.querySelector('[data-slot="dashboard-grid"]') as HTMLElement;

describe('DashboardGrid align', () => {
	it('defaults to stretch (equal-height cells) when align is unset', () => {
		const { container } = render(DashboardGrid, { props: { children: tiles } });
		// The default keeps every existing consumer on equal-height stretch.
		expect(gridEl(container).getAttribute('style')).toContain('--board-align: stretch');
	});

	it('sets align-items:start via --board-align when align="start"', () => {
		const { container } = render(DashboardGrid, {
			props: { children: tiles, align: 'start' },
		});
		// align="start" lets tiles take their natural height (no elongation).
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
