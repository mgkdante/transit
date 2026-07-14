import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TrendMark from './TrendMark.svelte';
import type { TrendSpec } from '../ChartSpec';

afterEach(cleanup);

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
	});
});
