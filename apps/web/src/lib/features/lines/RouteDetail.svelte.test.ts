import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteFile, StopPrediction, Vehicle } from '$lib/v1';
import RouteDetail from './RouteDetail.svelte';

// A static route file with one direction + two stops, used to render the Detail
// tab (the default active tab).
const ROUTE_FILE = {
	generated_utc: '2026-06-15T12:00:00Z',
	id: '161',
	long: 'Van Horne',
	directions: [
		{
			dir: 0,
			headsign: 'Eastbound',
			stops: [
				{ id: 'sA', seq: 1, name: 'First stop' },
				{ id: 'sB', seq: 2, name: 'Second stop' },
			],
		},
	],
} as RouteFile;

// Per-stop live predictions the Detail tab renders inline. sA has an approaching
// bus (2 min late); sB has NONE → it must show the honest "no live bus".
const PREDICTIONS = new Map<string, StopPrediction>([
	['sA', { etaUtc: '2026-06-15T12:05:00Z', delayMin: 2 }],
]);

// Live service alerts. AL_ROUTE is scoped to route 161 (the route under test) →
// must surface; AL_OTHER is scoped to route 999 → must NOT surface here.
const ALERTS = [
	{
		id: 'al-route',
		severity: 'critical',
		header_key: 'Détour ligne 161',
		header_text: 'Détour ligne 161',
		header_text_en: 'Detour on line 161',
		cause: 'CONSTRUCTION',
		effect: 'DETOUR',
		routes: ['161'],
	},
	{
		id: 'al-other',
		severity: 'watch',
		header_key: 'Autre avis',
		header_text: 'Autre avis',
		header_text_en: 'Unrelated alert',
		routes: ['999'],
	},
];

// Toggle the live store's alert payload so the stand-down test can drive an empty
// state without re-mocking the module.
let liveAlerts: { generated_utc: string; alerts: typeof ALERTS } | null = {
	generated_utc: '2026-06-15T12:00:00Z',
	alerts: ALERTS,
};

// Live vehicles on route 161 for the current-buses roster. busLate is 8 min late
// (worst → sorts first), busEarly is 3 min early, busNoDelay has a null delay
// (honest "no data", sorts last). busOther is on route 999 → must NOT appear.
const VEHICLES: Vehicle[] = [
	{
		id: 'busEarly',
		lat: 45.5,
		lon: -73.6,
		status: 'early',
		updated_utc: '2026-06-15T12:00:00Z',
		route: '161',
		trip: 'tEarly',
		next_stop: 'sB',
		delay_min: -3,
	} as Vehicle,
	{
		id: 'busLate',
		lat: 45.5,
		lon: -73.6,
		status: 'late',
		updated_utc: '2026-06-15T12:00:00Z',
		route: '161',
		trip: 'tLate',
		next_stop: 'sA',
		delay_min: 8,
	} as Vehicle,
	{
		id: 'busNoDelay',
		lat: 45.5,
		lon: -73.6,
		status: 'unknown',
		updated_utc: '2026-06-15T12:00:00Z',
		route: '161',
		trip: 'tNone',
		delay_min: null,
	} as Vehicle,
	{
		id: 'busOther',
		lat: 45.5,
		lon: -73.6,
		status: 'on_time',
		updated_utc: '2026-06-15T12:00:00Z',
		route: '999',
		trip: 'tOther',
		delay_min: 0,
	} as Vehicle,
];

// A live index with the roster adjacency the Detail tab reads. Mutable so the
// stand-down test can drive an EMPTY route (no live vehicle) without re-mocking.
function buildIndex(vehicles: Vehicle[]) {
	const byVehicleId = new Map<string, Vehicle>();
	const vehiclesByRoute = new Map<string, Set<string>>();
	for (const v of vehicles) {
		byVehicleId.set(v.id, v);
		if (v.route) {
			const set = vehiclesByRoute.get(v.route) ?? new Set<string>();
			set.add(v.id);
			vehiclesByRoute.set(v.route, set);
		}
	}
	return { byVehicleId, vehiclesByRoute };
}

let liveIndex: ReturnType<typeof buildIndex> = buildIndex(VEHICLES);

