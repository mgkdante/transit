import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import { presentationFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
import type { MapNoticeState } from '#lib/v1/live/livePresentation.ts';
import MapFeedStallBanner from './MapFeedStallBanner.svelte';

it.each<MapNoticeState>([
	'idle',
	'global-stall',
	'partial-stall',
	'selected-family-failure',
	'unavailable',
	'no-vehicles',
])('renders supplied %s state and message', async (bannerState) => {
	const presentation = presentationFixture({
		bannerState,
		notice: { kind: 'none', message: 'Supplied notice', body: '', tone: 'warning' },
	});
	const { rerender } = render(MapFeedStallBanner, { props: { presentation } });
	const region = screen.getByRole('status');
	expect(region).toHaveAttribute('data-state', bannerState);
	expect(region).toHaveTextContent('Supplied notice');
	expect(region).toHaveAttribute('aria-live', 'polite');
	expect(region.hasAttribute('data-slot')).toBe(
		bannerState === 'global-stall' || bannerState === 'partial-stall',
	);
	await rerender({ presentation: presentationFixture() });
	expect(screen.getByRole('status')).toBe(region);
	expect(region.textContent?.trim()).toBe('');
});
