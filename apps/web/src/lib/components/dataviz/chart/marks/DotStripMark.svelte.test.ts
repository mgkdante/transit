import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DotStripMark from './DotStripMark.svelte';
import type { DotStripSpec } from '../ChartSpec';

afterEach(cleanup);

describe('DotStripMark structural labels', () => {
	it('renders the French group header from the spec locale', () => {
		const spec: DotStripSpec = {
			kind: 'dot-strip',
			title: 'Retards importants',
			locale: 'fr',
			domain: [0, 100],
			unit: ' %',
			points: [{ key: 'am', group: 'Pointe AM', value: 12 }],
			scale: 'severity',
		};

		const { container } = render(DotStripMark, { props: { spec } });
		expect(container.querySelector('table.sr-only thead th')).toHaveTextContent('groupe');
	});
});
