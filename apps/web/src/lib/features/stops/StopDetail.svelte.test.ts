import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { StopFile, StopReliability, StopDeparture } from '$lib/v1';
import StopDetail from './StopDetail.svelte';

// ── Fixtures ────────────────────────────────────────────────────────────────
// A static stop file (info + schedule). Minimal; the reliability + live tiers
// carry the data the new affordances render.
const STOP_FILE = {
	generated_utc: '2026-06-15T12:00:00Z',
	id: '57191',
	name: 'Test stop',
	lat: 45.5,
	lon: -73.6,
	scheduled: [],
} as unknown as StopFile;

// Reliability with BOTH day + week grains, a day-grain p50/p90 pair, a 7×24
// habits matrix carrying a real cell, and a 3-route by_route breakdown (out of
// rank order, one with a null delay that must be dropped).
function habitsMatrix(): (number | null)[][] {
	const grid: (number | null)[][] = Array.from({ length: 7 }, () =>
		Array.from({ length: 24 }, () => null),
	);
	grid[1][8] = 0.9; // Tue 08:00 carries a real value
	return grid;
}

const RELIABILITY = {
	generated_utc: '2026-06-15T12:00:00Z',
	id: '57191',
	name: 'Test stop',
	periods: [
		{ grain: 'day', otp_pct: 82, avg_delay_min: 3.2, p50_min: 2.4, p90_min: 11.6, severe_pct: 6 },
		{ grain: 'week', otp_pct: 79, avg_delay_min: 3.8, p50_min: null, p90_min: null, severe_pct: 8 },
	],
	habits: { scale: 'severe_relative', matrix: habitsMatrix() },
	by_route: [
		{ route: '24', avg_delay_min: 4.1 },
		{ route: '80', avg_delay_min: 12.5 },
		{ route: '99', avg_delay_min: null }, // dropped — no fake-0 ranking
	],
} as StopReliability;

// A live board for this stop: three departures across late / on-time / early,
// two routes (51, 80) so the by-route chips appear.
const DEPARTURES = [
	{ eta_utc: '2026-06-15T12:05:00Z', route: '51', delay_min: 4 }, // late
	{ eta_utc: '2026-06-15T12:08:00Z', route: '80', delay_min: 0 }, // on time
	{ eta_utc: '2026-06-15T12:11:00Z', route: '51', delay_min: -2 }, // early
] as StopDeparture[];

// A second stop's board (for the reset-on-navigation test) — all on-time, so a
// stale "Late" filter carried over from stop 57191 would hide everything.
const DEPARTURES_B = [
	{ eta_utc: '2026-06-15T12:06:00Z', route: '12', delay_min: 0 },
	{ eta_utc: '2026-06-15T12:09:00Z', route: '12', delay_min: 0 },
] as StopDeparture[];

const liveStore = {
	vehicles: null,
	trips: null,
	departures: { generated_utc: '2026-06-15T12:00:00Z' },
	alerts: null,
	network: null,
	index: {
		byStopId: new Map<string, StopDeparture[]>([
			['57191', DEPARTURES],
			['99999', DEPARTURES_B],
		]),
	},
	generatedUtc: '2026-06-15T12:00:00Z',
	ageSeconds: 12,
	isStale: false,
	loading: false,
	error: null,
	start: vi.fn(),
	stop: vi.fn(),
	refresh: vi.fn(),
};

const emptyLiveStore = {
	...liveStore,
	departures: null,
	index: { byStopId: new Map<string, StopDeparture[]>() },
};

// Toggles the live store + reliability fixture so individual tests can drive an
// empty / null state without re-mocking.
let useEmptyLive = false;
let reliabilityData: StopReliability | null = RELIABILITY;
// Active UI locale for getLocale() — mutable so a FR-localization test can flip it
// without disturbing the (default EN) suite.
let currentLocale: 'en' | 'fr' = 'en';

// Partial-mock i18n: keep the real routing helpers (localizeHref drives the map
// drilldown href assertions) but make getLocale read the per-test currentLocale.
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => currentLocale };
});

vi.mock('$lib/v1', () => ({
	getStop: () => STOP_FILE,
	getStopReliability: () => reliabilityData,
	getV1Context: () => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
	createLiveStore: () => (useEmptyLive ? emptyLiveStore : liveStore),
}));

// The resource mock calls the loader and uses its return as `data` — so getStop
// vs getStopReliability resolve to the right fixture (RouteDetail-style pattern).
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (loader: () => unknown) => ({
		data: loader(),
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

function reset() {
	useEmptyLive = false;
	reliabilityData = RELIABILITY;
	currentLocale = 'en';
}

describe('StopDetail map drilldown', () => {
	it('links directly to the live map filtered to this stop', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });

		expect(screen.getByRole('link', { name: 'View stop 57191 on map' })).toHaveAttribute(
			'href',
			'/map?stop=57191&focus=stop%3A57191',
		);
	});
});

