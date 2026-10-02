// Container-type belongs on the parent; the grid query targets a descendant.

import { render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
	it('renders each stop as a link to its detail page', () => {
		render(LineDirections, {
			props: {
				directions: DIRECTIONS,
				predictions: PREDICTIONS,
				locale: 'en',
				copy: detailCopy.en,
			},
		});

		expect(screen.getByRole('link', { name: 'View stop First stop' })).toHaveAttribute(
			'href',
			'/stop/sA',
		);
		expect(screen.getByRole('link', { name: 'View stop Second stop' })).toHaveAttribute(
			'href',
			'/stop/sB',
		);
	});

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

describe('LineDirections — self-contained @container contract', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/features/lines/LineDirections.svelte'),
		'utf-8',
	);

	it('declares container-type on the parent pane and targets the descendant list', () => {
		expect(source).toMatch(/\.line-directions-pane\s*\{[^}]*container-type:\s*inline-size/);
		expect(source).toMatch(
			/@container line-directions \(min-width: 44rem\)\s*\{[\s\S]*?\.line-directions\s*\{[\s\S]*?grid-template-columns/,
		);
		expect(source).not.toMatch(/\.line-directions\s*\{[^}]*container-type/);
	});
});
