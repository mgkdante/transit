import { render, screen, within, fireEvent } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hotspots, IsoUtc } from '$lib/v1/schemas';

// Mock the SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the ?grain
// / ?n seed AND the round-trip mirror are testable (the RouteReliabilityClusters
// urlseed pattern). getLocale stays REAL → 'en'; $lib/i18n + $lib/nav stay REAL so the
// deep links resolve to genuine /lines/<id> and /stop/<id> hrefs.
let mockUrl = new URL('http://localhost/hotspots');
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

const { payload } = vi.hoisted(() => ({ payload: { current: null as Hotspots | null } }));

vi.mock('$lib/v1', () => ({ getHotspots: vi.fn() }));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: payload.current,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

import HotspotsBoard from './HotspotsBoard.svelte';

// A populated week ladder (3 ranked cross-kind entries + 1 tray) + a populated month
// ladder, so the grain rail renders and a seed to a different grain is observable.
function seed(): Hotspots {
	return {
		generated_utc: '2026-06-25T00:00:00Z' as IsoUtc,
		hotspots: [],
		by_grain: [
			{
				grain: 'day',
				date: '2026-06-24',
				window_end: '2026-06-24',
				entries: [
					{
						rank: 1,
						type: 'stop',
						id: 'S1',
						name: 'Berri-UQAM',
						severe_pct: 70,
						observation_count: 80,
						wilson_lo: 16.8,
						wilson_hi: 30.1,
						otp_delta_pts: -20,
						avg_delay_min: 6.7,
					},
					{ rank: 2, type: 'route', id: '51', severe_pct: 40, observation_count: 100 },
				],
				tray: [
					{
						rank: null,
						type: 'stop',
						id: 'S2',
						name: 'Quiet Ave',
						severe_pct: 5,
						observation_count: 12,
					},
				],
			},
			{
				grain: 'week',
				date: '2026-06-14',
				window_end: '2026-06-20',
				entries: [
					{
						rank: 1,
						type: 'route',
						id: '161',
						name: 'Van Horne',
						severe_pct: 55,
						observation_count: 200,
					},
				],
				tray: [],
			},
		],
	} satisfies Hotspots as Hotspots;
}