// The live store the Detail tab boots: a minimal stub exposing the index + the
// freshness fields LiveFreshness reads + the loaded alerts. start()/stop() no-op.
const liveStore = {
	get index() {
		return liveIndex as never;
	},
	get alerts() {
		return liveAlerts;
	},
	generatedUtc: '2026-06-15T12:00:00Z',
	ageSeconds: 12,
	isStale: false,
	start: vi.fn(),
	stop: vi.fn(),
};

// Mock $lib/v1 with a clean factory (importing the real barrel pulls the full
// module graph incl. $app/environment, which the jsdom env can't boot). We DO
// use the real alertsForRoute selector — it's a pure file (type-only imports), so
// vi.importActual on it is safe and keeps the keying logic genuinely under test.
vi.mock('$lib/v1', async () => {
	const affected =
		await vi.importActual<typeof import('$lib/v1/affectedAlerts')>('$lib/v1/affectedAlerts');
	return {
		getRoute: vi.fn(),
		getRouteReliability: vi.fn(),
		createLiveStore: () => liveStore,
		getV1Context: () => ({ manifest: {}, labels: {}, lang: 'en' }),
		deriveRouteStopPredictions: () => PREDICTIONS,
		alertsForRoute: affected.alertsForRoute,
	};
});

vi.mock('$lib/v1/resource.svelte', () => ({
	// Both the detail/schedule (route) and reliability resources go through this;
	// the Detail tab only reads the route file, so returning it for both is fine.
	createResource: () => ({
		data: ROUTE_FILE,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

beforeEach(() => {
	liveAlerts = { generated_utc: '2026-06-15T12:00:00Z', alerts: ALERTS };
	liveIndex = buildIndex(VEHICLES);
});

describe('RouteDetail map drilldown', () => {
	it('links directly to the live map filtered to this route', () => {
		render(RouteDetail, { props: { id: '161' } });

		expect(screen.getByRole('link', { name: 'View route 161 on map' })).toHaveAttribute(
			'href',
			'/map?route=161&focus=route%3A161',
		);
	});
});

describe('RouteDetail Detail tab: clickable stops + live readout', () => {
	it('renders each stop as a link to its detail page', () => {
		render(RouteDetail, { props: { id: '161' } });

		expect(screen.getByRole('link', { name: 'View stop First stop' })).toHaveAttribute(
			'href',
			'/stop/sA',
		);
		expect(screen.getByRole('link', { name: 'View stop Second stop' })).toHaveAttribute(
			'href',
			'/stop/sB',
		);
	});

	it('shows the approaching bus on-time status for a stop with a live prediction', () => {
		render(RouteDetail, { props: { id: '161' } });

		// sA has a bus 2 min late.
		expect(screen.getByText('2 min late')).toBeInTheDocument();
	});

	it('shows an honest "no live bus" for a stop with no live prediction', () => {
		render(RouteDetail, { props: { id: '161' } });

		// sB has no approaching bus → the placeholder, never a fabricated time.
		expect(screen.getByText('No live bus')).toBeInTheDocument();
	});

	it('renders the live freshness chip when a live build is present', () => {
		const { container } = render(RouteDetail, { props: { id: '161' } });

		expect(container.querySelector('[data-slot="live-freshness"]')).not.toBeNull();
	});
});

describe('RouteDetail Detail tab: service alerts affecting this route', () => {
	it('surfaces alerts whose routes[] lists this route and hides unrelated ones', () => {
		render(RouteDetail, { props: { id: '161' } });

		const alerts = document.querySelector('[data-testid="route-alerts"]') as HTMLElement;
		expect(alerts).not.toBeNull();
		expect(within(alerts).getByText('Service alerts')).toBeInTheDocument();
		// Route-scoped alert for 161 surfaces with its EN headline + cause/effect.
		expect(within(alerts).getByText('Detour on line 161')).toBeInTheDocument();
		expect(within(alerts).getByText('Construction')).toBeInTheDocument();
		expect(within(alerts).getByText('Detour')).toBeInTheDocument();
		// An alert scoped to a different route (999) must NOT appear here.
		expect(within(alerts).queryByText('Unrelated alert')).not.toBeInTheDocument();
	});

	it('stands the alerts section down when no live alert affects this route', () => {
		liveAlerts = null;
		render(RouteDetail, { props: { id: '161' } });

		expect(document.querySelector('[data-testid="route-alerts"]')).toBeNull();
	});
});

describe('RouteDetail Detail tab: current-buses roster', () => {
	it('renders one row per live vehicle on this route, each linking to its trip', () => {
		render(RouteDetail, { props: { id: '161' } });

		const roster = document.querySelector('[data-testid="route-roster"]') as HTMLElement;
		expect(roster).not.toBeNull();

		// The three 161 buses surface; the route-999 bus must NOT.
		expect(within(roster).getByText('Bus busLate')).toBeInTheDocument();
		expect(within(roster).getByText('Bus busEarly')).toBeInTheDocument();
		expect(within(roster).getByText('Bus busNoDelay')).toBeInTheDocument();
		expect(within(roster).queryByText('Bus busOther')).not.toBeInTheDocument();

		// Each bus row links to its trip detail page.
		expect(
			within(roster).getByRole('link', { name: 'View the trip for bus busLate' }),
		).toHaveAttribute('href', '/trip/tLate');
	});

	it('shows an honest delay reading per bus and never a fabricated 0', () => {
		render(RouteDetail, { props: { id: '161' } });

		const roster = document.querySelector('[data-testid="route-roster"]') as HTMLElement;
		// Known delays read honestly; the null-delay bus reads "no data", never "0".
		expect(within(roster).getByText('8 min late')).toBeInTheDocument();
		expect(within(roster).getByText('3 min early')).toBeInTheDocument();
		expect(within(roster).getByText('No data')).toBeInTheDocument();
		expect(within(roster).queryByText('0 min late')).not.toBeInTheDocument();
	});

	it('offers a per-bus map drilldown link', () => {
		render(RouteDetail, { props: { id: '161' } });

		const roster = document.querySelector('[data-testid="route-roster"]') as HTMLElement;
		expect(within(roster).getByRole('link', { name: 'View bus busLate on map' })).toHaveAttribute(
			'href',
			'/map?vehicle=busLate&focus=vehicle%3AbusLate',
		);
	});

	it('colours an early / on-time bus CALM (status scale), never a problem tone', () => {
		// Honesty lock (calm-by-default): the roster bar's COLOUR is the status band
		// (early = blue), not the problem-severity scale, and the bar LENGTH encodes
		// LATENESS only — an early bus reads near-zero length, never a long red/amber
		// bar. Rows are sorted most-late first → busLate, busEarly, busNoDelay.
		render(RouteDetail, { props: { id: '161' } });

		const roster = document.querySelector('[data-testid="route-roster"]') as HTMLElement;
		const bars = roster.querySelectorAll('[data-slot="severity-bar"]');
		expect(bars.length).toBe(3);

		// busLate (8 min late → severe band ≥5): severe status colour (the PROBLEM
		// tone), escalated a11y band, non-zero bar. The colour stays on the status
		// scale, never the problem-severity scale.
		const lateFill = bars[0].querySelector('.dv-severity-fill') as HTMLElement;
		expect(lateFill).not.toBeNull();
		expect(lateFill.style.background).toContain('--dataviz-status-severe');
		expect(lateFill.style.background).not.toContain('severity');
		expect(bars[0].getAttribute('data-severity')).toBe('high');
		expect(Number.parseFloat(lateFill.style.width)).toBeGreaterThan(0);

		// busEarly (3 min early): CALM blue status colour, calm 'watch' a11y band,
		// zero-length bar (early is not a problem — never red/amber, never long).
		const earlyFill = bars[1].querySelector('.dv-severity-fill') as HTMLElement;
		expect(earlyFill).not.toBeNull();
		expect(earlyFill.style.background).toContain('--dataviz-status-early');
		expect(earlyFill.style.background).not.toContain('severity');
		expect(bars[1].getAttribute('data-severity')).toBe('watch');
		expect(Number.parseFloat(earlyFill.style.width)).toBe(0);

		// busNoDelay (null): no-data track — no fill at all, never a fabricated 0 bar.
		expect(bars[2].querySelector('.dv-severity-fill')).toBeNull();
	});

	it('stands the roster down entirely when no live bus is on this route', () => {
		// A route with no live vehicle (metro, or a feed gap) → no fabricated roster.
		liveIndex = buildIndex([]);
		render(RouteDetail, { props: { id: '161' } });

		expect(document.querySelector('[data-testid="route-roster"]')).toBeNull();
	});
});
