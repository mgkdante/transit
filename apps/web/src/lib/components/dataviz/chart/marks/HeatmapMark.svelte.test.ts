import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import HeatmapMark from './HeatmapMark.svelte';
import type { HeatmapSpec } from '../ChartSpec';

// PR-WEB-6: the 7×24 heatmap now splits into a FROZEN day-label gutter + a SCROLLING cell grid
// (ScrollFrame). jsdom has no layout so the ChartFrame-gated cell SVG doesn't mount — but the
// ScrollFrame structure + the sr-only AT table (the layout-independent contract) DO render.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const spec: HeatmapSpec = {
	kind: 'heatmap',
	title: 'Repeat-problems heatmap',
	locale: 'en',
	mode: 'absolute',
	domain: [0, 1],
	rowLabels: DAYS,
	colLabels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
	cells: Array.from({ length: 7 }, (_, r) =>
		Array.from({ length: 24 }, (_, c) => ({ value: r === 4 && c === 8 ? 1 : (c % 5) / 5 })),
	),
	tiers: {
		tierLabels: ['calm', 'mild', 'rough', 'worst'],
		noDataLabel: 'no data',
		worstGlyph: '◆',
	},
	valueLabel: 'Repeat problems',
	rowAxisLabel: 'Day',
	colAxisLabel: 'Hour of day',
	fullRowLabels: FULL,
	colTicks: [0, 6, 12, 18].map((h) => ({ index: h, label: `${String(h).padStart(2, '0')}:00` })),
};

describe('HeatmapMark — frozen-gutter / scroll split (PR-WEB-6)', () => {
	it('wraps the grid in a ScrollFrame with a pinned gutter + a scrollable region', () => {
		const { container } = render(HeatmapMark, { props: { spec } });
		expect(container.querySelector('[data-slot="scroll-frame"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="scroll-frame-gutter"]')).not.toBeNull();
		const scroller = container.querySelector('[data-slot="scroll-frame-scroller"]');
		expect(scroller).not.toBeNull();
		// the scroll region is labelled by the (scrollable) hour dimension for AT.
		expect(scroller?.getAttribute('aria-label')).toBe('Hour of day');
	});

	it('still renders the full sr-only table (the layout-independent AT mirror)', () => {
		const { container } = render(HeatmapMark, { props: { spec } });
		const table = container.querySelector('table.sr-only');
		expect(table).not.toBeNull();
		// one row header per full day name + the worst cell carries the ◆ glyph.
		for (const day of FULL) expect(table?.textContent).toContain(day);
		expect(table?.textContent).toContain('◆');
		expect(table?.querySelectorAll('tbody tr').length).toBe(7);
	});
});
