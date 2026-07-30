import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import MapFeedStallBanner from './MapFeedStallBanner.svelte';
import { copy as MAP_COPY } from './map.copy';

const generatedUtc = '2026-07-30T12:00:00Z';

describe('map live announcement priority', () => {
	it('prefers a selected-family failure over a simultaneous global stall and live edge', () => {
		const selectedFamilyFailureMessage = MAP_COPY.en.selectedFamilyFailure(
			MAP_COPY.en.familyTrips,
			true,
		);
		render(MapFeedStallBanner, {
			props: {
				generatedUtc,
				ageSeconds: 300,
				isStale: true,
				locale: 'en',
				selectedFamilyFailureMessage,
				liveEdgeState: 'unavailable',
				liveEdgeMessage: MAP_COPY.en.liveUnavailable,
			},
		});

		const region = screen.getByRole('status');
		expect(region).toHaveAttribute('data-state', 'selected-family-failure');
		expect(region).toHaveTextContent(selectedFamilyFailureMessage);
		expect(region).not.toHaveTextContent('Live feed not responding');
		expect(region).not.toHaveTextContent(MAP_COPY.en.liveUnavailable);
	});

	it('prefers the global stall over a lower-priority live edge', () => {
		render(MapFeedStallBanner, {
			props: {
				generatedUtc,
				ageSeconds: 300,
				isStale: true,
				locale: 'en',
				liveEdgeState: 'unavailable',
				liveEdgeMessage: MAP_COPY.en.liveUnavailable,
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
