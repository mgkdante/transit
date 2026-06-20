// Cluster05Habits.svelte.test.ts — DOM gate for the 05 Time-of-day habits band.
//
// Two cases per the slice contract:
//   1. POPULATED — a habit matrix + weekday rows render the heatmap (role=img /
//      role=group) and the weekday ranked list, without crashing.
//   2. HONEST EMPTY — an empty VM + no weekday rows render the explicit no-data
//      note and NEITHER data sub-section (no fabricated zero, no dropped band).

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Cluster05Habits from './Cluster05Habits.svelte';
import { reliabilityCopy } from './reliability.copy';
import { habitsBandCopy } from './Cluster05Habits.copy';
import { metricsCopy } from '$lib/features/metrics/metrics.copy';
import type { HabitsVM } from './clusters';
import type { RouteDayOfWeek } from '$lib/v1';

const enCopy = reliabilityCopy.en;
const enBand = habitsBandCopy.en;
const info = metricsCopy.en.info;

/** A 7×24 matrix with a couple of real cells, the rest null (no data). */
function populatedMatrix(): (number | null)[][] {
	const grid: (number | null)[][] = Array.from({ length: 7 }, () =>
		Array.from({ length: 24 }, () => null),
	);
	grid[0][8] = 0.9; // Mon 08:00 — a hot repeat-problem cell
	grid[0][17] = 0.6;
	grid[4][18] = 0.4; // Fri 18:00
	return grid;
}

const POPULATED_HABITS: HabitsVM = {
	scale: 'repeat_problem_relative',
	matrix: populatedMatrix(),
	isEmpty: false,
};

const POPULATED_DOW: RouteDayOfWeek[] = [
	{ day_of_week_iso: 1, avg_delay_min: 5.2 },
	{ day_of_week_iso: 3, avg_delay_min: 2.1 },
	{ day_of_week_iso: 5, avg_delay_min: 8.4 }, // worst → rank 1
];

const EMPTY_HABITS: HabitsVM = { scale: null, matrix: [], isEmpty: true };

describe('Cluster05Habits — populated', () => {
	it('renders the cluster overline, the heatmap, and the weekday ranked list', () => {
		const { container } = render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: POPULATED_DOW,
				locale: 'en',
				copy: enCopy,
			},
		});

		// Cluster overline (station voice).
		expect(screen.getByText(enCopy.clusters.habits)).toBeInTheDocument();

		// Heatmap sub-section is present + the primitive rendered an a11y region.
		expect(container.querySelector('[data-slot="habits-heatmap"]')).toBeInTheDocument();
		expect(screen.getByRole('group', { name: enBand.heatmapLabel })).toBeInTheDocument();

		// Weekday ranked list present, worst day (Friday, 8.4 min) ranked first.
		expect(container.querySelector('[data-slot="habits-weekday"]')).toBeInTheDocument();
		const rows = screen.getByRole('list', { name: enBand.weekdayHeading });
		expect(rows).toBeInTheDocument();
		expect(screen.getByText('Friday')).toBeInTheDocument();
		expect(screen.getByText('8.4 min')).toBeInTheDocument();

		// No fabricated empty note when data is present.
		expect(container.querySelector('[data-slot="habits-empty"]')).toBeNull();
	});

	it('renders a plain-language scale caption with the resolved (non-snake_case) phrase', () => {
		const { container } = render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: POPULATED_DOW,
				locale: 'en',
				copy: enCopy,
			},
		});
		const caption = container.querySelector('[data-slot="habits-scale-caption"]');
		expect(caption).toBeInTheDocument();
		// Plain-language phrase from scaleLegend, NOT the raw scale string.
		expect(caption?.textContent).toContain('Repeat problems');
		expect(caption?.textContent).not.toContain('repeat_problem_relative');
	});

	it('falls back to the heading (never the raw scale string) for an unmapped scale', () => {
		const { container } = render(Cluster05Habits, {
			props: {
				habits: { ...POPULATED_HABITS, scale: 'some_unknown_scale' },
				dayOfWeek: POPULATED_DOW,
				locale: 'en',
				copy: enCopy,
			},
		});
		const caption = container.querySelector('[data-slot="habits-scale-caption"]');
		expect(caption?.textContent).toContain(enBand.heatmapHeading);
		expect(caption?.textContent).not.toContain('some_unknown_scale');
	});

	it('reads cells as plain words + full day names, not raw normalized numbers', () => {
		render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: POPULATED_DOW,
				locale: 'en',
				copy: enCopy,
			},
		});
		// Mon 08:00 = grid[0][8] = 0.9, the sole real cell on row 0 → mid-ramp word.
		const hot = screen.getByRole('img', { name: /Monday 08:00/ });
		expect(hot).toBeInTheDocument();
		expect(hot.getAttribute('aria-label')).not.toContain('0.9');
	});

	it('renders the habits accumulation-window caption', () => {
		render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: POPULATED_DOW,
				locale: 'en',
				copy: enCopy,
			},
		});
		expect(screen.getByText(enCopy.windows.habits)).toBeInTheDocument();
	});

	it('surfaces day-of-week severe share as a second value gated by observation_count (A2)', () => {
		render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: [
					// well-sampled weekday → severe share is shown as the second reading.
					{ day_of_week_iso: 4, avg_delay_min: 6.1, severe_pct: 14.9, observation_count: 120 },
					// under-sampled weekday → severe share is WITHHELD (no fabricated number),
					// the row still ranks on its mean delay with the plain avg-delay caption.
					{ day_of_week_iso: 7, avg_delay_min: 9.2, severe_pct: 16.2, observation_count: 2 },
				],
				locale: 'en',
				copy: enCopy,
			},
		});

		// Well-sampled Thursday shows its severe share with the dedicated label.
		expect(screen.getByText(`${enCopy.peak.dayOfWeekSevere} 14.9%`)).toBeInTheDocument();
		// Under-sampled Sunday keeps the plain avg-delay caption (severe withheld).
		expect(screen.queryByText(`${enCopy.peak.dayOfWeekSevere} 16.2%`)).not.toBeInTheDocument();
		expect(screen.getByText(enBand.avgDelay)).toBeInTheDocument();
	});

	it('renders the FR canonical scale caption', () => {
		const { container } = render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: POPULATED_DOW,
				locale: 'fr',
				copy: reliabilityCopy.fr,
			},
		});
		expect(container.querySelector('[data-slot="habits-scale-caption"]')?.textContent).toContain(
			'Problèmes récurrents',
		);
	});

	it('renders the heatmap alone when weekday seasonality is empty', () => {
		const { container } = render(Cluster05Habits, {
			props: { habits: POPULATED_HABITS, dayOfWeek: [], locale: 'en', copy: enCopy },
		});
		expect(container.querySelector('[data-slot="habits-heatmap"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="habits-weekday"]')).toBeNull();
		expect(container.querySelector('[data-slot="habits-empty"]')).toBeNull();
	});

	it('drops weekday rows that carry no mean delay (no fabricated zero row)', () => {
		const { container } = render(Cluster05Habits, {
			props: {
				habits: EMPTY_HABITS,
				dayOfWeek: [
					{ day_of_week_iso: 2, avg_delay_min: 3.3 },
					{ day_of_week_iso: 6, avg_delay_min: null, observation_count: 0 },
				],
				locale: 'en',
				copy: enCopy,
			},
		});
		// Only the one real row renders.
		expect(screen.getByText('Tuesday')).toBeInTheDocument();
		expect(screen.queryByText('Saturday')).toBeNull();
		expect(container.querySelector('[data-slot="habits-heatmap"]')).toBeNull();
	});
});

