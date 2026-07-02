import { render, fireEvent, within } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StopReliability, IsoUtc } from '$lib/v1';

// Seed the grain rail from ?grain on load + mirror it back. Mock the SvelteKit page URL
// (mutable) + a replaceState that UPDATES it, so the seed, availability clamp, AND the
// round-trip mirror (incl. the day default-omit) are testable — the same harness the
// RouteReliabilityClusters urlseed test uses.
let mockUrl = new URL('http://localhost/stop/57191');
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

import StopReliabilitySurface from './StopReliabilitySurface.svelte';

const utc = (v: string): IsoUtc => v as IsoUtc;

// day + week periods (NO month) + a dated daily series so the trend/verdict render.
const data: StopReliability = {
	generated_utc: utc('2026-06-19T02:00:00Z'),
	id: '57191',
	periods: [
		{ grain: 'day', p50_min: 2.4, p90_min: 11.6, otp_pct: 82 },
		{ grain: 'week', otp_pct: 71, avg_delay_min: 3.3 },
	],
	daily: [
		{
			date: '2026-06-01',
			observation_count: 40,
			severe_count: 4,
			severe_pct: 10,
			avg_delay_min: 1.5,
		},
		{
			date: '2026-06-02',
			observation_count: 60,
			severe_count: 9,
			severe_pct: 15,
			avg_delay_min: 2.1,
		},
		{
			date: '2026-06-03',
			observation_count: 50,
			severe_count: 5,
			severe_pct: 10,
			avg_delay_min: 1.8,
		},
	],
};

// The DESKTOP SurfaceControls rail (the mobile ControlsRail renders the same picker in
// jsdom; scope to the desktop rail's radiogroup for an unambiguous query).
const desktopGroup = (c: HTMLElement): HTMLElement => {
	const rail = c.querySelector('[data-surface-controls]') as HTMLElement;
	return rail.querySelector('[role="radiogroup"]') as HTMLElement;
};

describe('StopReliabilitySurface — grain seed + availability (S8A)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/stop/57191');
		replaceState.mockClear();
	});

	it('offers only grains the stop has data for; day is the default (richest)', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const group = desktopGroup(container);
		const day = within(group).getByRole('radio', { name: 'Day' });
		const week = within(group).getByRole('radio', { name: 'Week' });
		const month = within(group).getByRole('radio', { name: 'Month' });
		expect(day).toBeEnabled();
		expect(week).toBeEnabled();
		expect(month).toBeDisabled(); // no month period → disabled, never selectable
		expect(day).toHaveAttribute('aria-checked', 'true');
	});

	it('seeds the rail from ?grain=week', () => {
		mockUrl = new URL('http://localhost/stop/57191?grain=week');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		expect(week).toHaveAttribute('aria-checked', 'true');
	});

	it('clamps an UNAVAILABLE seeded grain (month) back to day', () => {
		mockUrl = new URL('http://localhost/stop/57191?grain=month');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const day = within(desktopGroup(container)).getByRole('radio', { name: 'Day' });
		expect(day).toHaveAttribute('aria-checked', 'true');
	});

	it('falls back to day for an unknown ?grain (enum-guard, never a cast)', () => {
		mockUrl = new URL('http://localhost/stop/57191?grain=bogus');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const checked = desktopGroup(container).querySelectorAll('[role="radio"][aria-checked="true"]');
		expect(checked.length).toBe(1);
		expect(checked[0].textContent?.trim()).toBe('Day');
	});

	it('day percentiles surface only on the day grain (drop on week, no fabricated 0)', async () => {
		const { container, queryByText } = render(StopReliabilitySurface, {
			props: { data, locale: 'en' },
		});
		expect(queryByText('Typical delay')).not.toBeNull();
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		expect(queryByText('Typical delay')).toBeNull();
	});

	it('mirrors a grain change to ?grain and OMITS the day default (clean URL)', async () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		expect(replaceState).not.toHaveBeenCalled(); // idempotent default-omit on a clean URL

		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		expect(mockUrl.searchParams.get('grain')).toBe('week');

		const day = within(desktopGroup(container)).getByRole('radio', { name: 'Day' });
		await fireEvent.click(day);
		expect(mockUrl.searchParams.get('grain')).toBeNull(); // day default deleted, never grain=day
	});

	it('preserves an existing ?tab when mirroring grain (mirror merges, single-key)', async () => {
		mockUrl = new URL('http://localhost/stop/57191?tab=reliability');
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		const week = within(desktopGroup(container)).getByRole('radio', { name: 'Week' });
		await fireEvent.click(week);
		expect(mockUrl.searchParams.get('grain')).toBe('week');
		expect(mockUrl.searchParams.get('tab')).toBe('reliability'); // ?tab untouched
	});
});

describe('StopReliabilitySurface — daily trend + range verdict (S8A)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/stop/57191');
		replaceState.mockClear();
	});

	it('mounts the daily-trend section with the S8B DateRangePicker seam', () => {
		const { container } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		expect(container.querySelector('[data-slot="stop-daily-trend"]')).not.toBeNull();
		// The S8B mount seam is present (a {from,to} window prop drives it).
		expect(container.querySelector('[data-mount="daily-range"]')).not.toBeNull();
	});

	it('pools the FULL window verdict EXACTLY (Σcounts → 12.0%, 150 obs)', () => {
		const { getByText } = render(StopReliabilitySurface, { props: { data, locale: 'en' } });
		// pooled severe = 100*18/150 = 12.0% (a value equal to no single day's rate).
		expect(getByText('12.0%')).toBeInTheDocument();
		expect(getByText('150')).toBeInTheDocument(); // observation count tile
	});

	it('clips the trend + verdict to a {from,to} window prop (S8B seam)', () => {
		const { getByText } = render(StopReliabilitySurface, {
			props: { data, locale: 'en', window: { from: '2026-06-01', to: '2026-06-02' } },
		});
		// pooled over 2 days: 100*13/100 = 13.0%, 100 obs.
		expect(getByText('13.0%')).toBeInTheDocument();
		expect(getByText('100')).toBeInTheDocument();
	});
});
