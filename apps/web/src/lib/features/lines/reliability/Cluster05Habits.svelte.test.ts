// Cluster05Habits.svelte.test.ts — DOM gate for the 05 Time-of-day habits band.
//
// Two cases per the slice contract:
//   1. POPULATED — a habit matrix + weekday rows render the heatmap (role=img /
//      role=group) and the weekday ranked list, without crashing.
//   2. HONEST EMPTY — an empty VM + no weekday rows render the explicit no-data
//      note and NEITHER data sub-section (no fabricated zero, no dropped band).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Cluster05Habits from './Cluster05Habits.svelte';
import { reliabilityCopy } from './reliability.copy';
import { habitsBandCopy } from './Cluster05Habits.copy';
import type { HabitsVM } from './clusters';
import type { RouteDayOfWeek } from '$lib/v1';

const enCopy = reliabilityCopy.en;
const enBand = habitsBandCopy.en;

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