describe('StopDetail reliability — grain picker', () => {
	it('offers only grains the stop has data for and defaults to the richest (day)', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const group = screen.getByRole('radiogroup', { name: 'Roll-up period' });
		const day = within(group).getByRole('radio', { name: 'Day' });
		const week = within(group).getByRole('radio', { name: 'Week' });
		const month = within(group).getByRole('radio', { name: 'Month' });

		// day + week have data → enabled; month has none → disabled, never offered live.
		expect(day).toBeEnabled();
		expect(week).toBeEnabled();
		expect(month).toBeDisabled();
		// Default = the richest available grain (day).
		expect(day).toHaveAttribute('aria-checked', 'true');
	});

	it('switches grain and surfaces day percentiles only on the day grain', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		// Day grain → typical/worst-case percentile pair is present. (p50 also
		// surfaces inside the ReliabilityPane median tile, hence getAllByText.)
		expect(screen.getByText('Typical delay')).toBeInTheDocument();
		expect(screen.getAllByText('2.4 min').length).toBeGreaterThan(0); // p50
		expect(screen.getAllByText('11.6 min').length).toBeGreaterThan(0); // p90

		// Switch to week → percentiles (null on week) drop out, no fabricated 0.
		fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		expect(screen.queryByText('Typical delay')).not.toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
	});

	it('localizes the reliability card grain heading (EN) instead of the raw contract string', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		// The ReliabilityPane card heading shows the localized label ("Day"), never
		// the raw lowercase contract grain ('day').
		const pane = document.querySelector('[data-slot="reliability-pane"]') as HTMLElement;
		expect(pane).not.toBeNull();
		expect(within(pane).getByText('Day')).toBeInTheDocument();
		expect(within(pane).queryByText('day')).not.toBeInTheDocument();
	});

	it('localizes the reliability card grain heading in FR (Jour, not the raw "day")', () => {
		reset();
		currentLocale = 'fr';
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Fiabilité' }));

		// FR reader sees "Jour" in the card heading, matching the GrainPicker — never
		// the untranslated contract grain "day".
		const pane = document.querySelector('[data-slot="reliability-pane"]') as HTMLElement;
		expect(pane).not.toBeNull();
		expect(within(pane).getByText('Jour')).toBeInTheDocument();
		expect(within(pane).queryByText('day')).not.toBeInTheDocument();
	});
});

describe('StopDetail reliability — habits heatmap', () => {
	it('renders the habits heatmap when the matrix carries data', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.getByText('Severe delays by hour')).toBeInTheDocument();
		// The interactive Heatmap root is a labelled `group` (AT descends into the
		// roving cells); its aria-label is the heatmap summary.
		expect(
			screen.getByRole('group', { name: 'Severe-delay heatmap by day and hour' }),
		).toBeInTheDocument();
	});

	it('renders NO heatmap (not a fabricated grid) when habits is absent', () => {
		reset();
		reliabilityData = { ...RELIABILITY, habits: null };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.queryByText('Severe delays by hour')).not.toBeInTheDocument();
	});
});

describe('StopDetail reliability — by_route ranked bars', () => {
	it('ranks routes worst-delay first and drops rows with no delay', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		// Route 80 (12.5) is worst → rank 1; route 24 (4.1) → rank 2; route 99 (null) dropped.
		expect(screen.getByText('12.5 min')).toBeInTheDocument();
		expect(screen.getByText('4.1 min')).toBeInTheDocument();

		const rows = screen.getAllByRole('listitem');
		const ranked = rows.filter((r) => within(r).queryByText(/min$/));
		// The worst route's bar must precede the milder one in the DOM.
		const worstIdx = ranked.findIndex((r) => within(r).queryByText('12.5 min'));
		const milderIdx = ranked.findIndex((r) => within(r).queryByText('4.1 min'));
		expect(worstIdx).toBeGreaterThanOrEqual(0);
		expect(worstIdx).toBeLessThan(milderIdx);
	});
});

describe('StopDetail live departures — status filter', () => {
	it('narrows the board to late departures and back', async () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		// Next tab is the default active tab.

		// All three departures shown initially.
		expect(screen.getByText('Showing 3 of 3 departures')).toBeInTheDocument();

		// Filter to "Late" → only the +4 min departure remains.
		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		expect(screen.getByText('Showing 1 of 3 departures')).toBeInTheDocument();
		expect(screen.getByText('+4 min late')).toBeInTheDocument();
		expect(screen.queryByText('2 min early')).not.toBeInTheDocument();

		// Toggle off → all shown again.
		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		expect(screen.getByText('Showing 3 of 3 departures')).toBeInTheDocument();
	});

	it('shows an honest empty state when a filter combination matches nothing', async () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });

		// Route 80's only departure is on-time → "Early" + route 80 matches nothing.
		await fireEvent.click(screen.getByRole('button', { name: 'Early' }));
		await fireEvent.click(screen.getByRole('button', { name: '80' }));

		expect(screen.getByTestId('departures-filter-empty')).toBeInTheDocument();
		expect(screen.getByText('Showing 0 of 3 departures')).toBeInTheDocument();
	});
});

describe('StopDetail — per-stop state resets on navigation', () => {
	it('clears the departures status filter when the stop id changes', async () => {
		reset();
		const { rerender } = render(StopDetail, { props: { id: '57191' } });

		// Narrow stop 57191 to "Late" → only the +4 min departure remains.
		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		expect(screen.getByText('Showing 1 of 3 departures')).toBeInTheDocument();

		// Navigate to stop 99999 (same component instance, new id). The stale "Late"
		// filter must NOT carry over — its board is all on-time, so a leaked filter
		// would hide both departures.
		await rerender({ id: '99999' });

		expect(screen.getByText('Showing 2 of 2 departures')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'false');
	});
});
