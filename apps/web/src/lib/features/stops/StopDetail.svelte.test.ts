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
	// Routes that SERVE this stop — the route-keying arm of alertsForStop matches a
	// route-scoped alert (routes[] = ['51']) onto this stop via this list.
	routes_served: ['51', '80'],
} as unknown as StopFile;

// Live service alerts. AL_STOP lists this stop directly (stops[]); AL_ROUTE is
// route-scoped to a route this stop serves (51); AL_OTHER touches neither this
// stop nor any route it serves → must NOT surface on this stop.
const ALERTS = [
	{
		id: 'al-stop',
		severity: 'high',
		header_key: 'Ascenseur hors service',
		header_text: 'Ascenseur hors service',
		header_text_en: 'Elevator out of service',
		stops: ['57191'],
	},
	{
		id: 'al-route',
		severity: 'critical',
		header_key: 'Détour ligne 51',
		header_text: 'Détour ligne 51',
		header_text_en: 'Detour on line 51',
		cause: 'CONSTRUCTION',
		effect: 'DETOUR',
		routes: ['51'],
	},
	{
		id: 'al-other',
		severity: 'watch',
		header_key: 'Autre avis',
		header_text: 'Autre avis',
		header_text_en: 'Unrelated alert',
		routes: ['999'],
		stops: ['88888'],
	},
];

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

// Mutable fixtures so individual tests can drive the static stop file + the live
// alert payload without re-mocking. Default = the standard stop + alert set.
let stopFileData: StopFile = STOP_FILE;
let alertsData: { generated_utc: string; alerts: typeof ALERTS } | null = {
	generated_utc: '2026-06-15T12:00:00Z',
	alerts: ALERTS,
};

// A metro-style stop whose static index id differs from its public code, plus an
// alert the live feed targets by that CODE (stops:['10254']) — the regression the
// old id-only keying masked (fixtures used id == code, so the bug never showed).
const STOP_FILE_BY_CODE = {
	generated_utc: '2026-06-15T12:00:00Z',
	id: 'STATION-1',
	name: 'Metro station',
	lat: 45.5,
	lon: -73.6,
	code: '10254',
	scheduled: [],
	routes_served: [],
} as unknown as StopFile;

const ALERTS_BY_CODE = [
	{
		id: 'al-code',
		severity: 'critical',
		header_key: 'Ascenseur de métro hors service',
		header_text: 'Ascenseur de métro hors service',
		header_text_en: 'Metro elevator out of service',
		stops: ['10254'], // targets the CODE, never the index id
	},
];

const liveStore = {
	vehicles: null,
	trips: null,
	departures: { generated_utc: '2026-06-15T12:00:00Z' },
	get alerts() {
		return alertsData;
	},
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
	alerts: null,
	index: { byStopId: new Map<string, StopDeparture[]>() },
};

// A SETTLED board with NO departures for this stop (departures file present so the
// board is past the skeleton; the index has no row for the stop → an empty board)
// AND a live network reporting a served route as scheduled-but-silent. Drives the
// honest-absence "scheduled-silent" path.
const silentBoardLiveStore = {
	...liveStore,
	departures: { generated_utc: '2026-06-15T12:00:00Z' },
	network: { non_responding_by_route: [{ route_id: '51', count: 3 }] },
	index: { byStopId: new Map<string, StopDeparture[]>() },
};

// Toggles the live store + reliability fixture so individual tests can drive an
// empty / null state without re-mocking.
let useEmptyLive = false;
// Selects the settled-but-empty board (with a silent served route) for the
// honest-absence "scheduled-silent" path.
let useSilentBoard = false;
let reliabilityData: StopReliability | null = RELIABILITY;
// Provenance fixture for the honest-absence inference (declared gaps). Default
// has no gaps; tests that need a window/silent reason drive stopFileData + live.
let provenanceData: { generated_utc: string; gaps: string[] } = {
	generated_utc: '2026-06-15T12:00:00Z',
	gaps: [],
};
// Active UI locale for getLocale() — mutable so a FR-localization test can flip it
// without disturbing the (default EN) suite.
let currentLocale: 'en' | 'fr' = 'en';

// Partial-mock i18n: keep the real routing helpers (localizeHref drives the map
// drilldown href assertions) but make getLocale read the per-test currentLocale.
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => currentLocale };
});

