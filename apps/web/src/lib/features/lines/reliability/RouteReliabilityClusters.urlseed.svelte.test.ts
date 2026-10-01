import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteReliability, IsoUtc } from '$lib/v1';

let mockUrl = new URL('http://localhost/lines/51');
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
vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history')),
	wilsonBounds: (await import('$lib/v1/stats')).wilsonBounds,
}));

import RouteReliabilityClusters from './RouteReliabilityClusters.svelte';

const utc = (v: string): IsoUtc => v as IsoUtc;

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

		mockUrl = new URL('http://localhost/lines/51');
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(weekCaption).not.toBe(caption(dflt));
		expect(weekCaption.length).toBeGreaterThan(0);
	});

	it('clamps an UNAVAILABLE seeded grain to day (the URL is a hint, not a data source)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=month');
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		const clamped = caption(container);

		mockUrl = new URL('http://localhost/lines/51');
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(clamped).toBe(caption(dflt));
	});

	it('falls back to day for an unknown ?grain value (readGrain enum-validates the hint)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=bogus');
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		mockUrl = new URL('http://localhost/lines/51');
		const { container: dflt } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(caption(container)).toBe(caption(dflt));
		const checked = container.querySelectorAll('[role="radio"][aria-checked="true"]');
		expect(checked.length).toBe(1);
		expect(checked[0].textContent?.toLowerCase()).toContain('latest day');
	});

	it('mirrors a grain change to ?grain AND OMITS the day default (clean canonical URL)', async () => {
		const { container } = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
		expect(replaceState).not.toHaveBeenCalled();

		const week = radioByText(container, 'week');
		expect(week).toBeDefined();
		await fireEvent.click(week!);
		expect(mockUrl.searchParams.get('grain')).toBe('week');

		const day = radioByText(container, 'today') ?? radioByText(container, 'day');
		expect(day).toBeDefined();
		await fireEvent.click(day!);
		expect(mockUrl.searchParams.get('grain')).toBeNull();
	});
});

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
		expect(caption(container).toLowerCase()).toContain('pick a start and end date');
		expect(caption(container)).not.toContain('2020');
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('range');
	});

	it('bare ?from/?to fully OUTSIDE the window → reverts to the day view (no range prompt)', () => {
		mockUrl = new URL('http://localhost/lines/51?from=2020-01-01&to=2020-01-05');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		mockUrl = new URL('http://localhost/lines/51');
		const { container: dflt } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		expect(caption(container)).toBe(caption(dflt));
		expect(caption(container).toLowerCase()).not.toContain('pick a start and end date');
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('latest day');
	});

	it('bare ?from/?to with one out-of-window bound → reverts to the day view', () => {
		mockUrl = new URL('http://localhost/lines/51?from=2026-06-16&to=2030-12-31');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		const checked = container.querySelector('[role="radio"][aria-checked="true"]');
		expect(checked?.textContent?.toLowerCase()).toContain('latest day');
		expect(caption(container).toLowerCase()).not.toContain('pick a start and end date');
	});

	it('mirrors from/to and CLEARS them when the rail leaves range mode', async () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-16&to=2026-06-18');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		const day = radioByText(container, 'today') ?? radioByText(container, 'day');
		await fireEvent.click(day!);
		expect(mockUrl.searchParams.get('from')).toBeNull();
		expect(mockUrl.searchParams.get('to')).toBeNull();
		expect(mockUrl.searchParams.get('grain')).toBeNull();
	});

	it('does NOT leak a half-picked bound: a lone ?from is dropped from the URL', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-16');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		expect(mockUrl.searchParams.get('from')).toBeNull();
		expect(mockUrl.searchParams.get('to')).toBeNull();
		expect(caption(container).toLowerCase()).toContain('pick a start and end date');
	});

	it('normalizes an inverted from>to in BOTH the URL and the caption', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=range&from=2026-06-18&to=2026-06-16');
		const { container } = render(RouteReliabilityClusters, {
			props: { data: rangeData, locale: 'en' },
		});
		expect(mockUrl.searchParams.get('from')).toBe('2026-06-16');
		expect(mockUrl.searchParams.get('to')).toBe('2026-06-18');
		expect(caption(container)).toContain('2026-06-16 to 2026-06-18');
	});
});
