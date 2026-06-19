// Cluster01Punctuality.svelte.test.ts — the "01 Punctuality" band's contract:
//   1. a populated VM → headline numbers + the weakest-stops accountability
//      list render, worst delay first; no empty note.
//   2. an empty VM → the honest empty/no-data note renders, no crash, and the
//      headline + accountability list are absent.

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Cluster01Punctuality from './Cluster01Punctuality.svelte';
import { reliabilityCopy } from './reliability.copy';
import type { PunctualityVM } from './clusters';

const copy = reliabilityCopy.en;

const populated: PunctualityVM = {
	periods: [
		{ grain: 'week', otp_pct: 71, avg_delay_min: 3.2, p50_min: 1.0, p90_min: 8.4, severe_pct: 4 },
		{ grain: 'day', otp_pct: 82, avg_delay_min: 2.1, p50_min: 0.5, p90_min: 6.0, severe_pct: 3 },
		{ grain: 'month', otp_pct: 68, avg_delay_min: 3.9, p50_min: 1.2, p90_min: 9.1, severe_pct: 5 },
	],
	dayOfWeek: [{ day_of_week_iso: 1, avg_delay_min: 1.8, observation_count: 100 }],
	weakStops: [
		{ id: 'S1', name: 'Van Horne', avg_delay_min: 3.7 },
		{ id: 'S2', name: 'Côte-des-Neiges', avg_delay_min: 6.4 },
	],
	isEmpty: false,
};

const emptyVM: PunctualityVM = {
	periods: [],
	dayOfWeek: [],
	weakStops: [],
	isEmpty: true,
};

describe('Cluster01Punctuality — populated', () => {
	it('renders the selected-grain headline (default day) and no empty note', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });

		// Headline OTP for grain 'day' = 82%.
		expect(screen.getByText('82%')).toBeInTheDocument();
		// Avg delay for the day period.
		expect(screen.getByText('2.1 min')).toBeInTheDocument();
		// No honest-empty note when there is data.
		expect(screen.queryByTestId('punctuality-empty')).not.toBeInTheDocument();
	});

	it('ranks the weakest stops worst-delay first (accountability)', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });

		// Both stops present, worst (6.4 min) ranked #1 above the milder one.
		const worst = screen.getByText('Côte-des-Neiges');
		const milder = screen.getByText('Van Horne');
		expect(worst).toBeInTheDocument();
		expect(milder).toBeInTheDocument();
		expect(worst.compareDocumentPosition(milder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('Cluster01Punctuality — honest empty', () => {
	it('renders the no-data note and no headline when the VM is empty', () => {
		render(Cluster01Punctuality, { props: { vm: emptyVM, locale: 'en', copy } });

		const note = screen.getByTestId('punctuality-empty');
		expect(note).toBeInTheDocument();
		expect(note).toHaveTextContent(copy.strip.noDataNote);
		// Cluster overline still present; the section is labelled, not dropped.
		const section = screen.getByRole('region', { name: copy.clusters.punctuality });
		expect(within(section).queryByText('82%')).not.toBeInTheDocument();
	});
});
