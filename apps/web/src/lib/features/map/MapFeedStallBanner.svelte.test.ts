import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MapFeedStallBanner from './MapFeedStallBanner.svelte';

describe('MapFeedStallBanner', () => {
	const staleUtc = new Date(Date.now() - 5 * 60_000).toISOString();

	it('shows a polite top banner when the whole live feed has stalled (EN)', () => {
		render(MapFeedStallBanner, {
			props: { generatedUtc: staleUtc, ageSeconds: 300, isStale: true, locale: 'en' },
		});

		const banner = screen.getByRole('status');
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveTextContent('Live feed not responding');
		expect(banner).toHaveTextContent('5 minutes ago');
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

	it('keeps one empty announcement region mounted while the live feed is fresh (EN)', () => {
		render(MapFeedStallBanner, {
			props: {
				generatedUtc: new Date().toISOString(),
				ageSeconds: 12,
				isStale: false,
				locale: 'en',
			},
		});

		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});

	it('keeps one empty announcement region mounted while the live feed is fresh (FR)', () => {
		render(MapFeedStallBanner, {
			props: {
				generatedUtc: new Date().toISOString(),
				ageSeconds: 12,
				isStale: false,
				locale: 'fr',
			},
		});

		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});
});
