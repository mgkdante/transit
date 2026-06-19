// ChartReadout.svelte.test.ts — the fixed-placement chart readout contract.
//
// ChartReadout is the in-flow counterpart to ChartTooltip used by the line/area
// charts (TrendLine / Sparkline) so the hovered values read in a FIXED row above
// the plot, never over the data. Its non-negotiables:
//   1. closed → renders the placeholder hint (and reserves space), no rows.
//   2. open → renders the heading + each row (swatch + label + value).
//   3. it is an aria-live status region carrying the controller id (so focus
//      targets can aria-describedby it) — not a floating role=tooltip overlay.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ChartReadout from './ChartReadout.svelte';

describe('ChartReadout — closed', () => {
	it('renders the placeholder hint and no value rows when nothing is hovered', () => {
		const { container } = render(ChartReadout, {
			props: {
				open: false,
				rows: [{ label: 'On-time', value: '82%' }],
				id: 'chart-tooltip-test',
				placeholder: 'Hover or tab the chart to read each day',
			},
		});
		expect(screen.getByText('Hover or tab the chart to read each day')).toBeInTheDocument();
		// No value rows are shown while closed.
		expect(container.querySelector('.chart-readout__rows')).toBeNull();
		expect(screen.queryByText('82%')).not.toBeInTheDocument();
	});
});

describe('ChartReadout — open', () => {
	it('renders the heading + each series row with its value', () => {
		render(ChartReadout, {
			props: {
				open: true,
				heading: '2026-06-18',
				rows: [
					{ colorVar: 'var(--dataviz-status-on-time)', label: 'On-time', value: '82%' },
					{ colorVar: 'var(--dataviz-status-late)', label: 'Delay', value: '2.1 min' },
				],
				id: 'chart-tooltip-test',
				placeholder: 'Hover the chart',
			},
		});
		expect(screen.getByText('2026-06-18')).toBeInTheDocument();
		expect(screen.getByText('On-time')).toBeInTheDocument();
		expect(screen.getByText('82%')).toBeInTheDocument();
		expect(screen.getByText('Delay')).toBeInTheDocument();
		expect(screen.getByText('2.1 min')).toBeInTheDocument();
		// The placeholder is suppressed once content is shown.
		expect(screen.queryByText('Hover the chart')).not.toBeInTheDocument();
	});

	it('is an aria-live status region carrying the controller id', () => {
		const { container } = render(ChartReadout, {
			props: {
				open: true,
				heading: '2026-06-18',
				rows: [{ label: 'On-time', value: '82%' }],
				id: 'chart-tooltip-42',
			},
		});
		const block = container.querySelector('[data-slot="chart-readout"]');
		expect(block).not.toBeNull();
		expect(block).toHaveAttribute('role', 'status');
		expect(block).toHaveAttribute('aria-live', 'polite');
		// The id mirrors the controller id so focus targets can aria-describedby it.
		expect(block).toHaveAttribute('id', 'chart-tooltip-42');
	});
});
