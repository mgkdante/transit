import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Section4WorstStops from './Section4WorstStops.svelte';
import { reliabilityCopy } from '../reliability.copy';
import type { PunctualityVM } from '../clusters';
import type { WeakStop } from '$lib/v1';

// Minimal PunctualityVM — only `weakStops` + `weakStopsWindowed` are read by §4.
const vm = (weakStops: WeakStop[], weakStopsWindowed: boolean): PunctualityVM => ({
	headline: {
		otpPct: null,
		avgDelayMin: null,
		p50Min: null,
		p90Min: null,
		severePct: null,
		delayHistogram: null,
		observationCount: null,
		onTime: null,
	},
	trend: [],
	dayOfWeek: [],
	weakStops,
	peakOffPeak: { byShift: [], byDayType: [], isEmpty: true },
	byShiftDaytype: [],
	windowed: weakStopsWindowed,
	weakStopsWindowed,
	isEmpty: false,
});

// 6 windowed stops (DB-ranked worst-first), the worst carrying a <= 0 pooled avg.
const windowedStops: WeakStop[] = [
	{
		id: 'w1',
		name: 'Worst',
		avg_delay_min: -1,
		severe_pct: 42,
		observation_count: 987,
		wilson_lo: 33,
		wilson_hi: 47,
	},
	{
		id: 'w2',
		name: 'Two',
		avg_delay_min: 6,
		severe_pct: 35,
		observation_count: 500,
		wilson_lo: 28,
		wilson_hi: 42,
	},
	{
		id: 'w3',
		name: 'Three',
		avg_delay_min: 5,
		severe_pct: 30,
		observation_count: 400,
		wilson_lo: 24,
		wilson_hi: 36,
	},
	{
		id: 'w4',
		name: 'Four',
		avg_delay_min: 4,
		severe_pct: 25,
		observation_count: 300,
		wilson_lo: 19,
		wilson_hi: 31,
	},
	{
		id: 'w5',
		name: 'Five',
		avg_delay_min: 3,
		severe_pct: 20,
		observation_count: 200,
		wilson_lo: 14,
		wilson_hi: 26,
	},
	{
		id: 'w6',
		name: 'Six',
		avg_delay_min: 2,
		severe_pct: 15,
		observation_count: 150,
		wilson_lo: 9,
		wilson_hi: 21,
	},
];

describe('Section4WorstStops — windowed severe-rate path (S7-B)', () => {
	it('renders the weak-stops list (not the empty state) for a windowed VM with a <= 0-avg worst stop', () => {
		const { container } = render(Section4WorstStops, {
			props: { punctuality: vm(windowedStops, true), locale: 'en', copy: reliabilityCopy.en },
		});
		expect(container.querySelector('[data-slot="weak-stops"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="worst-stops-empty"]')).toBeNull();
	});

	it('caps the worst-N control at exactly 5 / 10 / All (never the old 20/30/50/100)', () => {
		const { container } = render(Section4WorstStops, {
			props: { punctuality: vm(windowedStops, true), locale: 'en', copy: reliabilityCopy.en },
		});
		// the picker shows once total > 5 (6 stops here). Scope to the radiogroup so the assertion
		// can't be polluted by SEVERE_DOMAIN axis ticks (0/20/.../100) or severe_pct data values.
		const picker = container.querySelector('[role="radiogroup"]');
		expect(picker).not.toBeNull();
		const segments = Array.from(picker?.querySelectorAll('[role="radio"]') ?? []).map((el) =>
			el.textContent?.trim(),
		);
		expect(segments).toEqual(['5', '10', 'All']);
	});

	it('threads preRanked: windowed bar = severe_pct (%), NOT avg, for a <=0-avg worst stop', () => {
		// the sr-only table is the AT mirror of the chart: <th>{unit}</th> + <td>{value}</td> in
		// spec (worst-first) order. Windowed → unit '%', value = severe_pct; a preRanked:false
		// regression would show ' min' + the avg (-1) for the worst stop. Pins the threading.
		const { container } = render(Section4WorstStops, {
			props: {
				punctuality: vm(
					[
						{
							id: 'w',
							name: 'W',
							avg_delay_min: -1,
							severe_pct: 40,
							observation_count: 99,
							// the contract's NOT-severe CI (not_severe = 60 ∈ [50, 70]); the selector flips it
							// onto the severe scale → [100 − 70, 100 − 50] = [30, 50], which brackets severe 40.
							wilson_lo: 50,
							wilson_hi: 70,
						},
					],
					true,
				),
				locale: 'en',
				copy: reliabilityCopy.en,
			},
		});
		const unitHeader = container
			.querySelector('table.sr-only thead th:nth-child(2)')
			?.textContent?.trim();
		expect(unitHeader).toBe('%'); // severe-rate unit, not ' min'
		const firstRow = container.querySelector('table.sr-only tbody tr');
		expect(firstRow?.getAttribute('data-key')).toBe('w'); // DB worst-first order preserved
		const valueCell = firstRow?.querySelector('td')?.textContent ?? '';
		expect(valueCell).toContain('40'); // the severe rate, NOT the -1 avg
		expect(valueCell).not.toContain('-1');
		// the Wilson 95% interval is surfaced honestly in the AT mirror (Feature B)
		expect(valueCell).toContain('95% CI');
		expect(valueCell).toContain('30');
		expect(valueCell).toContain('50');
	});

	it('degrades to the honest empty state when no stop is served', () => {
		const { container } = render(Section4WorstStops, {
			props: { punctuality: vm([], true), locale: 'en', copy: reliabilityCopy.en },
		});
		expect(container.querySelector('[data-slot="worst-stops-empty"]')).not.toBeNull();
	});

	it('FR locale renders the "Tous" all-segment', () => {
		const { getByText } = render(Section4WorstStops, {
			props: { punctuality: vm(windowedStops, true), locale: 'fr', copy: reliabilityCopy.fr },
		});
		expect(getByText('Tous')).toBeTruthy();
	});
});
