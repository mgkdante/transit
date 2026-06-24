import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StripPlot, { type StripPlotRow } from './StripPlot.svelte';

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="strip-plot"]')!;
const circles = (c: HTMLElement) => [...c.querySelectorAll('circle')];
const dots = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.dv-strip-plot__dot')];

const shiftRow = (
	p: Partial<StripPlotRow> & { key: string; value: number | null },
): StripPlotRow => ({
	label: p.key,
	colorVar: 'var(--dataviz-severity-high)',
	glyph: '◆',
	display: p.value != null ? `${p.value}%` : '',
	emptyLabel: 'no data',
	...p,
});

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

describe('StripPlot — categorical Cleveland dot plot (one dot per shift)', () => {
	const ROWS: StripPlotRow[] = [
		shiftRow({ key: 'am_peak', value: 8 }),
		shiftRow({ key: 'midday', value: 3 }),
		shiftRow({ key: 'pm_peak', value: 14 }),
		shiftRow({ key: 'evening', value: 6 }),
		shiftRow({ key: 'night', value: 2 }),
	];
	const domain: [number, number] = [0, 35];

	it('renders the categorical layout (one dot per non-null row) + a data-layout marker', () => {
		const { container } = render(StripPlot, {
			props: { rows: ROWS, domain, label: 'severe by shift' },
		});
		expect(fig(container).getAttribute('data-layout')).toBe('categorical');
		expect(fig(container).getAttribute('aria-label')).toBe('severe by shift');
		expect(dots(container).length).toBe(5);
		// The categorical layout uses HTML dots, never the 1-D <circle> cloud.
		expect(circles(container).length).toBe(0);
	});

	it('order="given" preserves the caller order (a fixed chronological axis)', () => {
		const { container } = render(StripPlot, { props: { rows: ROWS, domain, order: 'given' } });
		const labels = [...container.querySelectorAll('.dv-strip-plot__label')].map((n) =>
			n.textContent?.trim(),
		);
		expect(labels).toEqual(['am_peak', 'midday', 'pm_peak', 'evening', 'night']);
	});

	it('order="value" sorts worst→best by value', () => {
		const { container } = render(StripPlot, { props: { rows: ROWS, domain, order: 'value' } });
		const labels = [...container.querySelectorAll('.dv-strip-plot__label')].map((n) =>
			n.textContent?.trim(),
		);
		expect(labels).toEqual(['pm_peak', 'am_peak', 'evening', 'midday', 'night']);
	});

	it('positions each dot at value/domain percent on the SHARED axis (fixed domain, not in-view max)', () => {
		const { container } = render(StripPlot, { props: { rows: ROWS, domain, order: 'given' } });
		const lefts = dots(container).map((d) => d.style.left);
		// am_peak=8/35≈22.857%, pm_peak=14/35=40%. The worst (14) is NOT pinned to 100%.
		expect(lefts[0]).toBe(`${(8 / 35) * 100}%`);
		expect(lefts[2]).toBe('40%');
	});

	it('the dot fill is a dataviz token (never --primary) carried via --dot-fill', () => {
		const { container } = render(StripPlot, {
			props: {
				rows: [
					shiftRow({ key: 'pm_peak', value: 14, colorVar: 'var(--dataviz-severity-critical)' }),
				],
				domain,
			},
		});
		expect(dots(container)[0].style.getPropertyValue('--dot-fill')).toBe(
			'var(--dataviz-severity-critical)',
		);
	});

	it('every dot carries a glyph + an accessible label (colour is never the sole channel)', () => {
		const { container } = render(StripPlot, { props: { rows: ROWS, domain } });
		const first = dots(container)[0];
		expect(first.querySelector('.dv-strip-plot__glyph')?.textContent).toBe('◆');
		expect(first.getAttribute('aria-label')).toContain('am_peak');
	});

	it('direct-labels ONLY the extremes (lowest + highest value)', () => {
		const { container } = render(StripPlot, { props: { rows: ROWS, domain } });
		const valueLabels = [...container.querySelectorAll('.dv-strip-plot__value')].map((n) =>
			n.textContent?.trim(),
		);
		// night=2 (min) + pm_peak=14 (max) are labelled; the 3 middling rows are not.
		expect(valueLabels.sort()).toEqual(['14%', '2%']);
	});

	it('draws the all-day mean reference rule when `mean` is supplied', () => {
		const { container } = render(StripPlot, {
			props: { rows: ROWS, domain, mean: 7, meanLabel: 'all-day mean 7%' },
		});
		const rule = container.querySelector<HTMLElement>('.dv-strip-plot__mean');
		expect(rule).not.toBeNull();
		expect(rule!.style.left).toBe(`${(7 / 35) * 100}%`);
		expect(rule!.getAttribute('aria-label')).toBe('all-day mean 7%');
	});

	it('a null-value row routes through honest absence — no dot, the WHY (never a fabricated 0)', () => {
		const { container } = render(StripPlot, {
			props: {
				rows: [
					shiftRow({ key: 'am_peak', value: 8 }),
					shiftRow({ key: 'night', value: null, emptyLabel: 'no observations' }),
				],
				domain,
			},
		});
		expect(dots(container).length).toBe(1); // only the real row gets a dot
		const empty = container.querySelector('.dv-strip-plot__empty');
		expect(empty?.textContent).toBe('no observations');
	});
});
