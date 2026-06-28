import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Section1WhenToRide from './Section1WhenToRide.svelte';
import { reliabilityCopy } from '../reliability.copy';
import type { PunctualityVM, PeriodComparisonRow, HabitsVM } from '../clusters';

// PR-WEB-3 §1 on-time-by-time-of-day · vs-prior comparison. The pure two-proportion math
// is unit-tested in selectors/priorDelta.test.ts; THIS pins the section WIRING: the windowed
// gate, the change / noise / honest-absence states, and the four-colour Δ badge text.

const row = (
	grain: string,
	otpPct: number | null,
	observationCount: number | null,
	onTime: number | null,
	priorOtpPct: number | null,
	priorObservationCount: number | null,
): PeriodComparisonRow => ({
	grain,
	otpPct,
	avgDelayMin: null,
	severePct: 5, // keeps hasShiftStrip true so the section isn't the honest-empty branch
	observationCount,
	onTime,
	priorOtpPct,
	priorObservationCount,
});

const vm = (
	byShift: PeriodComparisonRow[],
	byDayType: PeriodComparisonRow[],
	windowed: boolean,
): PunctualityVM => ({
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
	weakStops: [],
	peakOffPeak: { byShift, byDayType, isEmpty: byShift.length === 0 && byDayType.length === 0 },
	byShiftDaytype: [],
	windowed,
	weakStopsWindowed: false,
	isEmpty: false,
});

const emptyHabits: HabitsVM = { scale: null, matrix: [], isEmpty: true };

const rowsByState = (container: HTMLElement, prior: string): HTMLElement[] =>
	Array.from(container.querySelectorAll('[data-slot="on-time-compare-row"]')).filter(
		(el) => el.getAttribute('data-prior') === prior,
	) as HTMLElement[];

const mount = (punctuality: PunctualityVM, mode: 'day' | 'week' | 'month' = 'week') =>
	render(Section1WhenToRide, {
		props: {
			punctuality,
			habits: emptyHabits,
			locale: 'en' as const,
			copy: reliabilityCopy.en,
			mode,
		},
	});

describe('Section1WhenToRide — on-time vs prior (PR-WEB-3)', () => {
	const byShift: PeriodComparisonRow[] = [
		row('am_peak', 89, 2137, 1902, 84, 2183), // +5, large n → SIGNIFICANT improvement
		row('midday', 90, 40, 36, 85, 40), // +5 but n=40 → within noise (not significant)
		row('pm_peak', 81, 4529, 3669, 90, 4400), // −9, large n → SIGNIFICANT regression
		row('night', 90, 50, 45, null, null), // no prior → honest absence
	];

	it('renders a significant improvement as "+5 pts vs prior week" with the change state', () => {
		const { container } = mount(vm(byShift, [], true));
		const changed = rowsByState(container, 'change');
		const improve = changed.find((el) => el.textContent?.includes('+5'));
		expect(improve).toBeTruthy();
		expect(improve?.textContent).toContain('+5 pts');
		expect(improve?.textContent).toContain('vs prior week');
		expect(improve?.textContent).toContain('▲');
	});

	it('renders a significant regression as a negative "-9 pts" change', () => {
		const { container } = mount(vm(byShift, [], true));
		const regress = rowsByState(container, 'change').find((el) => el.textContent?.includes('-9'));
		expect(regress?.textContent).toContain('-9 pts');
		expect(regress?.textContent).toContain('▼');
	});

	it('renders a real-but-insignificant swing as neutral "within noise" (no number)', () => {
		const { container } = mount(vm(byShift, [], true));
		const noise = rowsByState(container, 'noise');
		expect(noise.length).toBe(1);
		expect(noise[0].textContent).toContain('within noise');
		expect(noise[0].textContent).not.toContain('+5');
		expect(noise[0].textContent).toContain('·');
	});

	it('renders an honest absence ("no prior week") when there is no prior window', () => {
		const { container } = mount(vm(byShift, [], true));
		const absent = rowsByState(container, 'absent');
		expect(absent.length).toBe(1);
		expect(absent[0].textContent).toContain('no prior week');
		expect(absent[0].textContent).not.toContain('pts');
	});

	it('names the window per grain ("vs prior month" on the month grain)', () => {
		const { container } = mount(vm([row('am_peak', 89, 2137, 1902, 84, 2183)], [], true), 'month');
		expect(container.querySelector('[data-slot="on-time-vs-prior"]')?.textContent).toContain(
			'vs prior month',
		);
	});

	it('uses the singular unit on a ±1-point move ("+1 pt", never "+1 pts")', () => {
		// +1 pt at n≈80k is a real (significant) difference — the unit must read singular.
		const { container } = mount(vm([row('am_peak', 86, 79256, 68160, 85, 80832)], [], true));
		const change = rowsByState(container, 'change')[0];
		expect(change?.textContent).toContain('+1 pt');
		expect(change?.textContent).not.toContain('+1 pts');
	});

	it('HIDES the comparison entirely when the breakdowns are not windowed (no prior to compare)', () => {
		const { container } = mount(vm(byShift, [], false));
		expect(container.querySelector('[data-slot="on-time-vs-prior"]')).toBeNull();
	});
});
