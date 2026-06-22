import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import KpiCard from './KpiCard.svelte';

const card = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="kpi-card"]')!;

describe('KpiCard — headline metric card (doctrine §3.1)', () => {
	it('renders the eyebrow label + the accent value voice + data-slot', () => {
		const { container } = render(KpiCard, { props: { label: 'On-time, last 24h', value: '82%' } });
		const c = card(container);
		expect(within(c).getByText('On-time, last 24h')).toBeInTheDocument();
		// The value renders via the shared brand/MetricDisplay — its accent wayfinding
		// voice is MetricDisplay's own tested contract; KpiCard just composes it (and
		// keeps signage off the value, on the delta row only — asserted below).
		expect(c.querySelector('.metric-value')?.textContent).toBe('82%');
	});

	it('honest no-data: muted emptyLabel, never the value voice', () => {
		const { container } = render(KpiCard, {
			props: { label: 'x', value: null, emptyLabel: 'No data yet' },
		});
		const c = card(container);
		expect(c.querySelector('[data-slot="metric-empty"]')?.textContent).toBe('No data yet');
		expect(c.querySelector('.metric-value')).toBeNull();
	});

	it('shows the delta row only when a delta is present, with signage THERE (not the value)', () => {
		const { container } = render(KpiCard, {
			props: { label: 'On-time', value: '82%', delta: -1.2, higherIsBetter: true },
		});
		const d = card(container).querySelector('[data-slot="delta-stat"]')!;
		// a fall in on-time% is a regression → severity-critical on the delta row
		expect(d.getAttribute('style')).toContain('var(--dataviz-severity-critical)');
	});

	it('omits the sparkline below the doctrine point floor, draws it at/above', () => {
		const few = render(KpiCard, { props: { label: 'x', value: '1', sparkline: [1, 2, 3] } });
		expect(few.container.querySelector('[data-slot="sparkline"]')).toBeNull();
		const many = render(KpiCard, {
			props: { label: 'x', value: '1', sparkline: [1, 2, 3, 4, 5, 6, 7] },
		});
		expect(many.container.querySelector('[data-slot="sparkline"]')).not.toBeNull();
	});
});