// Mock $lib/v1 with a clean factory (importing the real barrel pulls the full
// module graph incl. $app/environment, which the jsdom env can't boot). We DO
// use the real alertsForStop selector — it's a pure file (type-only imports), so
// vi.importActual on it is safe and keeps the keying logic genuinely under test.
vi.mock('$lib/v1', async () => {
	const affected =
		await vi.importActual<typeof import('$lib/v1/affectedAlerts')>('$lib/v1/affectedAlerts');
	// STATUS_LABELS is the shared bilingual status vocabulary the departure-status chips +
	// row captions read (S8B) — pass the REAL table through so the tone labels resolve.
	const enumLabels =
		await vi.importActual<typeof import('$lib/v1/enumLabels')>('$lib/v1/enumLabels');
	return {
		getStop: () => stopFileData,
		getStopReliability: () => reliabilityData,
		getProvenance: () => provenanceData,
		getV1Context: () => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
		createLiveStore: () =>
			useSilentBoard ? silentBoardLiveStore : useEmptyLive ? emptyLiveStore : liveStore,
		alertsForStop: affected.alertsForStop,
		STATUS_LABELS: enumLabels.STATUS_LABELS,
	};
});

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
	useSilentBoard = false;
	reliabilityData = RELIABILITY;
	stopFileData = STOP_FILE;
	alertsData = { generated_utc: '2026-06-15T12:00:00Z', alerts: ALERTS };
	provenanceData = { generated_utc: '2026-06-15T12:00:00Z', gaps: [] };
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
	// NOTE (S8A re-seat): the grain-availability + grain-switch + calendar-only assertions
	// moved to StopReliabilitySurface.svelte.test.ts (the grain rail now lives in the
	// decomposed surface, and StopDetail renders BOTH the desktop + mobile rails so a
	// bare getByRole('radiogroup') is ambiguous here). StopDetail keeps only the
	// tab-scaffold + localized card-heading coverage below.
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
		// P5.2: the heatmap is the classed-tier <Chart> mark — a labelled figure (the
		// sr-only table is the AT mirror; LayerChart paints only in a real layout).
		expect(
			screen.getByRole('figure', { name: 'Severe-delay heatmap by day and hour' }),
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
		// P5.2: the proportion strip is a stacked-share <Chart> mark — a labelled figure
		// whose aria-label carries the band summary (LayerChart paints nothing in
		// happy-dom, so the figure + its sr-only table are the layout-independent read).
		expect(
			within(crowding).getByRole('figure', {
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
		// styled honest-absence chip renders in its place (keeps the heading framing).
		const empty = document.querySelector('[data-slot="stop-crowding-empty"]') as HTMLElement;
		expect(empty).not.toBeNull();
		expect(within(empty).getByText('Crowding on buses seen here')).toBeInTheDocument();
		// The ONE styled honest-absence chip (calm "no data, not enough readings yet"),
		// not a plain easy-to-miss note.
		const chip = within(empty)
			.getByText('not enough readings yet')
			.closest('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
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
		// FR styled honest-absence chip: "Aucune donnée · pas assez de mesures".
		const chip = within(empty)
			.getByText('pas assez de mesures')
			.closest('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
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

		// Honesty regression guard: with NO graded periods, the ReliabilityPane
		// self-guards to render nothing — so its wrapping stop-tile must ALSO stand
		// down. Neither the bordered tile nor the pane may linger in the grid; an
		// empty bordered card is a fabricated tile.
		expect(document.querySelector('[data-slot="stop-reliability-pane"]')).toBeNull();
		expect(document.querySelector('[data-slot="reliability-pane"]')).toBeNull();
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

		// S8A re-seat renders the desktop SurfaceControls rail AND the mobile ControlsRail
		// (jsdom applies no CSS media query), so scope to the first (desktop) radiogroup.
		const group = screen.getAllByRole('radiogroup', { name: 'Roll-up period' })[0];
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

describe('StopDetail live departures — HONEST ABSENCE (empty board)', () => {
	it('states "scheduled, but no vehicle reporting" when a served route is silent in-window', () => {
		reset();
		// A 24h schedule window (00:00 → 23:59 → always open regardless of the test
		// clock) on a served route (51) that the live network reports silent.
		stopFileData = {
			...STOP_FILE,
			scheduled: [{ route: '51', headsign: 'X', times: ['00:00', '23:59'] }],
		} as unknown as StopFile;
		useSilentBoard = true;
		render(StopDetail, { props: { id: '57191' } });

		expect(
			screen.getByText('Scheduled, but no vehicle is reporting live right now.'),
		).toBeInTheDocument();
	});

	it('falls back to the generic honest no-data copy when no reason is derivable', () => {
		reset();
		// No schedule window + no silent signal → inferAbsenceReason returns null →
		// the plain honest "Nothing to show", never a fabricated reason.
		stopFileData = { ...STOP_FILE, scheduled: [] } as unknown as StopFile;
		useSilentBoard = true;
		render(StopDetail, { props: { id: '57191' } });

		// The board's empty state shows the generic honest no-data copy (the active
		// "next" tab renders one; getAllByText tolerates other inert panes).
		expect(screen.getAllByText('Nothing to show').length).toBeGreaterThan(0);
		expect(
			screen.queryByText('Scheduled, but no vehicle is reporting live right now.'),
		).not.toBeInTheDocument();
	});
});

describe('StopDetail — service alerts affecting this stop', () => {
	it('surfaces alerts that list this stop OR a route it serves, and hides unrelated ones', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));

		const alerts = document.querySelector('[data-testid="stop-alerts"]') as HTMLElement;
		expect(alerts).not.toBeNull();
		expect(within(alerts).getByText('Service alerts')).toBeInTheDocument();

		// Stop-scoped alert (stops[] lists 57191) surfaces.
		expect(within(alerts).getByText('Elevator out of service')).toBeInTheDocument();
		// Route-scoped alert on route 51 (which this stop serves) surfaces.
		expect(within(alerts).getByText('Detour on line 51')).toBeInTheDocument();
		// An alert touching neither this stop nor any route it serves must NOT appear.
		expect(within(alerts).queryByText('Unrelated alert')).not.toBeInTheDocument();
		// The route-scoped alert's cause/effect resolve through gtfsAlertLabels.
		expect(within(alerts).getByText('Construction')).toBeInTheDocument();
		expect(within(alerts).getByText('Detour')).toBeInTheDocument();
	});

	it('localizes the alerts section + headlines in FR', () => {
		reset();
		currentLocale = 'fr';
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));

		const alerts = document.querySelector('[data-testid="stop-alerts"]') as HTMLElement;
		expect(within(alerts).getByText('Avis de service')).toBeInTheDocument();
		expect(within(alerts).getByText('Détour ligne 51')).toBeInTheDocument();
		// CONSTRUCTION → Travaux (fr).
		expect(within(alerts).getByText('Travaux')).toBeInTheDocument();
	});

	it('stands the alerts section down when no live alert affects this stop', () => {
		reset();
		useEmptyLive = true; // empty live store: no alerts loaded
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));

		expect(document.querySelector('[data-testid="stop-alerts"]')).toBeNull();
	});

	it('surfaces an alert the live feed targets by CODE when id != code (metro regression)', () => {
		reset();
		// The static index id ('STATION-1') differs from the public code ('10254');
		// the live feed targets the stop by its CODE. The alert must surface — the
		// old id-only keying silently missed it for the ~72 stops where id != code.
		stopFileData = STOP_FILE_BY_CODE;
		alertsData = { generated_utc: '2026-06-15T12:00:00Z', alerts: ALERTS_BY_CODE as typeof ALERTS };
		render(StopDetail, { props: { id: 'STATION-1' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));

		const alerts = document.querySelector('[data-testid="stop-alerts"]') as HTMLElement;
		expect(alerts).not.toBeNull();
		expect(within(alerts).getByText('Metro elevator out of service')).toBeInTheDocument();
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

// ── S8B widget tests ─────────────────────────────────────────────────────────
// Colored next-departure statuses (5-tone + severe representable + colour+glyph),
// the column-major 5-col schedule grid + honest per-route gaps, the 2-col Info
// pane with tri-state accessibility. All read the shared kernels (delayTone /
// STATUS_LABELS / AbsentValue) — no invented per-surface vocabulary.

// A board carrying a SEVERE departure (delay >= 5) under a fresh id so the shared
// DEPARTURES fixture (which tops out at +4 = 'late') is untouched.
const SEVERE_DEPARTURES = [
	{ eta_utc: '2026-06-15T12:05:00Z', route: '51', delay_min: 9 }, // severe (>=5)
	{ eta_utc: '2026-06-15T12:08:00Z', route: '80', delay_min: 0 }, // on time
] as StopDeparture[];

describe('StopDetail live departures — colored statuses (S8B)', () => {
	it('offers all four tone chips incl. a representable SEVERE (not absorbed into late)', () => {
		reset();
		render(StopDetail, { props: { id: '57191' } });
		// STATUS_LABELS (en) drive the chip text — severe is its own chip now.
		expect(screen.getByRole('button', { name: /On-time/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Late/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Severe/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Early/ })).toBeInTheDocument();
	});

	it('tints each departure caption with the shared status fill AND a redundant glyph', () => {
		reset();
		const { container } = render(StopDetail, { props: { id: '57191' } });
		// The +4 late departure's caption carries the late status fill + the ▲ glyph.
		const late = Array.from(container.querySelectorAll('.stop-departure-delay')).find((el) =>
			el.textContent?.includes('+4 min late'),
		) as HTMLElement;
		expect(late).toBeDefined();
		expect(late.getAttribute('data-tone')).toBe('late');
		expect(late.getAttribute('style') ?? '').toContain('--dataviz-status-late');
		expect(late.querySelector('.stop-departure-glyph')?.textContent).toBe('▲');
	});

	it('bands a >=5 min departure to the SEVERE tone (its own severe fill)', () => {
		reset();
		liveStore.index.byStopId.set('SEVERE-1', SEVERE_DEPARTURES);
		const { container } = render(StopDetail, { props: { id: 'SEVERE-1' } });
		const severe = Array.from(container.querySelectorAll('.stop-departure-delay')).find(
			(el) => el.getAttribute('data-tone') === 'severe',
		) as HTMLElement;
		expect(severe).toBeDefined();
		expect(severe.getAttribute('style') ?? '').toContain('--dataviz-status-severe');
		liveStore.index.byStopId.delete('SEVERE-1');
	});
});

describe('StopDetail schedule — 5-col column-major grid + honest gaps (S8B/B4)', () => {
	it('renders a 5-column grid with an explicit row count (ceil(n/5))', () => {
		reset();
		stopFileData = {
			...STOP_FILE,
			scheduled: [
				{
					route: '51',
					headsign: 'Nord',
					times: ['08:00', '08:10', '08:20', '08:30', '08:40', '08:50'],
				},
			],
		} as unknown as StopFile;
		const { container } = render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		const grid = container.querySelector('.stop-schedule-times') as HTMLElement;
		expect(grid).not.toBeNull();
		// 6 times over 5 columns → ceil(6/5) = 2 rows (column-major vertical fill).
		expect((grid.getAttribute('style') ?? '').replace(/\s/g, '')).toContain('--sched-rows:2');
	});

	it('states an honest per-route absence when a listed route has NO times', () => {
		reset();
		stopFileData = {
			...STOP_FILE,
			scheduled: [{ route: '99', headsign: 'Vide', times: [] }],
		} as unknown as StopFile;
		const { container } = render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		// The route header still renders; its times block is an honest AbsentValue, not
		// a silently empty grid.
		expect(container.querySelector('.stop-schedule-times')).toBeNull();
		const route = container.querySelector('.stop-schedule-route') as HTMLElement;
		expect(route.querySelector('[data-slot]')?.textContent ?? route.textContent).not.toBe('99');
	});
});

describe('StopDetail info — 2-col layout + tri-state accessibility (S8B/A3)', () => {
	it('lays the Info pane out as facts (left) + alerts (right)', () => {
		reset();
		const { container } = render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
		const info = container.querySelector('.stop-info') as HTMLElement;
		expect(info).not.toBeNull();
		// The facts column + the alerts block are the two grid children.
		expect(info.querySelector('.stop-info-facts')).not.toBeNull();
		expect(info.querySelector('[data-testid="stop-alerts"]')).not.toBeNull();
	});

	it('renders accessibility as YES when wheelchair === true', () => {
		reset();
		stopFileData = { ...STOP_FILE, wheelchair: true } as unknown as StopFile;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
		expect(screen.getByText('Wheelchair accessible')).toBeInTheDocument();
	});

	it('renders accessibility as NO when wheelchair === false', () => {
		reset();
		stopFileData = { ...STOP_FILE, wheelchair: false } as unknown as StopFile;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
		expect(screen.getByText('Not wheelchair accessible')).toBeInTheDocument();
	});

	it('renders an honest UNKNOWN (not a silent omit) when wheelchair is absent', () => {
		reset();
		// STOP_FILE has no `wheelchair` field → the tri-state renders the label with a
		// styled absence chip, never dropping the accessibility field silently.
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
		// The label still shows (the field is not omitted)...
		expect(screen.getByText('Accessibility')).toBeInTheDocument();
		// ...and neither the YES nor NO copy is present (it is the unknown chip).
		expect(screen.queryByText('Wheelchair accessible')).not.toBeInTheDocument();
		expect(screen.queryByText('Not wheelchair accessible')).not.toBeInTheDocument();
	});
});
