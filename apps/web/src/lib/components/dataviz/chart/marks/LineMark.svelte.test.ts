import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LineMark from './LineMark.svelte';
import type { LineSpec } from '../ChartSpec';

afterEach(cleanup);

describe('LineMark structural labels', () => {
	it('renders the French fallback x header from the spec locale', () => {
		const spec: LineSpec = {
			kind: 'line',
			title: 'Cycle hebdomadaire',
			locale: 'fr',
			xLabels: ['lun.', 'mar.'],
			domain: [0, 10],
			unit: ' min',
			series: [{ key: 'delay', label: 'Retard moyen', points: [2, 3] }],
		};

		const { container } = render(LineMark, { props: { spec } });
		expect(container.querySelector('table.sr-only thead th')).toHaveTextContent('axe x');
	});
});
