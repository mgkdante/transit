import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MapFeedStallBanner from './MapFeedStallBanner.svelte';

describe('MapFeedStallBanner', () => {
	const staleUtc = new Date(Date.now() - 5 * 60_000).toISOString();

	it.each([
		{ locale: 'en', message: 'Data may be out of date.' },
		{ locale: 'fr', message: 'Les données peuvent ne plus être à jour.' },
	] as const)(
		'renders the unknown-age warning in $locale without inventing a last-update time',
		({ locale, message }) => {
			render(MapFeedStallBanner, {
				props: { generatedUtc: null, ageSeconds: null, isStale: true, locale },
			});
			expect(screen.getByRole('status')).toHaveTextContent(message);
			expect(screen.getByRole('status')).not.toHaveTextContent(/Last update|Dernière mise à jour/);
		},
	);

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

	it('keeps the unavailable-family copy ahead of a global unknown-age warning', () => {
		const message = 'Live vehicle positions unavailable right now. The map and stops still work.';
		render(MapFeedStallBanner, {
			props: {
				generatedUtc: null,
				ageSeconds: null,
				isStale: true,
				locale: 'en',
				liveEdgeState: 'unavailable',
				liveEdgeMessage: message,
			},
		});
		expect(screen.getByRole('status')).toHaveAttribute('data-state', 'unavailable');
		expect(screen.getByRole('status')).toHaveTextContent(message);
	});

	it('uses the unknown-age copy for an implausibly future timestamp when age is not supplied', () => {
		render(MapFeedStallBanner, {
			props: { generatedUtc: '2099-01-01T00:00:00Z', isStale: true, locale: 'en' },
		});
		expect(screen.getByRole('status')).toHaveTextContent('Data may be out of date.');
		expect(screen.getByRole('status')).not.toHaveTextContent('Last update');
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
