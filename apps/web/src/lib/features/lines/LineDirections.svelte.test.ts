// Container-type belongs on the parent; the grid query targets a descendant.

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { RouteFile, StopPrediction } from '$lib/v1';
import LineDirections from './LineDirections.svelte';
import { detailCopy } from './lines.copy';

const DIRECTIONS: RouteFile['directions'] = [
	{
		dir: 0,
		headsign: 'Eastbound',
		stops: [
			{ id: 'sA', seq: 1, name: 'First stop' },
			{ id: 'sB', seq: 2, name: 'Second stop' },
		],
	},
];

const PREDICTIONS = new Map<string, StopPrediction>([
	['sA', { etaUtc: '2026-06-15T12:05:00Z', delayMin: 2 }],
]);

describe('LineDirections', () => {
	it.each(['en', 'fr'] as const)(
		'preserves prediction delay and explains an absent prediction in %s',
		(locale) => {
			render(LineDirections, {
				props: {
					directions: DIRECTIONS,
					predictions: PREDICTIONS,
					locale,
					copy: detailCopy[locale],
				},
			});

			expect(
				screen.getByText(locale === 'en' ? '2 min late' : '2 min en retard'),
			).toBeInTheDocument();
			const stop = screen.getByRole('link', { name: detailCopy[locale].viewStop('Second stop') });
			const empty = stop.querySelector('[data-slot="absent-value"]');
			expect(empty).toHaveAttribute('data-presentation', 'row');
			expect(empty).toHaveAttribute(
				'aria-label',
				locale === 'en'
					? 'No estimate, no prediction available'
					: 'Aucune estimation, aucune prévision disponible',
			);
			expect(within(stop).queryByText(/No live bus|Aucun bus en direct/)).toBeNull();
			expect(stop.querySelector('time')).toBeNull();
		},
	);

	it('renders nothing when the route carries no directions', () => {
		const { container } = render(LineDirections, {
			props: { directions: [], predictions: PREDICTIONS, locale: 'en', copy: detailCopy.en },
		});
		expect(container.querySelector('[data-slot="line-directions"]')).toBeNull();
	});
});
