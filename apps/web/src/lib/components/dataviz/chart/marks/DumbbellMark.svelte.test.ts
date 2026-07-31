import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DumbbellMark from './DumbbellMark.svelte';
import type { DumbbellSpec } from '../ChartSpec';

afterEach(cleanup);

describe('DumbbellMark structural labels', () => {
	it('renders the French row header from the spec locale', () => {
		const spec: DumbbellSpec = {
			kind: 'dumbbell',
			title: 'Intervalle prévu et observé',
			locale: 'fr',
			domain: [0, 20],
			unit: ' min',
			rows: [{ key: 'am', label: 'Pointe AM', scheduled: 8, observed: 12, excess: 4 }],
			scale: 'severity',
			scheduledLabel: 'Prévu',
			observedLabel: 'Observé',
		};

		const { container } = render(DumbbellMark, { props: { spec } });
		expect(container.querySelector('table.sr-only thead th')).toHaveTextContent('ligne');
	});
});
