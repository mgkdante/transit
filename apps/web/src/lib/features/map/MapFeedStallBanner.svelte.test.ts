import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MapFeedStallBanner from './MapFeedStallBanner.svelte';

describe('MapFeedStallBanner', () => {
	// A build a few minutes old: the relative age reads "minutes ago" in either
	// language regardless of the exact wall-clock at test time.
	const staleUtc = new Date(Date.now() - 5 * 60_000).toISOString();

	it('shows a polite top banner when the whole live feed has stalled (EN)', () => {
		render(MapFeedStallBanner, {
			props: { generatedUtc: staleUtc, ageSeconds: 300, isStale: true, locale: 'en' },
		});

		const banner = screen.getByRole('status');
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveTextContent('Live feed not responding');
		// The last-update age is interpolated in.
		expect(banner).toHaveTextContent('5 minutes ago');
		// Informational, not an alert.
		expect(banner.getAttribute('aria-live')).toBe('polite');
		expect(banner.getAttribute('role')).toBe('status');
	});

	it('shows a polite top banner when the whole live feed has stalled (FR)', () => {
		render(MapFeedStallBanner, {
			props: { generatedUtc: staleUtc, ageSeconds: 300, isStale: true, locale: 'fr' },
		});

		const banner = screen.getByRole('status');
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveTextContent('ne répond pas');
		expect(banner).toHaveTextContent('il y a 5 minutes');
		expect(banner.getAttribute('aria-live')).toBe('polite');
	});

	it('renders nothing while the live feed is fresh (EN)', () => {
		render(MapFeedStallBanner, {
			props: {
				generatedUtc: new Date().toISOString(),
				ageSeconds: 12,
				isStale: false,
				locale: 'en',
			},
		});

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('renders nothing while the live feed is fresh (FR)', () => {
		render(MapFeedStallBanner, {
			props: {
				generatedUtc: new Date().toISOString(),
				ageSeconds: 12,
				isStale: false,
				locale: 'fr',
			},
		});

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});
});
