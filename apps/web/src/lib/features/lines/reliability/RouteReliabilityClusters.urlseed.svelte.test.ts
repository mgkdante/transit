import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteReliability, IsoUtc } from '$lib/v1';

// Seed the grain rail from ?grain on load (the read direction of Feature A) + mirror it back (the
// write direction). Mock the SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the
// seed, the availability clamp, AND the round-trip mirror (incl. the day default-omit) are testable.
let mockUrl = new URL('http://localhost/lines/51');
// vi.hoisted runs ABOVE the hoisted vi.mock factories, so `replaceState` is initialized before the
// $app/navigation factory references it (a plain `const` would hit the temporal dead zone). The spy
// updates mockUrl on each call so the round-trip mirror (read page.url -> write -> read) is testable.
const replaceState = vi.hoisted(() =>
	vi.fn((u: string | URL) => {
		mockUrl = new URL(u, 'http://localhost');
	}),
);
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mockUrl;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState }));

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

const radioByText = (c: HTMLElement, needle: string): HTMLElement | undefined =>
	Array.from(c.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) =>
		(el.textContent ?? '').toLowerCase().includes(needle),
	);

describe('RouteReliabilityClusters — ?grain seed + availability clamp (S7-B PR-WEB-2)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/lines/51');
		replaceState.mockClear();
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

	it('falls back to day for an unknown ?grain value (readGrain enum-validates the hint)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=bogus');
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		mockUrl = new URL('http://localhost/lines/51');
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(caption(container)).toBe(caption(dflt));
		// Pin the readGrain enum guard directly (the caption alone is a catch-all): exactly one
		// segment is checked, and it is the 'Today' (day) default — NOT a stuck 'bogus' viewKey that
		// would leave the radiogroup with ZERO checked chips.
		const checked = container.querySelectorAll('[role="radio"][aria-checked="true"]');
		expect(checked.length).toBe(1);
		expect(checked[0].textContent?.toLowerCase()).toContain('today');
	});

	it('mirrors a grain change to ?grain AND OMITS the day default (clean canonical URL)', async () => {
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		// default render at day on a clean URL writes nothing (idempotent default-omit).
		expect(replaceState).not.toHaveBeenCalled();

		const week = radioByText(container, 'week');
		expect(week).toBeDefined();
		await fireEvent.click(week!);
		expect(mockUrl.searchParams.get('grain')).toBe('week'); // change → mirrored

		const day = radioByText(container, 'today') ?? radioByText(container, 'day');
		expect(day).toBeDefined();
		await fireEvent.click(day!);
		// back to the default → ?grain is DELETED, never written as grain=day (a
		// `mirrorSearchParam('grain', mode)` mutation that drops the default-omit would break this).
		expect(mockUrl.searchParams.get('grain')).toBeNull();
	});
});
