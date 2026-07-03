// ChartTooltip.svelte.test.ts: the floating chart tooltip contract.
//
// ChartTooltip is the pointer-positioned overlay used by the NON-CHART dataviz
// primitives (SeverityBar, RankedRow, MetricInfo readouts — the chart marks ride
// LayerChart's own tooltip since P5.2). Its non-negotiables after the
// edge-clipping fix:
//   1. it PORTALS the tip out of the chart wrapper to <body>, so no overflow:hidden
//      ancestor can clip it and the chart's width can't shrink it,
//   2. the portaled tip is position:FIXED (anchored in viewport coordinates),
//   3. it carries its content (heading + rows) and the controller id for aria.
//
// Driven through SeverityBar (interactive) so it exercises the real wiring rather
// than a hand-built snippet.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SeverityBar from './SeverityBar.svelte';

const props = {
	severity: 'high' as const,
	value: 0.6,
	label: 'Late share',
	display: '60%',
	interactive: true,
};

afterEach(() => {
	// The tooltip portals to <body>; clear any stragglers between tests.
	document.querySelectorAll('[role="tooltip"]').forEach((el) => el.remove());
});

describe('ChartTooltip portal + viewport anchoring', () => {
	it('portals the tip OUT of the chart wrapper to <body> (escapes ancestor clipping)', () => {
		const { container } = render(SeverityBar, { props });

		// The chart wrapper stays inside the rendered container...
		const wrap = container.querySelector('[data-slot="chart-tooltip-wrap"]');
		expect(wrap).not.toBeNull();

		// ...but the role=tooltip tip is portaled to <body>, NOT a descendant of the
		// chart wrapper (so no overflow:hidden ancestor of the chart can clip it).
		const tip = document.body.querySelector('[role="tooltip"]');
		expect(tip).not.toBeNull();
		expect(wrap?.contains(tip)).toBe(false);
	});

	it('anchors the portaled tip in viewport pixel coordinates (left/top px)', async () => {
		render(SeverityBar, { props });
		const bar = screen.getByRole('progressbar');
		await fireEvent.pointerEnter(bar);

		const tip = document.body.querySelector('[role="tooltip"]') as HTMLElement;
		expect(tip).not.toBeNull();
		// Position is driven by inline left/top in PIXELS (viewport coordinates),
		// not a percentage of the wrapper. This is the viewport-anchored fix.
		expect(tip.style.left).toMatch(/px$/);
		expect(tip.style.top).toMatch(/px$/);
		// The class that carries `position: fixed` is present.
		expect(tip.classList.contains('chart-tooltip')).toBe(true);
	});

	it('reveals the hovered content on pointer enter', async () => {
		render(SeverityBar, { props });
		const bar = screen.getByRole('progressbar');
		await fireEvent.pointerEnter(bar);

		// The tip (portaled) now shows the reading.
		const tip = document.body.querySelector('[role="tooltip"]') as HTMLElement;
		expect(tip).not.toBeNull();
		expect(tip).toHaveTextContent('Late share');
		expect(tip.getAttribute('aria-hidden')).toBe('false');
	});

	it('hides (aria-hidden) on pointer leave', async () => {
		render(SeverityBar, { props });
		const bar = screen.getByRole('progressbar');
		await fireEvent.pointerEnter(bar);
		await fireEvent.pointerLeave(bar);
		const tip = document.body.querySelector('[role="tooltip"]') as HTMLElement;
		expect(tip.getAttribute('aria-hidden')).toBe('true');
	});
});