describe('Cluster05Habits — honest empty', () => {
	it('renders the no-data note and no data sub-sections when the VM is empty', () => {
		const { container } = render(Cluster05Habits, {
			props: { habits: EMPTY_HABITS, dayOfWeek: [], locale: 'en', copy: enCopy },
		});

		const empty = container.querySelector('[data-slot="habits-empty"]');
		expect(empty).toBeInTheDocument();
		expect(empty?.textContent).toBe(enCopy.strip.noDataNote);

		// Neither data sub-section rendered.
		expect(container.querySelector('[data-slot="habits-heatmap"]')).toBeNull();
		expect(container.querySelector('[data-slot="habits-weekday"]')).toBeNull();
	});

	it('honours the French no-data note (FR is the canonical product voice)', () => {
		const { container } = render(Cluster05Habits, {
			props: { habits: EMPTY_HABITS, dayOfWeek: [], locale: 'fr', copy: reliabilityCopy.fr },
		});
		expect(container.querySelector('[data-slot="habits-empty"]')?.textContent).toBe(
			reliabilityCopy.fr.strip.noDataNote,
		);
	});
});

describe('Cluster05Habits — metric explainer (i)', () => {
	it('deep-links the heatmap (habits) + weekday seasonality (i) affordances', async () => {
		render(Cluster05Habits, {
			props: {
				habits: POPULATED_HABITS,
				dayOfWeek: POPULATED_DOW,
				locale: 'en',
				copy: enCopy,
			},
		});

		const heatmapTrigger = screen.getByRole('button', {
			name: info.trigger(enBand.heatmapHeading),
		});
		await fireEvent.click(heatmapTrigger);
		expect(screen.getByRole('link', { name: new RegExp(info.link, 'i') })).toHaveAttribute(
			'href',
			'/metrics#habits',
		);
		await fireEvent.click(heatmapTrigger);

		const weekdayTrigger = screen.getByRole('button', {
			name: info.trigger(enBand.weekdayHeading),
		});
		await fireEvent.click(weekdayTrigger);
		expect(screen.getByRole('link', { name: new RegExp(info.link, 'i') })).toHaveAttribute(
			'href',
			'/metrics#seasonality',
		);
	});
});
