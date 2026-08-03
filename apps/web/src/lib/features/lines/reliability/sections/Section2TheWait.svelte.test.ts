import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Section2TheWait from './Section2TheWait.svelte';
import { reliabilityCopy } from '../reliability.copy';
import type { WaitRegularityVM } from '../clusters';
import type { HeadwayPeriod } from '$lib/v1';

// PR-WEB-3 §2 wait-by-shift · vs-prior comparison. The shared-CoV two-sample math is unit-
// tested in selectors/priorDelta.test.ts; THIS pins the section WIRING: the windowed gate,
// the change / noise / honest-absence states, and the Δ-vs-prior wait badge (minutes).

const hw = (
	shift: string,
	observed: number | null,
	obs: number | null,
	cov: number | null,
	priorObserved: number | null,
	priorObs: number | null,
): HeadwayPeriod => ({
	shift,
	direction_id: null,
	day_type: null,
	scheduled_min: 10,
	observed_min: observed,
	excess_wait_min: observed != null ? Math.max(0, observed - 10) : null,
	cov,
	bunched_pct: 10,
	observation_count: obs,
	prior_observation_count: priorObs,
	prior_observed_min: priorObserved,
});

const waitVm = (headway: HeadwayPeriod[], windowed: boolean): WaitRegularityVM => ({
	headway,
	windowed,
	isEmpty: headway.length === 0,
});

const directionHw = (
	shift: string,
	directionId: 0 | 1,
	dayType: 'weekday' | 'weekend',
	observed: number,
): HeadwayPeriod => ({
	...hw(shift, observed, 30, 0.25, null, null),
	direction_id: directionId,
	day_type: dayType,
});

const rowsByState = (container: HTMLElement, prior: string): HTMLElement[] =>
	Array.from(container.querySelectorAll('[data-slot="wait-compare-row"]')).filter(
		(el) => el.getAttribute('data-prior') === prior,
	) as HTMLElement[];

const mount = (wait: WaitRegularityVM, mode: 'day' | 'week' | 'month' = 'week') =>
	render(Section2TheWait, {
		props: { wait, locale: 'en' as const, copy: reliabilityCopy.en, mode },
	});

describe('Section2TheWait — wait vs prior (PR-WEB-3)', () => {
	const headway: HeadwayPeriod[] = [
		hw('am_peak', 18, 60, 0.2, 9, 60), // +9 min, healthy n → SIGNIFICANT (a rising wait is bad)
		hw('midday', 29.4, 20, 0.39, 29.2, 24), // +0.2 min, sparse + jittery → within noise
		hw('night', 21, 30, 0.3, null, null), // no prior → honest absence
	];

	it('renders a significant wait increase as "+9.0 min vs prior week", flagged regression', () => {
		const { container } = mount(waitVm(headway, true));
		const changed = rowsByState(container, 'change');
		const worse = changed.find((el) => el.textContent?.includes('+9.0'));
		expect(worse?.textContent).toContain('+9.0 min');
		expect(worse?.textContent).toContain('vs prior week');
		// a RISING wait is the bad direction → the regression glyph, not the improvement one.
		expect(worse?.textContent).toContain('▲');
	});

	it('renders a sub-minute jitter as neutral "within noise"', () => {
		const { container } = mount(waitVm(headway, true));
		const noise = rowsByState(container, 'noise');
		expect(noise.length).toBe(1);
		expect(noise[0].textContent).toContain('within noise');
		expect(noise[0].textContent).not.toContain('+0.2');
	});

	it('renders an honest absence ("no prior week") when there is no prior window', () => {
		const { container } = mount(waitVm(headway, true));
		const absent = rowsByState(container, 'absent');
		expect(absent.length).toBe(1);
		expect(absent[0].textContent).toContain('no prior week');
	});

	it('HIDES the comparison when the headway breakdown is not windowed', () => {
		const { container } = mount(waitVm(headway, false));
		expect(container.querySelector('[data-slot="wait-vs-prior"]')).toBeNull();
	});
});

describe('Section2TheWait — direction DataTable contract', () => {
	const headway: HeadwayPeriod[] = [
		hw('am_peak', 10, 80, 0.2, 9, 70),
		directionHw('am_peak', 0, 'weekday', 8.5),
		directionHw('am_peak', 1, 'weekday', 12.25),
		directionHw('am_peak', 0, 'weekend', 10.75),
	];

	it('names the table and keeps scoped, localized mobile labels reactive', async () => {
		const wait = waitVm(headway, true);
		const view = render(Section2TheWait, {
			props: { wait, locale: 'en' as const, copy: reliabilityCopy.en, mode: 'week' },
		});
		await fireEvent.click(view.getByRole('button', { name: 'Show the detail' }));

		const table = view.getByRole('table', { name: 'Observed gap by direction' });
		expect(table.querySelectorAll('caption')).toHaveLength(1);
		expect(table.querySelector('caption')).toHaveTextContent('Observed gap by direction');
		expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
		expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(2);
		const absent = table.querySelector('[data-slot="absent-value"]');
		expect(absent).toHaveAttribute('data-density', 'row');
		expect(absent?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'No data · not enough readings yet',
		);

		for (const row of table.querySelectorAll('tbody tr')) {
			const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));
			expect(cells.map((cell) => cell.getAttribute('data-col'))).toEqual([
				'Shift',
				'Direction 1',
				'Direction 2',
			]);
			for (const cell of cells) {
				expect(cell.querySelectorAll(':scope > .data-table-cell-content')).toHaveLength(1);
				expect(cell.children).toHaveLength(1);
			}
		}

		await view.rerender({
			wait,
			locale: 'fr',
			copy: reliabilityCopy.fr,
			mode: 'week',
		});

		const localized = view.getByRole('table', {
			name: 'Intervalle observé par direction',
		});
		const localizedAbsent = localized.querySelector('[data-slot="absent-value"]');
		expect(localizedAbsent).toHaveAttribute('data-density', 'row');
		expect(localizedAbsent?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Aucune donnée · pas assez de mesures',
		);
		expect(localized.querySelectorAll('caption')).toHaveLength(1);
		for (const row of localized.querySelectorAll('tbody tr')) {
			expect(
				Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
					cell.getAttribute('data-col'),
				),
			).toEqual(['Période', 'Direction 1', 'Direction 2']);
		}
	});
});
