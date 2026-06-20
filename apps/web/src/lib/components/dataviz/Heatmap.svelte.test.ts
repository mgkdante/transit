// Heatmap.svelte.test.ts — DOM gate for the day×hour heatmap primitive.
//
// Guards both the legacy default geometry (so the byte-compatible call sites
// stay unchanged) AND the layperson affordances added in slice-9.6: configurable
// hour ticks + clock labels, axis captions, a value formatter / no-data text,
// and the roving-tabindex keyboard contract.

import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Heatmap from './Heatmap.svelte';

/** A 7×24 grid with one real cell (Mon 08:00) and the rest null (no data). */
function sparseGrid(): (number | null)[][] {
	const grid: (number | null)[][] = Array.from({ length: 7 }, () =>
		Array.from({ length: 24 }, () => null),
	);
	grid[0][8] = 0.9;
	return grid;
}

describe('Heatmap — default geometry (byte-compat)', () => {
	it('renders the legacy 0/6/12/18 hour ticks and no axis captions', () => {
		const { container } = render(Heatmap, {
			props: { grid: sparseGrid(), label: 'Delay heatmap' },
		});
		const ticks = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
		expect(ticks).toEqual(expect.arrayContaining(['00', '06', '12', '18']));
		// No clock suffix, no caption text in the default configuration.
		expect(ticks).not.toContain('00:00');
		expect(ticks).not.toContain('Hour of day');
	});
});

describe('Heatmap — layperson affordances', () => {
	it('renders configurable clock-style hour ticks', () => {
		const { container } = render(Heatmap, {
			props: { grid: sparseGrid(), hourTicks: [0, 3, 6, 9], clockTicks: true },
		});
		const ticks = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
		expect(ticks).toEqual(expect.arrayContaining(['00:00', '03:00', '06:00', '09:00']));
	});

	it('renders the X/Y axis captions and grows the viewBox geometry', () => {
		const def = render(Heatmap, { props: { grid: sparseGrid() } });
		const defBox = def.container.querySelector('svg')?.getAttribute('viewBox');

		const withAxes = render(Heatmap, {
			props: { grid: sparseGrid(), hourAxisLabel: 'Hour of day', dayAxisLabel: 'Day of week' },
		});
		const texts = Array.from(withAxes.container.querySelectorAll('text')).map((t) => t.textContent);
		expect(texts).toContain('Hour of day');
		expect(texts).toContain('Day of week');

		// Captions grow the gutters → the viewBox differs from the default.
		const axesBox = withAxes.container.querySelector('svg')?.getAttribute('viewBox');
		expect(axesBox).not.toBe(defBox);
	});

	it('drives the <title> with valueFormat + noDataText', () => {
		const { container } = render(Heatmap, {
			props: {
				grid: sparseGrid(),
				interactive: true,
				fullDayLabels: [
					'Monday',
					'Tuesday',
					'Wednesday',
					'Thursday',
					'Friday',
					'Saturday',
					'Sunday',
				],
				noDataText: 'No data',
				valueFormat: (v: number | null) => (v == null ? 'No data' : 'High'),
			},
		});
		const cells = Array.from(container.querySelectorAll('rect[role="img"]'));
		const hot = cells.find((c) => c.getAttribute('aria-label')?.includes('Monday 08:00'));
		expect(hot?.getAttribute('aria-label')).toContain('High');
		expect(hot?.getAttribute('aria-label')).not.toContain('0.9');

		const nullCell = cells.find((c) => c.getAttribute('aria-label')?.includes('Monday 00:00'));
		expect(nullCell?.getAttribute('aria-label')).toContain('No data');
	});
});

describe('Heatmap — a11y keyboard contract', () => {
	it('keeps exactly one roving tab stop and moves it with arrow keys', async () => {
		const { container } = render(Heatmap, { props: { grid: sparseGrid(), interactive: true } });
		const cells = Array.from(container.querySelectorAll('rect[role="img"]'));
		const tabbable = () => cells.filter((c) => c.getAttribute('tabindex') === '0');

		// Exactly one tab stop initially (the first cell).
		expect(tabbable()).toHaveLength(1);
		expect(tabbable()[0]).toBe(cells[0]);

		// ArrowRight moves the single tab stop one hour along the row.
		await fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
		expect(tabbable()).toHaveLength(1);
		expect(tabbable()[0]).toBe(cells[1]);
	});
});
