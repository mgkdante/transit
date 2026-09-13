import { observeChartFrames } from '../__fixtures__/observeChartFrames';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TrendMark from './TrendMark.svelte';
import type { TrendSpec } from '../ChartSpec';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
	else Reflect.deleteProperty(Element.prototype, 'animate');
});

describe('TrendMark primary-series voice', () => {
	it('uses an opted-in primary colour while preserving the default-independent dated mark', () => {
		const spec = {
			kind: 'trend',
			title: 'Chosen daily delay series',
			locale: 'en',
			xScale: 'band',
			domain: [0, 15],
			unit: ' min',
			label: 'Slowest 10% (min)',
			points: [{ x: '2026-01-31', xLabel: '2026-01-31', y: 2, y2: null }],
			hasBand: false,
			minPointsForLine: 2,
			minN: 0,
			colorVar: 'var(--dataviz-status-late)',
		} satisfies TrendSpec & { readonly colorVar: string };

		const { container } = render(TrendMark, { props: { spec } });
		const swatch = container.querySelector<HTMLElement>('[data-slot="chart-legend"] li span');
		expect(swatch?.style.background).toBe('var(--dataviz-status-late)');
		expect(container.querySelector('table.sr-only caption')).toHaveTextContent(
			'Chosen daily delay series',
		);
		expect(container.querySelector('table.sr-only thead th:last-child')?.textContent).toBe(
			'Slowest 10% (min)',
		);
		expect(container.querySelector('table.sr-only td')?.textContent).toBe('2 min');
	});

	it('renders the French x header from the spec locale', () => {
		const spec: TrendSpec = {
			kind: 'trend',
			title: 'Tendance de ponctualité',
			locale: 'fr',
			xScale: 'band',
			domain: [0, 100],
			unit: ' %',
			label: 'À l’heure',
			points: [{ x: 'AM', xLabel: 'Pointe AM', y: 82, bandLo: 78, bandHi: 86 }],
			hasBand: true,
			minPointsForLine: 2,
			minN: 0,
		};

		const { container } = render(TrendMark, { props: { spec } });
		expect(container.querySelector('table.sr-only thead th')).toHaveTextContent('axe x');
	});
});

describe('TrendMark datum formatting', () => {
	it.each(['en', 'fr'] as const)(
		'keeps raw values and distinguishes zero from missing in %s',
		async (locale) => {
			vi.stubGlobal('IntersectionObserver', undefined);
			observeChartFrames(768, 144);
			Object.defineProperty(Element.prototype, 'animate', {
				configurable: true,
				value: vi.fn(() => ({
					cancel: vi.fn(),
					currentTime: 0,
					effect: null,
					onfinish: null,
					playState: 'finished',
				})),
			});
			vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
			vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(144);
			const points = Object.freeze([
				{
					x: 'AM',
					xLabel: 'Morning',
					y: 200 / 3,
					y2: null,
					bandLo: 33.333,
					bandHi: 99.999,
					n: 1234,
				},
				{ x: 'PM', xLabel: 'Evening', y: 0, y2: 0, n: null },
			]);
			const spec: TrendSpec = {
				kind: 'trend',
				title: 'Observed delay trend',
				locale,
				xScale: 'band',
				domain: [0, 100],
				unit: '%',
				label: 'On-time',
				secondary: { domain: [0, 8], unit: ' min', label: 'Delay' },
				points,
				hasBand: true,
				minPointsForLine: 2,
				minN: 0,
			};
			const { container } = render(TrendMark, { props: { spec } });
			const overlays = await waitFor(() => {
				const rows = [...container.querySelectorAll('rect.lc-tooltip-rect')].sort(
					(a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x')),
				);
				expect(rows.length).toBeGreaterThanOrEqual(2);
				return [rows[0], rows[rows.length - 1]];
			});
			await fireEvent.pointerEnter(overlays[0], { pointerType: 'mouse', clientX: 80, clientY: 50 });
			const tooltip = await waitFor(() => {
				const element = document.querySelector('.lc-tooltip-content') as HTMLElement;
				expect(element).not.toBeNull();
				return element;
			});
			expect(within(tooltip).getByText(locale === 'fr' ? '66,7%' : '66.7%')).toBeInTheDocument();
			expect(
				within(tooltip).getByText(locale === 'fr' ? 'Aucune donnée' : 'No data'),
			).toBeInTheDocument();
			expect(tooltip.textContent).not.toMatch(/66[.,]666|No data min|Aucune donnée min/);
			await fireEvent.pointerEnter(overlays[1], {
				pointerType: 'mouse',
				clientX: 350,
				clientY: 50,
			});
			await waitFor(() => expect(within(tooltip).getByText('0%')).toBeInTheDocument());
			expect(within(tooltip).getByText('0 min')).toBeInTheDocument();
			expect(points[0].y).toBe(200 / 3);
			expect(points[0].y2).toBeNull();
			expect(points[1].y).toBe(0);
		},
	);
});
