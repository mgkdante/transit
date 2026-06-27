import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteReliability, IsoUtc } from '$lib/v1';

// Seed the grain rail from ?grain on load (the read direction of Feature A). Mock the SvelteKit page
// URL (mutable per-test) + a no-op replaceState so the seed + availability clamp run in isolation.
let mockUrl = new URL('http://localhost/lines/51');
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mockUrl;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));

import RouteReliabilityClusters from './RouteReliabilityClusters.svelte';

const utc = (v: string): IsoUtc => v as IsoUtc;

// day + week periods only (NO month) with distinct OTP, so the seeded grain is observable via the
// structure-independent active-window caption and the month-clamp can be exercised.
const data: RouteReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '51',
	periods: [
		{ grain: 'day', date: '2026-06-18', otp_pct: 82, observation_count: 900, on_time: 738 },
		{ grain: 'week', otp_pct: 71, observation_count: 5400, on_time: 3834 },
	],
};

const caption = (c: HTMLElement): string =>
	c.querySelector('[data-slot="active-window"]')?.textContent?.trim() ?? '';

describe('RouteReliabilityClusters — ?grain seed + availability clamp (S7-B PR-WEB-2)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/lines/51');
	});

	it('seeds the rail from ?grain=week (a different window than the day default)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=week');
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		const weekCaption = caption(container);

		mockUrl = new URL('http://localhost/lines/51'); // default = day
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(weekCaption).not.toBe(caption(dflt)); // the seed took effect (week != day)
		expect(weekCaption.length).toBeGreaterThan(0);
	});

	it('clamps an UNAVAILABLE seeded grain to day (the URL is a hint, not a data source)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=month'); // data carries NO month period
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		const clamped = caption(container);

		mockUrl = new URL('http://localhost/lines/51'); // the genuine day default
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(clamped).toBe(caption(dflt)); // clamped back to day, not stuck on an empty month
	});

	it('falls back to day for an unknown ?grain value', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=bogus');
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		mockUrl = new URL('http://localhost/lines/51');
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(caption(container)).toBe(caption(dflt));
	});
});
