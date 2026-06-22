// TrendLine.svelte.test.ts — the fixed-readout (#4) placement contract.
//
// The floating ChartTooltip overlapped the plotted lines. With `readout`, the
// hovered/focused values must read in a FIXED row ABOVE the plot instead, and
// the floating role=tooltip overlay must NOT be rendered over the data. The
// on-plot affordances (vertical guide, focus dots, per-index focus targets)
// stay. Keyboard focus updates the fixed readout (aria-describedby parity).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TrendLine from './TrendLine.svelte';

const onTime = [80, 82, 84];
const retard = [2.4, 2.1, 1.9];
const xLabels = ['2026-06-16', '2026-06-17', '2026-06-18'];

describe('TrendLine — fixed readout (#4)', () => {
	it('renders the fixed readout row, NOT a floating tooltip overlay, when readout', () => {
		const { container } = render(TrendLine, {
			props: {
				onTime,
				retard,
				xLabels,
				interactive: true,
				readout: true,
				readoutHint: 'Hover or tab the chart to read each day',
				yAxis: { label: 'On-time', unit: '%' },
				retardAxis: { label: 'Delay', unit: ' min' },
			},
		});
		// The fixed in-flow readout is present (with its hint before any hover).
		expect(container.querySelector('[data-slot="chart-readout"]')).not.toBeNull();
		expect(screen.getByText('Hover or tab the chart to read each day')).toBeInTheDocument();
		// The floating overlay (role=tooltip) is NOT rendered over the plot.
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
		expect(container.querySelector('[data-slot="chart-tooltip-wrap"]')).toBeNull();
	});

	it('updates the fixed readout when a per-index target receives keyboard focus', async () => {
		const { container } = render(TrendLine, {
			props: {
				onTime,
				retard,
				xLabels,
				interactive: true,
				readout: true,
				readoutHint: 'Hover the chart',
				yAxis: { label: 'On-time', unit: '%' },
				retardAxis: { label: 'Delay', unit: ' min' },
			},
		});
		// Focus the last x-index target → the readout reads that day's values.
		const targets = container.querySelectorAll('.dv-trendline-target');
		await fireEvent.focus(targets[targets.length - 1]);

		const readout = container.querySelector('[data-slot="chart-readout"]')!;
		expect(within(readout as HTMLElement).getByText('2026-06-18')).toBeInTheDocument();
		expect(within(readout as HTMLElement).getByText('84%')).toBeInTheDocument();
		expect(within(readout as HTMLElement).getByText('1.9 min')).toBeInTheDocument();
	});

	it('keeps the floating ChartTooltip path when readout is off (backward-compat)', () => {
		const { container } = render(TrendLine, {
			props: { onTime, retard, xLabels, interactive: true },
		});
		// No fixed readout; the floating overlay wrapper is present as before.
		expect(container.querySelector('[data-slot="chart-readout"]')).toBeNull();
		expect(container.querySelector('[data-slot="chart-tooltip-wrap"]')).not.toBeNull();
	});
});

describe('TrendLine — true time scale (the flat-trend fix)', () => {
	// Pull the x of each point out of the green on-time <path>'s `d`.
	function onTimeXs(container: HTMLElement): number[] {
		const path = container.querySelector<SVGPathElement>('path[stroke*="on-time"]');
		const d = path?.getAttribute('d') ?? '';
		return [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
	}

	// day0, day1, day10 — adjacent indices, very uneven calendar gaps.
	const times = ['2026-06-01', '2026-06-02', '2026-06-11'];

	it('spaces x by elapsed time when `times` is supplied (middle point hugs the left)', () => {
		const { container } = render(TrendLine, {
			props: { onTime, retard: [null, null, null], width: 100, times },
		});
		const xs = onTimeXs(container);
		expect(xs).toHaveLength(3);
		// day1 is 1/10 of the span → near the start, NOT the index midpoint.
		expect(xs[1] - xs[0]).toBeLessThan(xs[2] - xs[1]);
	});

	it('falls back to index spacing (byte-identical) without `times`', () => {
		const { container } = render(TrendLine, {
			props: { onTime, retard: [null, null, null], width: 100 },
		});
		const xs = onTimeXs(container);
		expect(xs).toHaveLength(3);
		// even index spacing → the middle gap equals the outer gap.
		expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 5);
	});
});
