import { render, screen, within, fireEvent } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepeatOffenders as RepeatOffendersData, IsoUtc } from '$lib/v1/schemas';

// Mock the SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the ?grain
// / ?n seed AND the round-trip mirror are testable (the HotspotsBoard urlseed pattern).
// getLocale stays REAL → 'en'; $lib/i18n + $lib/nav stay REAL so the deep links resolve
// to genuine /lines/<id> hrefs.
let mockUrl = new URL('http://localhost/repeat-offenders');
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

const { payload } = vi.hoisted(() => ({
	payload: { current: null as RepeatOffendersData | null },
}));

vi.mock('$lib/v1', () => ({ getRepeatOffenders: vi.fn() }));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: payload.current,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

import RepeatOffenders from './RepeatOffenders.svelte';

const GENERATED = '2026-06-20T02:00:00Z' as IsoUtc;

// A populated week ladder (one trip + one vehicle ranked entry + one tray) + a
// populated month ladder, so the grain rail renders and a seed to a different grain
// is observable.
function seed(): RepeatOffendersData {
	return {
		generated_utc: GENERATED,
		offenders: [],
		by_grain: [
			{
				grain: 'week',
				window_days: 7,
				total_ranked_trips: 1,
				total_ranked_vehicles: 1,
				entries: [
					{
						rank: 1,
						type: 'trip',
						id: 'T1',
						route: '11',
						route_name: 'Montagne / Sommet',
						severe_pct: 62,
						observation_count: 210,
						wilson_lo: 30,
						wilson_hi: 44,
						recurrence_days: 5,
						observed_days: 7,
						avg_delay_min: 9.4,
						severity: 'critical',
					},
					{
						rank: 1,
						type: 'vehicle',
						id: '42010',
						route: '55',
						route_name: 'Boulevard',
						severe_pct: 48,
						observation_count: 180,
						recurrence_days: 4,
						observed_days: 6,
						severity: 'high',
					},
				],
				tray: [
					{
						rank: null,
						type: 'vehicle',
						id: '99999',
						route: '80',
						route_name: 'Parc',
						severe_pct: 20,
						observation_count: 12,
					},
				],
			},
			{
				grain: 'month',
				window_days: 30,
				total_ranked_trips: 1,
				entries: [
					{
						rank: 1,
						type: 'trip',
						id: 'T9',
						route: '161',
						route_name: 'Van Horne',
						severe_pct: 55,
						observation_count: 600,
						recurrence_days: 18,
						observed_days: 26,
					},
				],
				tray: [],
			},
		],
	} satisfies RepeatOffendersData as RepeatOffendersData;
}

describe('RepeatOffenders — S14 re-seat (by_grain ladders)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/repeat-offenders');
		replaceState.mockClear();
		payload.current = seed();
	});

	it('renders the head and the worst-first recurrence ladder (a lollipop Chart, NOT a /worst bar)', () => {
		const { container } = render(RepeatOffenders);
		expect(screen.getByRole('heading', { name: 'Repeat offenders' })).toBeInTheDocument();
		// trip and vehicle are SEPARATE per-kind tabs. The week grain has one trip + one
		// vehicle ranked entry → one sr-only row PER kind pane (bits-ui mounts both panes) = 2.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(2);
		expect(screen.getByRole('tab', { name: 'Trip' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Vehicle' })).toBeInTheDocument();
	});

	it('deep-links a ranked trip/vehicle entry to its offending line', async () => {
		render(RepeatOffenders);
		// The default (trip) tab is the accessible pane → trip T1 links to its route /lines/11.
		expect(screen.getByRole('link', { name: /Montagne/ })).toHaveAttribute('href', '/lines/11');
		// Activate the Vehicle tab → the 42010 vehicle entry links to /lines/55.
		await fireEvent.click(screen.getByRole('tab', { name: 'Vehicle' }));
		const veh = screen.getByRole('link', { name: /Boulevard/ });
		expect(veh).toHaveAttribute('href', '/lines/55');
	});

	it('surfaces the natural-frequency recurrence line on a ranked row', () => {
		render(RepeatOffenders);
		// The per-row note carries "Late-prone on 5 of 7 observed days" (the sr-only table
		// mirrors the note text).
		expect(screen.getByText(/Late-prone on 5 of 7 observed days/i)).toBeInTheDocument();
	});

	it('splits ranked entries into trip|vehicle tabs (only offered kinds appear)', () => {
		// The month grain has only a trip entry → the Vehicle tab is NOT offered (no dead tab).
		mockUrl = new URL('http://localhost/repeat-offenders?grain=month');
		render(RepeatOffenders);
		expect(screen.getByRole('tab', { name: 'Trip' })).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Vehicle' })).toBeNull();
	});

	it('renders the un-ranked tray (sub-MIN_N entities), explicitly NOT ranked', () => {
		render(RepeatOffenders);
		// The week tray cell (99999, a VEHICLE) lives on the Vehicle tab pane (bits-ui mounts
		// both panes, so the tray is in the DOM without a tab click).
		const tray = document.querySelector('[data-slot="offender-tray"]');
		expect(tray).not.toBeNull();
		expect(within(tray as HTMLElement).getByText(/not ranked/i)).toBeInTheDocument();
		// The tray cell is a link but carries NO magnitude bar (not scored).
		expect(within(tray as HTMLElement).queryAllByRole('progressbar')).toHaveLength(0);
	});

	it('seeds the grain rail from ?grain=month (a different ladder than the week default)', () => {
		mockUrl = new URL('http://localhost/repeat-offenders?grain=month');
		render(RepeatOffenders);
		// The month ladder ranks Van Horne (161) worst — its link resolves to /lines/161.
		expect(screen.getByRole('link', { name: /Van Horne/ })).toHaveAttribute('href', '/lines/161');
		// The week-grain trip is NOT shown on the month grain.
		expect(screen.queryByRole('link', { name: /Montagne/ })).toBeNull();
	});

	it('mirrors a grain change to ?grain and OMITS the week default (clean canonical URL)', async () => {
		render(RepeatOffenders);
		// A clean URL at the week default writes nothing (idempotent default-omit).
		expect(mockUrl.searchParams.get('grain')).toBeNull();
		const month = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) =>
			(el.textContent ?? '').toLowerCase().includes('month'),
		);
		expect(month).toBeDefined();
		await fireEvent.click(month!);
		expect(mockUrl.searchParams.get('grain')).toBe('month');
	});

	it('seeds the worst-N cap from ?n and mirrors a change back to ?n', async () => {
		// A week ladder with 6 ranked TRIP entries so the worst-N control renders (total > 5).
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [
				{
					grain: 'week',
					window_days: 7,
					total_ranked_trips: 6,
					entries: Array.from({ length: 6 }, (_, i) => ({
						rank: i + 1,
						type: 'trip',
						id: `T${i}`,
						route: `${i}`,
						severe_pct: 50 - i,
						observation_count: 100,
						recurrence_days: 3,
						observed_days: 7,
					})),
					tray: [],
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		mockUrl = new URL('http://localhost/repeat-offenders?n=5');
		const { container } = render(RepeatOffenders);
		// ?n=5 caps the ladder to 5 of 6 → 5 sr-only body rows.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(5);
		// The honest shown/total heading surfaces the truncation.
		expect(screen.getByText(/5\/6/)).toBeInTheDocument();
	});

	it('shows the styled honest-absence empty state when NO grain is populated and no legacy list', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [{ grain: 'week', entries: [], tray: [] }],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		const { container } = render(RepeatOffenders);
		const empty = document.querySelector('[data-slot="offenders-empty"]');
		expect(empty).not.toBeNull();
		const chip = empty?.querySelector('[data-slot="absent-value"]');
		expect(chip?.getAttribute('data-variant')).toBe('block');
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(0);
	});
});

