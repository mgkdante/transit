import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteFile, StopPrediction } from '$lib/v1';
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

// The live store the Detail tab boots: a minimal stub exposing the index + the
// freshness fields LiveFreshness reads + the loaded alerts. start()/stop() no-op.
const liveStore = {
	index: {} as never,
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
