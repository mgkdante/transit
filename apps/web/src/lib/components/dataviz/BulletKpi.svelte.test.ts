import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BulletKpi from './BulletKpi.svelte';

const card = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="bullet-kpi"]')!;

describe('BulletKpi — number vs target (Few bullet, not a gauge)', () => {
	it('renders the value + a dataviz measure bar + target tick, fully labelled', () => {
		const { container } = render(BulletKpi, {
			props: { label: 'On-time vs target', value: 82, display: '82%', target: 85, unit: '%' },
		});
		const c = card(container);
		expect(c.querySelector('.metric-value')?.textContent).toBe('82%');
		const svg = c.querySelector<SVGElement>('svg.dv-bullet-bar')!;
		expect(svg.getAttribute('aria-label')).toContain('target 85%');
		const fills = [...svg.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
		// measure bar rides the dataviz scale, NEVER --primary
		expect(fills).toContain('var(--dataviz-status-on-time)');
		expect(fills).not.toContain('var(--primary)');
	});

	it('suppresses to no-data when the sample is too small (n < MIN_N_RATE)', () => {
		const { container } = render(BulletKpi, {
			props: { label: 'x', value: 100, n: 3, emptyLabel: 'Too few trips' },
		});
		const c = card(container);
		expect(c.querySelector('[data-slot="metric-empty"]')?.textContent).toBe('Too few trips');
		expect(c.querySelector('svg.dv-bullet-bar')).toBeNull(); // no rate off a tiny denominator
	});

	it('suppresses when the value is absent', () => {
		const { container } = render(BulletKpi, {
			props: { label: 'x', value: null, emptyLabel: 'No data' },
		});
		expect(container.querySelector('svg.dv-bullet-bar')).toBeNull();
	});
});
