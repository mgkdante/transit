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
