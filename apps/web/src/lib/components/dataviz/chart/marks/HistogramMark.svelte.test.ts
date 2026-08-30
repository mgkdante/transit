import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HistogramMark from './HistogramMark.svelte';
import type { HistogramSpec } from '../ChartSpec';

afterEach(cleanup);

describe('HistogramMark structural labels', () => {
	it('renders French bin and range language from the spec locale', () => {
		const spec: HistogramSpec = {
			kind: 'histogram',
			title: 'Distribution des retards',
			locale: 'fr',
			domain: [-300, 1800],
			countDomain: [0, 10],
			unit: ' min',
			bins: [
				{ lo: -90, hi: -60, count: 2 },
				{ lo: 0, hi: 60, count: 3 },
			],
		};

		const { container } = render(HistogramMark, { props: { spec } });
		expect(container.querySelector('table.sr-only')).toHaveTextContent(
			'intervalle (min)voyages-1,5 à -1 min20 à 1 min3',
		);
	});
});
