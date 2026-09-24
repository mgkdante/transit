import { render, fireEvent, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Section1WhenToRide from './Section1WhenToRide.svelte';
import { reliabilityCopy } from '../reliability.copy';
import type { PunctualityVM, PeriodComparisonRow, HabitsVM } from '../clusters';

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
	priorOnTime: null,
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

const mount = async (
	punctuality: PunctualityVM,
	mode: 'day' | 'week' | 'month' = 'week',
	locale: 'en' | 'fr' = 'en',
) => {
	const view = render(Section1WhenToRide, {
		props: {
			punctuality,
			habits: emptyHabits,
			locale,
			copy: reliabilityCopy[locale],
			mode,
		},
	});
	await fireEvent.click(
		view.getByRole('button', { name: reliabilityCopy[locale].sections.detailShow }),
	);
	return view;
};

describe('Section1WhenToRide observed prior-window differences', () => {
	const byShift: PeriodComparisonRow[] = [
		row('am_peak', 90, 40000, 36000, 85, 40000),
		row('midday', 90, 40, 36, 85, 40),
		row('pm_peak', 81, 40, 32, 90, 40),
		row('night', 90, 50, 45, null, null),
	];

	it('shows the same +5-point observation at large and small sample sizes', async () => {
		const { container } = await mount(vm(byShift.slice(0, 2), [], true));
		const changed = rowsByState(container, 'change');
		expect(changed).toHaveLength(2);
		for (const element of changed) {
			expect(element.textContent).toContain('+5 pts');
			expect(element.textContent).toContain('vs prior week');
			expect(element.textContent).toContain('▲');
		}
		const caption = container.querySelector('[data-slot="on-time-vs-prior-caption"]')?.textContent;
		expect(caption).toContain('Feed coverage');
		expect(container.textContent).not.toMatch(/95%|significan|within noise/i);
	});

	it('shows a decrease without requiring a significance verdict', async () => {
		const { container } = await mount(vm([byShift[2]], [], true));
		const change = rowsByState(container, 'change')[0];
		expect(change?.textContent).toContain('-9 pts');
		expect(change?.textContent).toContain('▼');
	});

	it('keeps measured zero distinct from an absent prior window, including accessible text', async () => {
		const { container } = await mount(
			vm([row('midday', 90, 40, 36, 90, 40), byShift[3]], [], true),
		);
		const flat = rowsByState(container, 'flat')[0];
		const absent = rowsByState(container, 'absent')[0];
		expect(flat?.textContent).toContain('0 pts');
		expect(flat?.textContent).toContain('vs prior week');
		expect(flat?.textContent).not.toMatch(/[▲▼]/);
		expect(absent?.textContent).toContain('no prior week');
		expect(absent?.textContent).not.toContain('pts');
		const aria = (element: Element) =>
			element.querySelector('[data-slot="delta-stat"]')?.getAttribute('aria-label');
		expect(aria(flat)).toMatch(/0 pts.*midday.*vs prior week/i);
		expect(aria(absent)).toMatch(/night.*no prior week/i);
	});

	it.each(['day', 'week', 'month'] as const)(
		'identifies the %s comparison window',
		async (mode) => {
			const { container } = await mount(vm([byShift[0]], [], true), mode);
			expect(rowsByState(container, 'change')[0]?.textContent).toContain(`vs prior ${mode}`);
		},
	);

	it('uses singular percentage points on a one-point change', async () => {
		const { container } = await mount(vm([row('am_peak', 86, 40, 34, 85, 40)], [], true));
		const text = rowsByState(container, 'change')[0]?.textContent;
		expect(text).toContain('+1 pt');
		expect(text).not.toContain('+1 pts');
	});

	it('omits comparisons when the source breakdown is not windowed', async () => {
		const { container } = await mount(vm(byShift, [], false));
		expect(container.querySelector('[data-slot="on-time-vs-prior"]')).toBeNull();
	});

	it('explains descriptive changes and absent prior windows in French', async () => {
		const { container } = await mount(vm([byShift[1], byShift[3]], [], true), 'week', 'fr');
		expect(rowsByState(container, 'change')[0]?.textContent).toContain('+5 pts');
		expect(rowsByState(container, 'absent')[0]?.textContent).toContain('pas de semaine précédente');
		expect(
			container.querySelector('[data-slot="on-time-vs-prior-caption"]')?.textContent,
		).toContain('couverture');
		expect(container.textContent).not.toMatch(/95\s*%|significati|bruit/i);
	});
});

describe('Section1WhenToRide relative heatmap meaning', () => {
	it.each(['en', 'fr'] as const)(
		'keeps relative bands and missing values aligned in %s',
		async (locale) => {
			const matrix: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
			matrix[0].splice(0, 8, 0, 0.2499, 0.25, 0.5, 0.7499, 0.75, 1, null);
			const { container } = render(Section1WhenToRide, {
				props: {
					punctuality: vm([], [], false),
					habits: { scale: 'repeat_problem_relative', matrix, isEmpty: false },
					locale,
					copy: reliabilityCopy[locale],
					mode: 'day',
				},
			});
			const block = container.querySelector('[data-slot="habits-heatmap"]') as HTMLElement;
			const labels =
				locale === 'en'
					? [
							'Low relative score',
							'Moderate relative score',
							'High relative score',
							'Very high relative score',
						]
					: [
							'Score relatif faible',
							'Score relatif modéré',
							'Score relatif élevé',
							'Score relatif très élevé',
						];
			const cells = [...block.querySelectorAll('table tbody tr:first-child td')]
				.slice(0, 8)
				.map((cell) => cell.textContent?.trim());
			expect
				.soft(cells)
				.toEqual([
					labels[0],
					labels[0],
					labels[1],
					labels[2],
					labels[2],
					`◆ ${labels[3]}`,
					`◆ ${labels[3]}`,
					locale === 'en' ? 'No data' : 'Aucune donnée',
				]);
			const caption = block.querySelector('[data-slot="habits-scale-caption"]')?.textContent ?? '';
			expect.soft(caption).toMatch(locale === 'en' ? /0.75.*maximum/ : /0,75.*maximum/);
			expect.soft(caption).not.toMatch(/how often|rarely see|fréquence.*reviennent/);
			const legendLabels = [...block.querySelectorAll('[data-slot="chart-legend"] li')].map(
				(item) => item.textContent?.trim(),
			);
			expect
				.soft(legendLabels)
				.toEqual([
					...labels.slice(0, 3),
					`${labels[3]} ◆`,
					locale === 'en' ? 'No data' : 'Aucune donnée',
				]);
			await fireEvent.click(within(block).getByRole('button', { name: /about|propos/i }));
			const help = block.querySelector('.metric-info__tip')?.textContent ?? '';
			expect.soft(help).toMatch(locale === 'en' ? /relative score/i : /score relatif/i);
		},
	);
});
