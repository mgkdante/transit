import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import { presentationFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
import MapFeedStallBanner from './MapFeedStallBanner.svelte';
import { copy as MAP_COPY } from './map.copy';

describe('map live announcement priority', () => {
	it('renders a selected-family failure without adding a global stall or live edge', () => {
		const selectedFamilyFailureMessage = MAP_COPY.en.selectedFamilyFailure(
			MAP_COPY.en.familyTrips,
			true,
		);
		render(MapFeedStallBanner, {
			props: {
				presentation: presentationFixture({
					bannerState: 'selected-family-failure',
					notice: {
						kind: 'refresh-unavailable',
						message: selectedFamilyFailureMessage,
						body: '',
						tone: 'warning',
					},
				}),
			},
		});

		const region = screen.getByRole('status');
		expect(region).toHaveAttribute('data-state', 'selected-family-failure');
		expect(region).toHaveTextContent(selectedFamilyFailureMessage);
		expect(region).not.toHaveTextContent('Live feed not responding');
		expect(region).not.toHaveTextContent(MAP_COPY.en.liveUnavailable);
	});

	it('renders the supplied global stall without adding a live edge', () => {
		render(MapFeedStallBanner, {
			props: {
				presentation: presentationFixture({
					bannerState: 'global-stall',
					notice: {
						kind: 'whole-feed-stall',
						message: 'Live feed not responding',
						body: '',
						tone: 'warning',
					},
				}),
			},
		});

		const region = screen.getByRole('status');
		expect(region).toHaveAttribute('data-state', 'global-stall');
		expect(region).toHaveAttribute('data-slot', 'map-feed-stall');
		expect(region).toHaveTextContent('Live feed not responding');
		expect(region).not.toHaveTextContent(MAP_COPY.en.liveUnavailable);
	});

	it('registers distinct family-failure copy in English and French without em dashes', () => {
		const en = MAP_COPY.en.selectedFamilyFailure(MAP_COPY.en.familyDepartures, true);
		const fr = MAP_COPY.fr.selectedFamilyFailure(MAP_COPY.fr.familyDepartures, true);

		expect(en).toContain('departures');
		expect(en).toContain('last successful update');
		expect(fr).toContain('départs');
		expect(fr).toContain('dernière mise à jour réussie');
		expect(`${en}${fr}`).not.toContain('—');
	});
});