describe('RepeatOffenders — legacy fallback ledger (by_grain absent)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/repeat-offenders');
		replaceState.mockClear();
	});

	it('renders the scalar offenders[] as a ranked ledger worst-first, each linking to its route/stop', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '11',
					route: '11',
					route_name: 'Montagne / Sommet',
					avg_delay_min: 12.4,
					recurrence: 'most weekday afternoons',
					severity: 'critical',
				},
				{
					type: 'stop',
					id: '57191',
					route: null,
					route_name: null,
					avg_delay_min: 6.2,
					recurrence: null,
					severity: 'high',
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		render(RepeatOffenders);

		const list = screen.getByRole('list', { name: /ranked by average delay/i });
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);
		// Worst-first order preserved: route 11 (12.4) then stop (6.2).
		expect(links[0]).toHaveTextContent('Montagne / Sommet');
		expect(links[0]).toHaveTextContent('12.4 min');
		expect(links[0]).toHaveAttribute('href', '/lines/11');
		expect(links[1]).toHaveAttribute('href', '/stop/57191');
		expect(links[1]).toHaveTextContent('6.2 min');
	});

	it('shows the styled honest-absence chip for a null average delay, never a fabricated 0', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '24',
					route: '24',
					route_name: 'Sherbrooke',
					avg_delay_min: null,
					recurrence: 'weekday PM peaks',
					severity: 'watch',
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		const { container } = render(RepeatOffenders);
		const chip = container.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.getAttribute('data-tone')).toBe('unknown');
		expect(chip).toHaveTextContent(/No data/i);
		expect(chip).toHaveTextContent(/not enough readings yet/i);
		expect(screen.queryByText(/0\.0 min/)).not.toBeInTheDocument();
	});

	it('reads the honest recurrence fallback when a legacy row carries no recurrence string', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'stop',
					id: '99',
					route: null,
					route_name: null,
					avg_delay_min: 8,
					recurrence: null,
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		render(RepeatOffenders);
		expect(screen.getByText(/recurrence not recorded/i)).toBeInTheDocument();
	});

	it('renders BOTH rows when two offenders share an id on different routes (no each_key_duplicate)', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{ type: 'route', id: '42010', route: '49', route_name: null, avg_delay_min: 11.3 },
				{ type: 'route', id: '42010', route: '55', route_name: null, avg_delay_min: 9.7 },
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		expect(() => render(RepeatOffenders)).not.toThrow();
		const list = screen.getByRole('list', { name: /ranked by average delay/i });
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
		const links = within(list).getAllByRole('link');
		expect(links[0]).toHaveAttribute('href', '/lines/49');
		expect(links[1]).toHaveAttribute('href', '/lines/55');
	});

	it('routes an empty payload to the boundary empty state, never an invented row', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		render(RepeatOffenders);
		expect(
			screen.queryByRole('list', { name: /ranked by average delay/i }),
		).not.toBeInTheDocument();
	});
});
