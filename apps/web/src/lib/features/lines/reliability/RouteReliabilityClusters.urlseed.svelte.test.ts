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

// PR-WEB-4: ?from/?to custom-range deep-linking. 3 dated days so a real range exists; the active-
// window caption is the structure-independent probe (it names the resolved range vs the prompt).
const rangeData: RouteReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '51',
	periods: [
		{ grain: 'day', date: '2026-06-16', otp_pct: 80, observation_count: 900, on_time: 720 },
		{ grain: 'day', date: '2026-06-17', otp_pct: 82, observation_count: 900, on_time: 738 },
		{ grain: 'day', date: '2026-06-18', otp_pct: 84, observation_count: 900, on_time: 756 },
	],
};

describe('RouteReliabilityClusters — ?from/?to range deep-link (S7-B PR-WEB-4)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/lines/51');
		replaceState.mockClear();
	});

	it('seeds the custom range from ?grain=range&from=…&to=… (caption names the window)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-16&to=2026-06-18');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		const c = caption(container);
		expect(c).toContain('2026-06-16');
		expect(c).toContain('2026-06-18');
		expect(c.toLowerCase()).toContain('average across 3 days');
	});

	it('a COMPLETE from+to activates range even WITHOUT ?grain=range', () => {
		mockUrl = new URL('http://localhost/lines/51?from=2026-06-16&to=2026-06-18');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		expect(caption(container)).toContain('2026-06-16');
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('range');
	});

	it('EXPLICIT ?grain=range with an out-of-window bound → keeps the range prompt', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2020-01-01&to=2026-06-18');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		// EXPLICIT range intent (the ?grain=range token) → the window drops but range MODE stays,
		// showing the honest "pick a start and end date" prompt, never a fabricated 2020 window.
		expect(caption(container).toLowerCase()).toContain('pick a start and end date');
		expect(caption(container)).not.toContain('2020');
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('range');
	});

	// HIGH-2: a BARE ?from/?to (no explicit ?grain=range token) whose bounds fall OUTSIDE the
	// published window carries NO deliberate range intent. resolveWindow drops the window, and
	// because range was implied ONLY by window-presence, the rail reverts to the DAY view
	// (the old behaviour) — never a silent empty range prompt for a link that never said range.
	it('bare ?from/?to fully OUTSIDE the window → reverts to the day view (no range prompt)', () => {
		mockUrl = new URL('http://localhost/lines/51?from=2020-01-01&to=2020-01-05');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		mockUrl = new URL('http://localhost/lines/51'); // the genuine day default
		const { container: dflt } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		// Reverted to day: same caption as the clean day default, and the checked chip is 'Today'.
		expect(caption(container)).toBe(caption(dflt));
		expect(caption(container).toLowerCase()).not.toContain('pick a start and end date');
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('today');
	});

	// HIGH-2 companion: a bare ?from/?to with a PARTIALLY out-of-window bound (one real, one
	// bogus) also drops the whole window (resolveWindow is whole-window-or-nothing) and, with
	// no explicit token, reverts to day rather than a fabricated one-sided span.
	it('bare ?from/?to with one out-of-window bound → reverts to the day view', () => {
		mockUrl = new URL('http://localhost/lines/51?from=2026-06-16&to=2030-12-31');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('today');
		expect(caption(container).toLowerCase()).not.toContain('pick a start and end date');
	});

	it('mirrors from/to and CLEARS them when the rail leaves range mode', async () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-16&to=2026-06-18');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		const day = radioByText(container, 'today') ?? radioByText(container, 'day');
		await fireEvent.click(day!);
		// leaving range → ?from/?to deleted for a clean canonical URL.
		expect(mockUrl.searchParams.get('from')).toBeNull();
		expect(mockUrl.searchParams.get('to')).toBeNull();
		expect(mockUrl.searchParams.get('grain')).toBeNull(); // day default omitted too
	});

	it('does NOT leak a half-picked bound: a lone ?from is dropped from the URL', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-16');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		// an INCOMPLETE range (no `to`) never reaches the canonical URL — only a complete pair mirrors.
		expect(mockUrl.searchParams.get('from')).toBeNull();
		expect(mockUrl.searchParams.get('to')).toBeNull();
		expect(caption(container).toLowerCase()).toContain('pick a start and end date');
	});

	it('normalizes an inverted from>to in BOTH the URL and the caption', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-18&to=2026-06-16');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		// the mirror writes the sorted bounds so a shared link never reads backwards.
		expect(mockUrl.searchParams.get('from')).toBe('2026-06-16');
		expect(mockUrl.searchParams.get('to')).toBe('2026-06-18');
		expect(caption(container)).toContain('2026-06-16 to 2026-06-18');
	});
});
