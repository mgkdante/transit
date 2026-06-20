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
	// Per-stop weekday seasonality (ISO 1=Mon..7=Sun). Friday (5, 9.4 min) is the
	// worst mean delay → rank 1; Monday (1) is well-sampled so its severe share is
	// shown; Wednesday (3) is under-sampled (2 obs) so its severe share is withheld;
	// Sunday (7) carries a null mean delay (+ zero obs) and must be dropped.
	day_of_week: [
		{ day_of_week_iso: 1, avg_delay_min: 2.4, severe_pct: 5.0, observation_count: 140 },
		{ day_of_week_iso: 3, avg_delay_min: 3.1, severe_pct: 18.2, observation_count: 2 },
		{ day_of_week_iso: 5, avg_delay_min: 9.4, severe_pct: 14.9, observation_count: 96 },
		{ day_of_week_iso: 7, avg_delay_min: null, severe_pct: null, observation_count: 0 },
	],
	// Crowding of buses OBSERVED AT this stop over the trailing window. "Standing"
	// (0.45) is the dominant band → the headline reads its share; the bar is a
	// 100%-stacked occupancy proportion.
	occupancy_mix: { empty: 0.05, many_seats: 0.15, few_seats: 0.25, standing: 0.45, full: 0.1 },
} as StopReliability;

// A reliability fixture that ALSO carries the additive SHIFT grains
// (am_peak…night) + DAY-TYPE grains (weekday/weekend) the pipeline now emits on
// the same periods[] array, alongside the calendar grains. pm_peak (12%) is the
// worst severe share; night has a null severe share (must be dropped, no fake-0).
const RELIABILITY_WITH_TOD = {
	...RELIABILITY,
	periods: [
		...RELIABILITY.periods!,
		{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 2.1, severe_pct: 5 },
		{ grain: 'midday', otp_pct: 91, avg_delay_min: 1.4, severe_pct: 3 },
		{ grain: 'pm_peak', otp_pct: 74, avg_delay_min: 5.6, severe_pct: 12 },
		{ grain: 'evening', otp_pct: 90, avg_delay_min: 1.8, severe_pct: 4 },
		{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null }, // dropped
		{ grain: 'weekday', otp_pct: 80, avg_delay_min: 3.4, severe_pct: 7 },
		{ grain: 'weekend', otp_pct: 86, avg_delay_min: 2.2, severe_pct: 4 },
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

describe('StopDetail reliability — crowding (occupancy_mix)', () => {
	it('renders the occupancy proportion bar when occupancy_mix is present', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const crowding = document.querySelector('[data-slot="stop-crowding"]') as HTMLElement;
		expect(crowding).not.toBeNull();
		// Honest framing: buses OBSERVED AT this stop, not a stop attribute.
		expect(within(crowding).getByText('Crowding on buses seen here')).toBeInTheDocument();
		expect(
			within(crowding).getByText(/How full the buses observed at this stop ran/),
		).toBeInTheDocument();
		// The interactive proportion bar renders as a labelled group (AT descends into
		// the focusable slices); its aria-label is the occupancy mix summary.
		expect(
			within(crowding).getByRole('group', {
				name: /Occupancy mix of buses observed at this stop/,
			}),
		).toBeInTheDocument();
		// Dominant band (standing, 45%) is lifted to the headline with its band label.
		// "45%" appears in both the headline MetricDisplay and the bar legend slice.
		expect(within(crowding).getAllByText('45%').length).toBeGreaterThan(0);
		expect(within(crowding).getAllByText('Standing').length).toBeGreaterThan(0);
	});

	it('stands the crowding BAR down but shows the honest no-telemetry note when occupancy_mix is null', () => {
		reset();
		reliabilityData = { ...RELIABILITY, occupancy_mix: null };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		// No fabricated bar…
		expect(document.querySelector('[data-slot="stop-crowding"]')).toBeNull();
		// …but the reliability resource HAS loaded with no crowding telemetry, so the
		// explicit bilingual note renders in its place (keeps the heading framing).
		const empty = document.querySelector('[data-slot="stop-crowding-empty"]') as HTMLElement;
		expect(empty).not.toBeNull();
		expect(within(empty).getByText('Crowding on buses seen here')).toBeInTheDocument();
		expect(
			within(empty).getByText('No occupancy telemetry attributed to this stop.'),
		).toBeInTheDocument();
	});

	it('stands the crowding section down when occupancy_mix is absent (undefined)', () => {
		reset();
		reliabilityData = { ...RELIABILITY, occupancy_mix: undefined } as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-crowding"]')).toBeNull();
	});

	it('stands down on an all-zero mix (no even split, no all-empty bar)', () => {
		reset();
		reliabilityData = {
			...RELIABILITY,
			occupancy_mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 0 },
		} as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		// No fabricated bar from an all-zero mix; the honest note takes its place.
		expect(document.querySelector('[data-slot="stop-crowding"]')).toBeNull();
		expect(document.querySelector('[data-slot="stop-crowding-empty"]')).not.toBeNull();
	});

	it('renders the FR no-telemetry note when occupancy_mix is null', () => {
		reset();
		currentLocale = 'fr';
		reliabilityData = { ...RELIABILITY, occupancy_mix: null };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Fiabilité' }));

		const empty = document.querySelector('[data-slot="stop-crowding-empty"]') as HTMLElement;
		expect(empty).not.toBeNull();
		expect(
			within(empty).getByText('Aucune donnée d’occupation rattachée à cet arrêt.'),
		).toBeInTheDocument();
	});
});

