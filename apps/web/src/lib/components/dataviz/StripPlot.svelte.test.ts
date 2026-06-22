import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StripPlot from './StripPlot.svelte';

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="strip-plot"]')!;
const circles = (c: HTMLElement) => [...c.querySelectorAll('circle')];

describe('StripPlot — one dot per value (small-sample distribution)', () => {
	it('renders a dot per value with a data-slot + aria summary', () => {
		const { container } = render(StripPlot, { props: { values: [1, 3, 5, 2], label: '4 trips' } });
		expect(fig(container).getAttribute('aria-label')).toBe('4 trips');
		expect(circles(container).length).toBe(4);
	});

	it('skips null/NaN observations (never a fabricated dot)', () => {
		const { container } = render(StripPlot, {
			props: { values: [1, null as unknown as number, Number.NaN, 4] },
		});
		expect(circles(container).length).toBe(2);
	});

	it('jitter is DETERMINISTIC — same ids render identical cy (never Math.random)', () => {
		const props = { values: [2, 2, 2], ids: ['a', 'b', 'c'], domain: [0, 10] as [number, number] };
		const a = render(StripPlot, { props });
		const b = render(StripPlot, { props });
		const cyA = circles(a.container).map((c) => c.getAttribute('cy'));
		const cyB = circles(b.container).map((c) => c.getAttribute('cy'));
		expect(cyA).toEqual(cyB); // byte-identical across renders
		expect(new Set(cyA).size).toBeGreaterThan(1); // distinct ids → separated dots
	});

	it('the dot fill is a dataviz token', () => {
		const { container } = render(StripPlot, {
			props: { values: [1], colorVar: 'var(--dataviz-status-late)' },
		});
		expect(circles(container)[0].getAttribute('fill')).toBe('var(--dataviz-status-late)');
	});
});
