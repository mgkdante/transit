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
	document.querySelectorAll('[role="tooltip"]').forEach((el) => el.remove());
});

describe('ChartTooltip portal + viewport anchoring', () => {
	it('portals the tip OUT of the chart wrapper to <body> (escapes ancestor clipping)', () => {
		const { container } = render(SeverityBar, { props });

		const wrap = container.querySelector('[data-slot="chart-tooltip-wrap"]');
		expect(wrap).not.toBeNull();

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
		expect(tip.style.left).toMatch(/px$/);
		expect(tip.style.top).toMatch(/px$/);
		expect(tip.classList.contains('chart-tooltip')).toBe(true);
	});

	it('reveals the hovered content on pointer enter', async () => {
		render(SeverityBar, { props });
		const bar = screen.getByRole('progressbar');
		await fireEvent.pointerEnter(bar);

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