describe('StopDetail reliability — occupancy-only stop is not gated out as empty', () => {
	it('renders the crowding section for a stop with ONLY occupancy_mix (no periods/dow/by_route)', () => {
		reset();
		// A stop the pipeline emits with crowding telemetry but no delay periods,
		// weekday series, or per-route breakdown. The widened isEmpty predicate must
		// NOT gate the whole reliability tab to its empty state — the crowding section
		// (and its honest framing) must still render.
		reliabilityData = {
			generated_utc: '2026-06-15T12:00:00Z',
			id: '57191',
			name: 'Test stop',
			periods: [],
			habits: null,
			day_of_week: [],
			by_route: [],
			occupancy_mix: { empty: 0.1, many_seats: 0.2, few_seats: 0.2, standing: 0.4, full: 0.1 },
		} as unknown as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const crowding = document.querySelector('[data-slot="stop-crowding"]') as HTMLElement;
		expect(crowding).not.toBeNull();
		expect(within(crowding).getByText('Crowding on buses seen here')).toBeInTheDocument();
		// Dominant band (standing, 40%) surfaces — proof the section rendered, not the
		// reliability empty state.
		expect(within(crowding).getAllByText('Standing').length).toBeGreaterThan(0);
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

describe('StopDetail reliability — weekday seasonality (day_of_week)', () => {
	it('ranks weekdays worst-delay first and drops a null-mean weekday (no fake-0 row)', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const weekday = document.querySelector('[data-slot="stop-weekday"]') as HTMLElement;
		expect(weekday).not.toBeNull();
		expect(within(weekday).getByText('By day of week')).toBeInTheDocument();

		// Friday (9.4) worst → rank 1; Monday (2.4) and Wednesday (3.1) follow; Sunday
		// (null mean) is dropped entirely — never a fabricated 0-delay bar.
		expect(within(weekday).getByText('Friday')).toBeInTheDocument();
		expect(within(weekday).getByText('Monday')).toBeInTheDocument();
		expect(within(weekday).getByText('Wednesday')).toBeInTheDocument();
		expect(within(weekday).queryByText('Sunday')).not.toBeInTheDocument();

		// Worst weekday (Friday) precedes the milder ones in the DOM.
		const list = within(weekday).getByRole('list', { name: 'By day of week' });
		const rows = within(list).getAllByRole('listitem');
		const friIdx = rows.findIndex((r) => within(r).queryByText('Friday'));
		const monIdx = rows.findIndex((r) => within(r).queryByText('Monday'));
		expect(friIdx).toBeGreaterThanOrEqual(0);
		expect(friIdx).toBeLessThan(monIdx);
		// The dropped Sunday's no-data never surfaces as a 0.0 min bar.
		expect(within(weekday).queryByText('0.0 min')).not.toBeInTheDocument();
	});

	it('gates the severe share on observation count (under-sampled weekday withheld)', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const weekday = document.querySelector('[data-slot="stop-weekday"]') as HTMLElement;
		// Monday is well-sampled (140 obs) → its severe share (5.0%) is shown.
		expect(within(weekday).getByText('Severe-delay share 5.0%')).toBeInTheDocument();
		// Wednesday is under-sampled (2 obs) → its severe share (18.2%) is WITHHELD;
		// the row falls back to the plain avg-delay caption, never a fabricated number.
		expect(within(weekday).queryByText('Severe-delay share 18.2%')).not.toBeInTheDocument();
		expect(within(weekday).getAllByText('Avg delay').length).toBeGreaterThan(0);
		// Honest trailing-window caveat is printed.
		expect(
			within(weekday).getByText(/Trailing-window, observation-weighted estimate/),
		).toBeInTheDocument();
	});

	it('stands the weekday section down when day_of_week is absent', () => {
		reset();
		reliabilityData = { ...RELIABILITY, day_of_week: undefined };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-weekday"]')).toBeNull();
		expect(screen.queryByText('By day of week')).not.toBeInTheDocument();
	});

	it('stands the weekday section down when every weekday carries a null mean (no fake-0)', () => {
		reset();
		reliabilityData = {
			...RELIABILITY,
			day_of_week: [
				{ day_of_week_iso: 2, avg_delay_min: null, severe_pct: null, observation_count: 0 },
				{ day_of_week_iso: 6, avg_delay_min: null, severe_pct: 4.0, observation_count: 0 },
			],
		} as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-weekday"]')).toBeNull();
	});

	it('localizes weekday names in FR (Vendredi, not the ISO integer or EN name)', () => {
		reset();
		currentLocale = 'fr';
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Fiabilité' }));

		const weekday = document.querySelector('[data-slot="stop-weekday"]') as HTMLElement;
		expect(weekday).not.toBeNull();
		expect(within(weekday).getByText('Par jour de la semaine')).toBeInTheDocument();
		expect(within(weekday).getByText('Vendredi')).toBeInTheDocument();
		expect(within(weekday).getByText('Lundi')).toBeInTheDocument();
		// Never the raw ISO key or the English label.
		expect(within(weekday).queryByText('Friday')).not.toBeInTheDocument();
		expect(within(weekday).queryByText('5')).not.toBeInTheDocument();
	});
});

describe('StopDetail reliability — by time of day (shift + day-type grains)', () => {
	it('renders the by-time-of-day shift list + weekday/weekend comparison when present', () => {
		reset();
		reliabilityData = RELIABILITY_WITH_TOD;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const tod = document.querySelector('[data-slot="stop-time-of-day"]') as HTMLElement;
		expect(tod).not.toBeNull();
		// Section heading + the day-type sub-comparison heading.
		expect(within(tod).getByText('By time of day')).toBeInTheDocument();
		expect(within(tod).getByText('Weekday vs weekend')).toBeInTheDocument();

		// The shift list uses the SHARED lines vocabulary (AM peak / PM peak …).
		expect(within(tod).getByText('PM peak')).toBeInTheDocument();
		expect(within(tod).getByText('AM peak')).toBeInTheDocument();
		// Day-type rows use the shared weekday/weekend labels.
		expect(within(tod).getByText('Weekday')).toBeInTheDocument();
		expect(within(tod).getByText('Weekend')).toBeInTheDocument();

		// Worst severe share (pm_peak, 12%) ranks first, ahead of am_peak (5%).
		const shiftList = within(tod).getByRole('list', { name: 'By time of day' });
		const shiftRows = within(shiftList).getAllByRole('listitem');
		const pmIdx = shiftRows.findIndex((r) => within(r).queryByText('PM peak'));
		const amIdx = shiftRows.findIndex((r) => within(r).queryByText('AM peak'));
		expect(pmIdx).toBeGreaterThanOrEqual(0);
		expect(pmIdx).toBeLessThan(amIdx);

		// Honesty: the null-severe `night` shift is dropped (no fabricated 0 bar).
		expect(within(tod).queryByText('Night')).not.toBeInTheDocument();
		// Honest trailing-window caveat is printed.
		expect(
			within(tod).getByText(/Trailing-window, observation-weighted estimate/),
		).toBeInTheDocument();
	});

	it('stands the whole section down when the stop carries no shift/day-type grains', () => {
		reset();
		// Default fixture = calendar grains only (day + week).
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-time-of-day"]')).toBeNull();
		expect(screen.queryByText('By time of day')).not.toBeInTheDocument();
	});

	it('drops an avg-only (severe-null) shift period — partition + ranker stay in lock-step', () => {
		reset();
		// A shift period carrying a real avg delay but a NULL severe share must NOT
		// survive into the severe-share ranking: dropping it at partition time keeps
		// the partition guard and the ranker consistent, and never fabricates a 0%
		// severe share. midday (severe 3%) is the only shift row that should render.
		reliabilityData = {
			...RELIABILITY,
			periods: [
				...RELIABILITY.periods!,
				{ grain: 'am_peak', otp_pct: 70, avg_delay_min: 6.4, severe_pct: null }, // avg-only → dropped
				{ grain: 'midday', otp_pct: 91, avg_delay_min: 1.4, severe_pct: 3 }, // real severe → kept
			],
		} as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const tod = document.querySelector('[data-slot="stop-time-of-day"]') as HTMLElement;
		expect(tod).not.toBeNull();
		// The avg-only am_peak period is gone (no fabricated 0% severe bar)…
		expect(within(tod).queryByText('AM peak')).not.toBeInTheDocument();
		// …and its avg delay (6.4 min) never leaks into this severe-share section.
		expect(within(tod).queryByText('6.4 min')).not.toBeInTheDocument();
		// The real-severe midday row survives and reads its honest severe share.
		expect(within(tod).getByText('Midday')).toBeInTheDocument();
		expect(within(tod).getByText('3.0%')).toBeInTheDocument();
	});

	it('keeps the GrainPicker calendar-only even when shift grains are present', () => {
		reset();
		reliabilityData = RELIABILITY_WITH_TOD;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const group = screen.getByRole('radiogroup', { name: 'Roll-up period' });
		// EXACTLY the three calendar grains are offered — never a shift token.
		const radios = within(group).getAllByRole('radio');
		expect(radios.map((r) => r.textContent?.trim())).toEqual(['Day', 'Week', 'Month']);
		// No shift / day-type token ever leaked into the picker.
		for (const token of [
			'AM peak',
			'PM peak',
			'Midday',
			'Evening',
			'Night',
			'Weekday',
			'Weekend',
		]) {
			expect(within(group).queryByRole('radio', { name: token })).toBeNull();
		}
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
