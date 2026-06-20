// Sparkline.svelte.test.ts — the fixed-readout (#4) placement contract.
//
// The floating ChartTooltip overlapped the spark line. With `readout`, the
// hovered/focused value reads in a FIXED row ABOVE the spark, and the floating
// role=tooltip overlay is NOT rendered over the line. The hover/focus dot and
// the per-point focus targets stay. The labelled role=img container + its
// data-slot="sparkline" + the data-mark stroke token all survive the relayout.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Sparkline from './Sparkline.svelte';

const values = [1.2, 1.5, 1.1];
const xLabels = ['2026-06-16', '2026-06-17', '2026-06-18'];

describe('Sparkline — fixed readout (#4)', () => {
	it('renders the fixed readout row, NOT a floating tooltip overlay, when readout', () => {
		const { container } = render(Sparkline, {
			props: {
				values,
				xLabels,
				interactive: true,
				readout: true,
				readoutHint: 'Hover the spark',
				colorVar: 'var(--dataviz-status-late)',
				yAxis: { label: 'Cancellation rate', unit: '%' },
			},
		});
		expect(container.querySelector('[data-slot="chart-readout"]')).not.toBeNull();
		expect(screen.getByText('Hover the spark')).toBeInTheDocument();
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
		expect(container.querySelector('[data-slot="chart-tooltip-wrap"]')).toBeNull();
		// The labelled container + the data-mark stroke survive the relayout.
		expect(container.querySelector('[data-slot="sparkline"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="sparkline"] path')?.getAttribute('stroke')).toBe(
			'var(--dataviz-status-late)',
		);
	});

	it('updates the fixed readout when a point target receives keyboard focus', async () => {
		const { container } = render(Sparkline, {
			props: {
				values,
				xLabels,
				interactive: true,
				readout: true,
				readoutHint: 'Hover the spark',
				yAxis: { label: 'Cancellation rate', unit: '%' },
			},
		});
		const targets = container.querySelectorAll('.dv-sparkline-target');
		await fireEvent.focus(targets[targets.length - 1]);

		const readout = container.querySelector('[data-slot="chart-readout"]')!;
		expect(within(readout as HTMLElement).getByText('2026-06-18')).toBeInTheDocument();
		expect(within(readout as HTMLElement).getByText('1.1%')).toBeInTheDocument();
	});

	it('keeps the floating ChartTooltip path when readout is off (backward-compat)', () => {
		const { container } = render(Sparkline, {
			props: { values, xLabels, interactive: true },
		});
		expect(container.querySelector('[data-slot="chart-readout"]')).toBeNull();
		expect(container.querySelector('[data-slot="chart-tooltip-wrap"]')).not.toBeNull();
	});
});
