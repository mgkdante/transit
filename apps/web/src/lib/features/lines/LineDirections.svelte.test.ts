// LineDirections.svelte.test.ts — gate for the extracted bidirectional pane
// (slice-S6 de-monolith). Pins:
//   1. The clickable stops + live readout (the behaviour that lived in RouteDetail
//      before the extraction): each stop links to its detail page; a predicted
//      stop shows the approaching bus's reading; an unpredicted stop shows an
//      honest "no live bus", never a fabricated time.
//   2. The self-contained @container contract (the contract that moved here from
//      RouteDetail): container-type rides the PARENT .line-directions-pane and the
//      side-by-side grid targets the DESCENDANT .line-directions (never the same
//      element — the self-target trap).

import { render, screen } from '@testing-library/svelte';
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

// sA has an approaching bus (2 min late); sB has NONE → honest "no live bus".
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

	it('shows the approaching bus reading for a predicted stop and an honest no-live-bus otherwise', () => {
		render(LineDirections, {
			props: {
				directions: DIRECTIONS,
				predictions: PREDICTIONS,
				locale: 'en',
				copy: detailCopy.en,
			},
		});

		// sA has a bus 2 min late; sB has none → the honest placeholder, never a time.
		expect(screen.getByText('2 min late')).toBeInTheDocument();
		expect(screen.getByText('No live bus')).toBeInTheDocument();
	});

	it('renders nothing when the route carries no directions', () => {
		const { container } = render(LineDirections, {
			props: { directions: [], predictions: PREDICTIONS, locale: 'en', copy: detailCopy.en },
		});
		expect(container.querySelector('[data-slot="line-directions"]')).toBeNull();
	});
});

describe('LineDirections — self-contained @container contract', () => {
	// Container queries cannot be evaluated in jsdom, so we assert the STRUCTURE +
	// the CSS contract from source (the self-target-trap guard from the slice-9.8 E
	// lesson): container-type on the PARENT wrapper, the grid on the DESCENDANT.
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/features/lines/LineDirections.svelte'),
		'utf-8',
	);

	it('declares container-type on the parent pane and targets the descendant list', () => {
		// container-type rides .line-directions-pane (the PARENT)…
		expect(source).toMatch(/\.line-directions-pane\s*\{[^}]*container-type:\s*inline-size/);
		// …and the side-by-side layout targets the DESCENDANT .line-directions list.
		expect(source).toMatch(
			/@container line-directions \(min-width: 44rem\)\s*\{[\s\S]*?\.line-directions\s*\{[\s\S]*?grid-template-columns/,
		);
		// The .line-directions list is NOT the element declaring the container.
		expect(source).not.toMatch(/\.line-directions\s*\{[^}]*container-type/);
	});
});
