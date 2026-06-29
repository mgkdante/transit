// RankedRow.svelte.test.ts — locks the canonical dataviz-row contract that the
// S3 KPI-card kit (KpiCard/BulletKpi/DeltaStat) clones its shape from. The
// load-bearing invariants: data-slot, the role ladder
// (listitem / button / bare), and the delta chip's glyph + dataviz-scale colour +
// aria — direction is NEVER colour-only, and a missing delta is honest no-data
// (neutral glyph, "no change data"), never a fabricated 0 or a coloured arrow.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RankedRow from './RankedRow.svelte';

const base = { rank: 1, title: 'Route 165', severity: 'high' as const, value: 0.8 };

const deltaEl = (c: HTMLElement) => c.querySelector<HTMLElement>('.dv-delta');

describe('RankedRow — the dataviz-row template contract', () => {
	it('renders rank, title, display, and the data-slot; default role is listitem', () => {
		const { container } = render(RankedRow, { props: { ...base, display: '84%' } });
		const root = container.querySelector('[data-slot="ranked-row"]');
		expect(root).not.toBeNull();
		expect(root?.getAttribute('role')).toBe('listitem');
		expect(screen.getByText('Route 165')).toBeInTheDocument();
		expect(screen.getByText('84%')).toBeInTheDocument();
		expect(screen.getByText('1')).toBeInTheDocument();
	});

	it('a regression delta (default higherIsBetter=false) is ▲ on the severity-critical token', () => {
		const { container } = render(RankedRow, { props: { ...base, delta: 2.1 } });
		const el = deltaEl(container)!;
		expect(el.getAttribute('aria-label')).toBe('change +2.1');
		expect(el.textContent).toContain('▲');
		expect(el.getAttribute('style')).toContain('var(--dataviz-severity-critical)');
	});

	it('an improvement delta is ▼ on the on-time token', () => {
		const { container } = render(RankedRow, { props: { ...base, delta: -1.5 } });
		const el = deltaEl(container)!;
		expect(el.getAttribute('aria-label')).toBe('change -1.5');
		expect(el.textContent).toContain('▼');
		expect(el.getAttribute('style')).toContain('var(--dataviz-status-on-time)');
	});

	it('higherIsBetter flips the colour verdict (a rise is good)', () => {
		const { container } = render(RankedRow, {
			props: { ...base, delta: 3, higherIsBetter: true },
		});
		expect(deltaEl(container)!.getAttribute('style')).toContain('var(--dataviz-status-on-time)');
	});

	it('a null delta is honest no-data: neutral glyph + unknown token + "no change data"', () => {
		const { container } = render(RankedRow, { props: { ...base, delta: null } });
		const el = deltaEl(container)!;
		expect(el.getAttribute('aria-label')).toBe('no change data');
		expect(el.textContent).toContain('·');
		expect(el.getAttribute('style')).toContain('var(--dataviz-status-unknown)');
		// never fabricates a value next to the neutral glyph
		expect(el.textContent).not.toMatch(/\d/);
	});

	it('becomes a button when activatable, and drops its role when bare', () => {
		const { container: a } = render(RankedRow, { props: { ...base, onSelect: () => {} } });
		const btn = a.querySelector('[data-slot="ranked-row"]')!;
		expect(btn.getAttribute('role')).toBe('button');
		expect(btn.getAttribute('tabindex')).toBe('0');

		const { container: b } = render(RankedRow, { props: { ...base, bare: true } });
		expect(b.querySelector('[data-slot="ranked-row"]')!.getAttribute('role')).toBeNull();
	});

	it('hides the rank ordinal when showRank=false (fixed-category lists, S7)', () => {
		const withRank = render(RankedRow, { props: { ...base, display: '4 min' } });
		expect(withRank.container.querySelector('.dv-rank')).not.toBeNull();
		const noRank = render(RankedRow, { props: { ...base, display: '4 min', showRank: false } });
		expect(noRank.container.querySelector('.dv-rank')).toBeNull();
	});

	it('forwards a fixed absolute domain to the bar (stable, not relative-to-max, S7)', () => {
		// 4 min on [-2,8] -> 60% fill, independent of any in-view max.
		const { container } = render(RankedRow, {
			props: { ...base, value: 4, domain: [-2, 8] as const, display: '4.0 min' },
		});
		const fill = container.querySelector('.dv-severity-fill') as HTMLElement;
		expect(parseFloat(fill.style.width)).toBeCloseTo(60, 1);
	});
});