describe('HotspotsBoard — S12 re-seat', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/hotspots');
		replaceState.mockClear();
		payload.current = seed();
	});

	it('renders the head and the worst-first ladder (a lollipop Chart, NOT a /worst bar)', () => {
		const { container } = render(HotspotsBoard);
		expect(screen.getByRole('heading', { name: 'Hotspots' })).toBeInTheDocument();
		// WEB2: route and stop are SEPARATE per-kind tabs. The day grain has one route + one
		// stop ranked entry → one sr-only row PER kind pane (bits-ui mounts both panes) = 2.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(2);
		// Both kind tabs are offered (day grain has a route AND a stop ranked entry).
		expect(screen.getByRole('tab', { name: 'Line' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Stop' })).toBeInTheDocument();
	});

	it('deep-links a ranked route/stop entry to its detail page (per-kind tabs)', async () => {
		render(HotspotsBoard);
		// Scope to the ladder section — the §C5.10 #1-hotspot callout above the ladder
		// also names + links the worst entry, so a bare screen query would be ambiguous.
		const section = document.querySelector('[data-slot="hotspot-section"]') as HTMLElement;
		// The default (route) tab is the accessible pane → route 51 links to /lines/51.
		expect(within(section).getByRole('link', { name: /51/ })).toHaveAttribute('href', '/lines/51');
		// Activate the Stop tab (the inactive pane is `hidden`, so out of the a11y tree) →
		// the S1 stop entry links to /stop/S1.
		await fireEvent.click(screen.getByRole('tab', { name: 'Stop' }));
		const stop = within(section).getByRole('link', { name: /Berri-UQAM/ });
		expect(stop).toHaveAttribute('href', '/stop/S1');
	});

	it('splits ranked entries into route|stop tabs (only offered kinds appear)', () => {
		// A week grain with only a route entry → the Stop tab is NOT offered (no dead tab).
		mockUrl = new URL('http://localhost/hotspots?grain=week');
		render(HotspotsBoard);
		expect(screen.getByRole('tab', { name: 'Line' })).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Stop' })).toBeNull();
	});

	it('renders the un-ranked tray (sub-MIN_N cells), explicitly NOT ranked', () => {
		render(HotspotsBoard);
		// The day-grain tray cell (Quiet Ave) is a STOP → it lives on the Stop tab pane
		// (bits-ui mounts both panes, so the tray is in the DOM without a tab click).
		const tray = document.querySelector('[data-slot="hotspot-tray"]');
		expect(tray).not.toBeNull();
		// The tray reason names the MIN_N floor.
		expect(within(tray as HTMLElement).getByText(/not ranked/i)).toBeInTheDocument();
		// The tray cell is present as a link, but carries NO magnitude bar (not scored).
		expect(within(tray as HTMLElement).getByText('Quiet Ave')).toBeInTheDocument();
		expect(within(tray as HTMLElement).queryAllByRole('progressbar')).toHaveLength(0);
	});

	it('seeds the grain rail from ?grain=week (a different ladder than the day default)', () => {
		mockUrl = new URL('http://localhost/hotspots?grain=week');
		render(HotspotsBoard);
		// Scope to the ladder section (the #1-hotspot callout above it also links the worst).
		const section = document.querySelector('[data-slot="hotspot-section"]') as HTMLElement;
		// The week ladder ranks Van Horne (161) worst — its link resolves to /lines/161.
		expect(within(section).getByRole('link', { name: /Van Horne/ })).toHaveAttribute(
			'href',
			'/lines/161',
		);
		// The day-grain stop entry is NOT shown on the week grain.
		expect(within(section).queryByRole('link', { name: /Berri-UQAM/ })).toBeNull();
	});

	it('mirrors a grain change to ?grain and OMITS the day default (clean canonical URL)', async () => {
		render(HotspotsBoard);
		// A clean URL at the day default writes nothing (idempotent default-omit).
		expect(mockUrl.searchParams.get('grain')).toBeNull();
		const week = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) =>
			(el.textContent ?? '').toLowerCase().includes('week'),
		);
		expect(week).toBeDefined();
		await fireEvent.click(week!);
		expect(mockUrl.searchParams.get('grain')).toBe('week');
	});

	it('seeds the worst-N cap from ?n and mirrors a change back to ?n', async () => {
		// A day ladder with 6 ranked entries so the worst-N control renders (total > 5).
		payload.current = {
			generated_utc: '2026-06-25T00:00:00Z' as IsoUtc,
			hotspots: [],
			by_grain: [
				{
					grain: 'day',
					date: '2026-06-24',
					window_end: '2026-06-24',
					entries: Array.from({ length: 6 }, (_, i) => ({
						rank: i + 1,
						type: 'route',
						id: `R${i}`,
						severe_pct: 50 - i,
						observation_count: 100,
					})),
					tray: [],
				},
			],
		} satisfies Hotspots as Hotspots;
		mockUrl = new URL('http://localhost/hotspots?n=5');
		const { container } = render(HotspotsBoard);
		// ?n=5 caps the ladder to 5 of 6 → 5 sr-only body rows.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(5);
		// The honest shown/total heading surfaces the truncation.
		expect(screen.getByText(/5\/6/)).toBeInTheDocument();
	});

	it('shows the styled honest-absence empty state when NO grain is populated', () => {
		payload.current = {
			generated_utc: '2026-06-25T00:00:00Z' as IsoUtc,
			hotspots: [],
			by_grain: [{ grain: 'day', entries: [], tray: [] }],
		} satisfies Hotspots as Hotspots;
		const { container } = render(HotspotsBoard);
		const empty = document.querySelector('[data-slot="hotspots-empty"]');
		expect(empty).not.toBeNull();
		const chip = empty?.querySelector('[data-slot="absent-value"]');
		expect(chip?.getAttribute('data-variant')).toBe('block');
		// No ladder rendered → no sr-only table.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(0);
	});
});
