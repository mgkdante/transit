import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

	it('keeps one empty announcement region mounted while the live feed is fresh (EN)', () => {
		render(MapFeedStallBanner, {
			props: {
				generatedUtc: new Date().toISOString(),
				ageSeconds: 12,
				isStale: false,
				locale: 'en',
			},
		});

		// WHY(M1 #34): the feed-stall banner now owns the one stable announcement
		// region shared by family failures, global stalls, and live-edge recovery.
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

		// WHY(M1 #34): mounting once avoids competing polite regions and guarantees
		// later priority changes update the same assistive-technology announcement.
		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});

	// M6f-2 F14. The banner used to OWN the control row's anchor and merely dodge
	// near-me on the right — which was only survivable because the Controls peel
	// was being hidden underneath it. The peel now survives a stall, so the banner
	// clears the whole row by stacking one control height (44px) plus this file's
	// own 10px gap above it, and spans the full row width again.
	it('stacks above the shared narrow control row instead of occupying its anchor', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFeedStallBanner.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-feed-stall\s*\{[^}]*bottom:\s*calc\(var\(--map-mobile-control-bottom\) \+ 44px \+ 10px\)/s,
		);
		// It no longer sits ON the peels' baseline, and no longer carves a hole for
		// near-me, because it is not in their row any more.
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
