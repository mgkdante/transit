import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

	it('stacks above the shared narrow control row instead of occupying its anchor', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFeedStallBanner.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-feed-stall\s*\{[^}]*bottom:\s*calc\(var\(--map-mobile-control-bottom\) \+ 44px \+ 10px\)/s,
		);
		expect(source).not.toMatch(
			/\.map-feed-stall\s*\{[^}]*bottom:\s*var\(--map-mobile-control-bottom\);/s,
		);
		expect(source).not.toContain('calc(0.75rem + 44px + 10px)');
		expect(source).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-feed-stall\s*\{[^}]*right:\s*0\.75rem/s,
		);
		expect(source).toMatch(/\.map-live-edge\s*\{[^}]*pointer-events:\s*none/s);
	});
});
