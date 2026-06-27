import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import MagnitudeBarsMark from './MagnitudeBarsMark.svelte';
import type { MagnitudeBarsSpec } from '../ChartSpec';

// A row carrying Wilson bounds, used to prove the CI surfaces ONLY when spec.ciLabel is set (the
// defensive guard). The sr-only table is the structure-independent AT mirror.
const rowWithCi = {
	key: 's1',
	label: 'Stop One',
	value: 44,
	severity: 'high' as const,
	wilsonLo: 31,
	wilsonHi: 57,
};
const baseSpec = (ciLabel?: string): MagnitudeBarsSpec => ({
	kind: 'magnitude-bars',
	mark: 'bar',
	title: 'Worst stops',
	locale: 'en',
	domain: [0, 100],
	unit: '%',
	xLabel: 'Severe-delay rate',
	rows: [rowWithCi],
	sort: 'given',
	scale: 'severity',
	ciLabel,
});

const cell = (c: HTMLElement): string =>
	c.querySelector('table.sr-only tbody tr td')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('MagnitudeBarsMark — Wilson CI surfacing guard (PR-WEB-2 Feature B)', () => {
	it('surfaces the CI in the sr-only cell when ciLabel is set AND the row has both bounds', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec('95% CI') } });
		expect(cell(container)).toContain('95% CI');
		expect(cell(container)).toContain('31');
		expect(cell(container)).toContain('57');
	});

	it('shows NO CI when ciLabel is unset, even though the row carries Wilson bounds (the guard)', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec(undefined) } });
		const txt = cell(container);
		expect(txt).toContain('44'); // the value still renders
		expect(txt).not.toContain('('); // no fabricated CI parenthetical
		expect(txt).not.toContain('31');
		expect(txt).not.toContain('57');
	});
});
