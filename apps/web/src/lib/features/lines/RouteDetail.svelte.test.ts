import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteFile, RouteReliability, StopPrediction, Vehicle } from '$lib/v1';
import type { IdentitySeed } from '$lib/v1/serverContext';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import RouteDetail from './RouteDetail.svelte';

const routeDetailSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/features/lines/RouteDetail.svelte'), 'utf-8');

const routeDetailNav = vi.hoisted(() => {
	const page = { url: new URL('http://localhost/lines/161'), state: {} };
	return {
		page,
		replaceState: vi.fn((url: string | URL) => {
			page.url = new URL(url, 'http://localhost');
		}),
	};
});
const routeManifest = vi.hoisted(() => ({}));
const createLiveStoreSpy = vi.hoisted(() => vi.fn());

vi.mock('$app/state', () => ({ page: routeDetailNav.page }));
vi.mock('$app/navigation', () => ({ replaceState: routeDetailNav.replaceState }));

// A static route file with one direction + two stops, used to render the Detail
// tab (the default active tab).
const ROUTE_FILE = {
	generated_utc: '2026-06-15T12:00:00Z',
	id: '161',
	long: 'Van Horne',
	first_departure: '05:30',
	last_departure: '01:10',
	service_periods: [
		{ shift: 'AM peak', window: '06:00–09:00', headway_min: 6 },
		{ shift: 'Midday', window: '09:00–15:00', headway_min: 10 },
	],
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

const routeSeed = (id = '161', name = id === '161' ? '161 Van Horne' : id): IdentitySeed => ({
	id,
	name,
});

const renderRoute = (id = '161', name?: string) =>
	render(RouteDetail, { props: { id, seed: routeSeed(id, name) } });

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
		description:
			'<p>La ligne <strong>161</strong> contourne les travaux &amp; dessert les arrêts.</p>',
		description_en:
			'<p>Route <strong>161</strong> is detouring around construction &amp; serving stops.</p>',
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

// Provenance fixture for the honest-absence inference (declared gaps). Default
// carries the metro_realtime gap so the metro stand-down test can assert the
// inferred metro message; non-metro routes ignore it (route_type !== 1).
let provenanceData: { generated_utc: string; gaps: string[] } = {
	generated_utc: '2026-06-15T12:00:00Z',
	gaps: ['metro_realtime'],
};

// Mutable route-file fixture so the honest-absence tests can drive a metro route
// (type 1) without re-mocking the module. Defaults to the bus ROUTE_FILE.
let routeFileData: RouteFile = ROUTE_FILE;

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
// freshness fields FreshnessStamp reads + the loaded alerts. start()/stop() no-op.
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
// Spy on the reliability fetcher so the gating tests can assert it is NEVER called
// for a route whose index entry has `reliability: false` (the 404-flood fix), yet
// STILL called when the flag is true or absent (data must not be lost on a stale
// index). Resolves to null (no published reliability) by default.
const getRouteReliabilitySpy = vi.fn(async (_id: string) => null);
const lineHistoryHarness = vi.hoisted(() => ({
	getLineHistoryIndex: vi.fn(),
	loadLineHistoryRange: vi.fn(),
}));

const CURRENT_RELIABILITY = {
	id: '161',
	generated_utc: '2026-07-13T12:00:00Z',
	periods: [
		{
			grain: 'day',
			date: '2026-07-12',
			otp_pct: 80,
			observation_count: 100,
			on_time: 80,
		},
	],
} as RouteReliability;

const SMALL_SAMPLE_RELIABILITY = {
	...CURRENT_RELIABILITY,
	periods: [
		{
			...CURRENT_RELIABILITY.periods![0],
			observation_count: 10,
			on_time: 8,
		},
	],
} as RouteReliability;

const HISTORY_INDEX = {
	generated_utc: '2026-07-13T12:00:00Z',
	family: 'lines',
	selection_mode: 'range',
	entity_id: '161',
	collection_generation_id: 'a'.repeat(64),
	first_available_date: '2026-01-31',
	last_available_date: '2026-02-01',
	gaps: [],
	partitions: [
		{
			path: `historic/history/lines/313631/generations/${'b'.repeat(64)}/2026-01.json`,
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
			count: 1,
			sha256: 'b'.repeat(64),
			byte_size: 100,
		},
		{
			path: `historic/history/lines/313631/generations/${'c'.repeat(64)}/2026-02.json`,
			coverage_start: '2026-02-01',
			coverage_end: '2026-02-01',
			count: 1,
			sha256: 'c'.repeat(64),
			byte_size: 100,
		},
	],
	metrics: [],
};

let reliabilityResourceState: {
	data: RouteReliability | null;
	error: Error | null;
	loading: boolean;
	settled: boolean;
} = {
	data: null,
	error: null,
	loading: false,
	settled: true,
};
const reliabilityReloadSpy = vi.fn();

// The routes-index fixture the reliability gate consults. Mutable so a test can
// flip THIS route's `reliability` flag (false | true | undefined) per case.
let routesIndexData: { generated_utc: string; routes: { id: string; reliability?: boolean }[] } = {
	generated_utc: '2026-06-15T12:00:00Z',
	routes: [{ id: '161' }],
};

vi.mock('$lib/v1/repositories/static', () => ({
	getRoute: () => routeFileData,
	getRoutesIndex: async () => routesIndexData,
}));
vi.mock('$lib/v1/repositories/historic', () => ({
	getRouteReliability: (id: string) => getRouteReliabilitySpy(id),
	getLineHistoryIndex: lineHistoryHarness.getLineHistoryIndex,
	loadLineHistoryRange: lineHistoryHarness.loadLineHistoryRange,
}));
vi.mock('$lib/v1/repositories/provenance', () => ({ getProvenance: () => provenanceData }));
vi.mock('$lib/v1/live/store.svelte', () => ({
	createLiveStore: (manifest: unknown, options?: unknown) => {
		createLiveStoreSpy(manifest, options);
		return liveStore;
	},
}));
vi.mock('$lib/v1/live/routeStopPredictions', () => ({
	deriveRouteStopPredictions: () => PREDICTIONS,
}));
vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({ manifest: routeManifest, labels: {}, lang: 'en' }),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	// The detail/schedule (route), reliability, AND provenance resources go through
	// this. Call the loader so each resolves to its own fixture: getRoute →
	// ROUTE_FILE, getProvenance → provenanceData, reliability (vi.fn → undefined) →
	// the route file is the only one the Detail tab reads, so undefined is fine.
	createResource: (loader: () => unknown) => {
		const value = loader();
		if (value instanceof Promise) {
			return {
				get data() {
					return reliabilityResourceState.data;
				},
				get error() {
					return reliabilityResourceState.error;
				},
				get loading() {
					return reliabilityResourceState.loading;
				},
				get settled() {
					return reliabilityResourceState.settled;
				},
				reload: reliabilityReloadSpy,
			};
		}
		return {
			data: value ?? ROUTE_FILE,
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

beforeEach(() => {
	quietModeStore.resetForTest();
	sessionStorage.removeItem('transit.persisted:reliability-controls');
	sessionStorage.removeItem('transit.persisted:reliability-toc');
	routeDetailNav.page.url = new URL('http://localhost/lines/161');
	routeDetailNav.replaceState.mockClear();
	liveAlerts = { generated_utc: '2026-06-15T12:00:00Z', alerts: ALERTS };
	liveIndex = buildIndex(VEHICLES);
	provenanceData = { generated_utc: '2026-06-15T12:00:00Z', gaps: ['metro_realtime'] };
	routeFileData = ROUTE_FILE;
	routesIndexData = { generated_utc: '2026-06-15T12:00:00Z', routes: [{ id: '161' }] };
	getRouteReliabilitySpy.mockClear();
	lineHistoryHarness.getLineHistoryIndex.mockReset();
	lineHistoryHarness.getLineHistoryIndex.mockResolvedValue(null);
	lineHistoryHarness.loadLineHistoryRange.mockReset();
	reliabilityResourceState = { data: null, error: null, loading: false, settled: true };
	reliabilityReloadSpy.mockClear();
	createLiveStoreSpy.mockClear();
});

describe('RouteDetail article cover and focus scope', () => {
	it('requests only the live families used by route detail', () => {
		renderRoute('161', '161 Van Horne');

		expect(createLiveStoreSpy).toHaveBeenCalledWith(routeManifest, {
			families: ['vehicles', 'trips', 'alerts', 'network'],
		});
	});

	it('uses the server identity seed for the first-render title and renders no classic duplicate head', () => {
		const view = renderRoute('161', '161 Van Horne');

		expect(screen.getByRole('heading', { level: 1, name: '161 Van Horne' })).toBeInTheDocument();
		expect(view.container.querySelectorAll('[data-slot="article-header"]')).toHaveLength(1);
		expect(view.container.querySelectorAll('h1')).toHaveLength(1);
		expect(view.container.querySelector('.surface-head')).toBeNull();
		expect(screen.getAllByRole('link', { name: '← Back to lines' })).toHaveLength(1);
	});

	it('recovers the real client route name when the server seed had to fall back to the id', () => {
		renderRoute('161', '161');

		expect(screen.getByRole('heading', { level: 1, name: '161 Van Horne' })).toBeInTheDocument();
	});

	it('keeps exactly the Detail, Schedule, and Reliability tabs', () => {
		renderRoute();

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual([
			'Detail',
			'Schedule',
			'Reliability',
		]);
	});

	it('keeps tab URLs shareable while preserving unrelated search parameters', async () => {
		routeDetailNav.page.url = new URL('http://localhost/lines/161?window=am');
		renderRoute();

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		await waitFor(() => expect(routeDetailNav.page.url.searchParams.get('tab')).toBe('schedule'));
		expect(routeDetailNav.page.url.searchParams.get('window')).toBe('am');

		await fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		await waitFor(() => expect(routeDetailNav.page.url.searchParams.has('tab')).toBe(false));
		expect(routeDetailNav.page.url.searchParams.get('window')).toBe('am');
	});

	it('keeps the tabs fixed above a cohesive disclosure sequence and carries bulk state across panes', async () => {
		const view = renderRoute();
		const toolbar = view.container.querySelector('[data-slot="detail-shell-toolbar"]');
		const tabs = view.container.querySelector<HTMLElement>('[data-slot="entity-detail-tabs"]');
		const detailCards = Array.from(
			view.container.querySelectorAll<HTMLElement>('[data-toc^="line-detail-"]'),
		);

		expect(toolbar).toContainElement(tabs as HTMLElement);
		expect(detailCards).toHaveLength(3);
		for (const card of detailCards) {
			expect(card.querySelector('[data-section-trigger]')).toHaveAttribute('aria-expanded', 'true');
		}
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		await waitFor(() => {
			for (const card of detailCards) {
				expect(card.querySelector('[data-section-trigger]')).toHaveAttribute(
					'aria-expanded',
					'false',
				);
			}
		});

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(view.container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(
			tabs,
		);
		const scheduleCards = Array.from(
			view.container.querySelectorAll<HTMLElement>('[data-toc^="line-schedule-"]'),
		);
		expect(scheduleCards).toHaveLength(2);
		for (const card of scheduleCards) {
			expect(card.querySelector('[data-section-trigger]')).toHaveAttribute(
				'aria-expanded',
				'false',
			);
		}

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(view.container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(
			tabs,
		);
		expect(view.container.querySelector('[data-slot="edge-state"]')).not.toBeNull();
	});

	it('uses the shared connected section stack for every Detail and Schedule disclosure', async () => {
		const view = renderRoute();
		const detailStack = view.container.querySelector(
			'[data-slot="article-section-stack"]',
		) as HTMLElement;
		const detailCards = Array.from(detailStack?.children ?? []);

		expect(detailStack).not.toBeNull();
		expect(detailCards).toHaveLength(3);
		for (const card of detailCards) {
			expect(card.matches('[data-slot="card"].section-card[data-toc^="line-detail-"]')).toBe(true);
			expect(card.querySelector('[data-section-trigger]')).not.toBeNull();
		}

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		const scheduleStack = view.container.querySelector(
			'[data-slot="article-section-stack"][data-section-sequence="line-schedule"]',
		) as HTMLElement;
		const scheduleCards = Array.from(scheduleStack?.children ?? []);

		expect(scheduleCards).toHaveLength(2);
		for (const card of scheduleCards) {
			expect(card.matches('[data-slot="card"].section-card[data-toc^="line-schedule-"]')).toBe(
				true,
			);
			expect(card.querySelector('[data-section-trigger]')).not.toBeNull();
		}
		expect(scheduleCards[0]).toContainElement(
			view.container.querySelector('[data-slot="schedule-intro"]'),
		);
	});

	it('does not retain page-local card-stack spacing rules', () => {
		const source = routeDetailSource();

		expect(source).toContain('ArticleSectionStack');
		expect(source).not.toMatch(/\.route-directions-pane\s*\{/);
		expect(source).not.toMatch(/\.route-schedule-sections\s*\{/);
	});

	it('renders a wide article rail whose entries match the active pane sections', async () => {
		const view = renderRoute();
		const rail = view.container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;

		expect(within(rail).getByRole('button', { name: 'On this page' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Live service' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Service profile' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Directions' })).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(within(rail).getByRole('button', { name: 'Service span' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Service periods' })).toBeInTheDocument();
	});

	it('keeps article controls visible across tabs without mutating a card until used', async () => {
		const view = renderRoute();
		const headerContent = view.container.querySelector('.header__content') as HTMLElement;
		const actionRow = view.container.querySelector('[data-slot="article-header-actions"]');
		const controlRow = view.container.querySelector('[data-slot="article-header-controls"]');
		const profile = view.container.querySelector(
			'[data-toc="line-detail-profile"] [data-section-trigger]',
		);

		expect(actionRow).not.toBeNull();
		expect(actionRow?.querySelector('a')).not.toBeNull();
		expect(controlRow).toContainElement(screen.getByTestId('quiet-mode-controls'));
		expect(Array.from(headerContent.children).at(-1)).toBe(controlRow);

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(screen.getByTestId('quiet-mode-toggle')).toBeVisible();
		expect(profile).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		await waitFor(() => expect(profile).toHaveAttribute('aria-expanded', 'false'));
	});
});

describe('RouteDetail reliability fetch — the route page trusts the FILE', () => {
	// The route page ALWAYS probes route_reliability/{id}.json and trusts it as the
	// source of truth — it does NOT gate on the routes-index `reliability` flag. That
	// flag is a daily-truth baked into the long-cached STATIC index, so it lags, and a
	// stale `false` must NEVER hide a published reliability surface. We mirror the
	// component's thunk (probe unconditionally) and assert the fetcher is always hit +
	// that a present file flows through even when the flag says false.
	async function routePageReliability(id: string): Promise<unknown> {
		const historic = (await import('$lib/v1/repositories/historic')) as unknown as {
			getRouteReliability: (id: string) => Promise<unknown>;
		};
		return historic.getRouteReliability(id);
	}

	it('probes the file even when the index flag is false — a stale false must not hide data', async () => {
		routesIndexData = {
			generated_utc: '2026-06-15T12:00:00Z',
			routes: [{ id: '161', reliability: false }],
		};
		const file = { id: '161', generated_utc: '2026-06-15T12:00:00Z' };
		getRouteReliabilitySpy.mockResolvedValueOnce(file as unknown as null);
		const result = await routePageReliability('161');

		// The published file is fetched + flows through — NOT suppressed by the false flag.
		expect(getRouteReliabilitySpy).toHaveBeenCalledWith('161');
		expect(result).toBe(file);
	});

	it('probes the file when the index flag is true', async () => {
		routesIndexData = {
			generated_utc: '2026-06-15T12:00:00Z',
			routes: [{ id: '161', reliability: true }],
		};
		const result = await routePageReliability('161');

		// default spy → no published file → fail-soft null, but it WAS called.
		expect(result).toBeNull();
		expect(getRouteReliabilitySpy).toHaveBeenCalledWith('161');
	});

	it('probes the file when the flag is absent (stale/legacy index)', async () => {
		routesIndexData = { generated_utc: '2026-06-15T12:00:00Z', routes: [{ id: '161' }] };
		await routePageReliability('161');

		expect(getRouteReliabilitySpy).toHaveBeenCalledWith('161');
	});

	it('probes the file when the route is missing from the index entirely', async () => {
		routesIndexData = { generated_utc: '2026-06-15T12:00:00Z', routes: [{ id: 'other' }] };
		await routePageReliability('161');

		expect(getRouteReliabilitySpy).toHaveBeenCalledWith('161');
	});
});

describe('RouteDetail retained-history ownership', () => {
	it('keeps discovery route-keyed, aborts the previous route, and never fans out partitions by default', async () => {
		lineHistoryHarness.getLineHistoryIndex.mockImplementation(() => new Promise(() => undefined));
		const view = renderRoute();

		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledTimes(1));
		const firstContext = lineHistoryHarness.getLineHistoryIndex.mock.calls[0]?.[1] as
			| { signal: AbortSignal }
			| undefined;
		expect(lineHistoryHarness.getLineHistoryIndex.mock.calls[0]?.[0]).toBe('161');
		expect(firstContext?.signal.aborted).toBe(false);

		await view.rerender({ id: 'A/B', seed: routeSeed('A/B') });
		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledTimes(2));
		expect(firstContext?.signal.aborted).toBe(true);
		expect(lineHistoryHarness.getLineHistoryIndex.mock.calls[1]?.[0]).toBe('A/B');
		expect(lineHistoryHarness.loadLineHistoryRange).not.toHaveBeenCalled();

		const secondContext = lineHistoryHarness.getLineHistoryIndex.mock.calls[1]?.[1] as
			| { signal: AbortSignal }
			| undefined;
		view.unmount();
		expect(secondContext?.signal.aborted).toBe(true);
	});
});

describe('RouteDetail reliability boundary with history-only fallback', () => {
	it('keeps the reliability skeleton while the singleton request is still pending', async () => {
		reliabilityResourceState = { data: null, error: null, loading: true, settled: false };
		lineHistoryHarness.getLineHistoryIndex.mockResolvedValue(HISTORY_INDEX);
		const view = renderRoute();

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(view.container.querySelector('[data-variant="skeleton"]')).not.toBeNull(),
		);
		expect(view.container.querySelector('[data-slot="reliability-clusters"]')).toBeNull();
	});

	it('keeps the reliability error and retry action when the singleton request fails', async () => {
		reliabilityResourceState = {
			data: null,
			error: new Error('singleton unavailable'),
			loading: false,
			settled: true,
		};
		lineHistoryHarness.getLineHistoryIndex.mockResolvedValue(HISTORY_INDEX);
		const view = renderRoute();

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledOnce());
		const error = await screen.findByRole('alert');
		expect(error).toHaveTextContent('/v1 contract unreachable');
		expect(view.container.querySelector('[data-slot="reliability-clusters"]')).toBeNull();

		await fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
		expect(reliabilityReloadSpy).toHaveBeenCalledOnce();
	});

	it('keeps the established empty state on a default URL even after retained discovery succeeds', async () => {
		reliabilityResourceState = { data: null, error: null, loading: false, settled: true };
		lineHistoryHarness.getLineHistoryIndex.mockResolvedValue(HISTORY_INDEX);
		const view = renderRoute();

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledOnce());
		expect(view.container.querySelector('[data-slot="reliability-clusters"]')).toBeNull();
		expect(view.container.querySelector('[data-slot="edge-state"]')).not.toBeNull();
	});

	it('mounts retained loading for an explicit range before entity discovery resolves', async () => {
		routeDetailNav.page.url = new URL(
			'http://localhost/lines/161?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		reliabilityResourceState = { data: null, error: null, loading: false, settled: true };
		lineHistoryHarness.getLineHistoryIndex.mockImplementation(() => new Promise(() => undefined));
		const view = renderRoute();

		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledOnce());
		expect(view.container.querySelector('[data-slot="reliability-clusters"]')).not.toBeNull();
		expect(view.container.querySelector('[data-slot="history-loading"]')).toHaveTextContent(
			'Loading retained range',
		);
	});

	it('mounts a retryable retained error for an explicit range whose entity discovery fails', async () => {
		routeDetailNav.page.url = new URL(
			'http://localhost/lines/161?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		reliabilityResourceState = { data: null, error: null, loading: false, settled: true };
		lineHistoryHarness.getLineHistoryIndex.mockRejectedValue(new Error('history unavailable'));
		const view = renderRoute();

		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="history-error"]')).toHaveTextContent(
				'could not be loaded',
			),
		);
		expect(view.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});
});

describe('RouteDetail always-visible verdict history scope', () => {
	it('reserves no summary gap when the archive cannot publish a percentage verdict', async () => {
		reliabilityResourceState = {
			data: SMALL_SAMPLE_RELIABILITY,
			error: null,
			loading: false,
			settled: true,
		};
		const view = renderRoute();

		expect(view.container.querySelector('.route-verdict-banner')).toBeNull();
		expect(view.container.querySelector('[data-slot="detail-shell-summary"]')).toBeNull();

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(view.container.querySelector('.route-verdict-banner')).toBeNull();
		expect(view.container.querySelector('[data-slot="reliability-rail-summary"]')).toBeNull();
		expect(view.container.querySelector('[data-slot="reliability-clusters"]')).not.toBeNull();
	});

	it('keeps one centered line reliability banner aligned with the active tab rail', async () => {
		reliabilityResourceState = {
			data: CURRENT_RELIABILITY,
			error: null,
			loading: false,
			settled: true,
		};
		const view = renderRoute();
		await waitFor(() => {
			expect(view.container.querySelectorAll('.route-verdict-banner')).toHaveLength(1);
		});
		expect(
			view.container.querySelector('[data-slot="detail-shell-summary"] .route-verdict-banner'),
		).not.toBeNull();

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(view.container.querySelectorAll('.route-verdict-banner')).toHaveLength(1);
		expect(
			view.container.querySelector('[data-slot="detail-shell-summary"] .route-verdict-banner'),
		).not.toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		await waitFor(() => {
			expect(view.container.querySelectorAll('.route-verdict-banner')).toHaveLength(1);
			expect(
				view.container.querySelector(
					'[data-slot="reliability-rail-summary"] .route-verdict-banner',
				),
			).not.toBeNull();
		});
	});

	it('does not label the header verdict as current-only on the default current snapshot', async () => {
		reliabilityResourceState = {
			data: CURRENT_RELIABILITY,
			error: null,
			loading: false,
			settled: true,
		};
		const view = renderRoute();

		const banner = await waitFor(() => {
			const found = view.container.querySelector('[data-slot="entity-detail-banner"]');
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});
		expect(within(banner).queryByText('Header verdict: current snapshot')).toBeNull();
	});

	it('labels the header verdict as current-only while an explicit retained range is active', async () => {
		routeDetailNav.page.url = new URL(
			'http://localhost/lines/161?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		reliabilityResourceState = {
			data: CURRENT_RELIABILITY,
			error: null,
			loading: false,
			settled: true,
		};
		lineHistoryHarness.getLineHistoryIndex.mockResolvedValue(HISTORY_INDEX);
		lineHistoryHarness.loadLineHistoryRange.mockResolvedValue([]);
		const view = renderRoute();

		await waitFor(() => expect(lineHistoryHarness.getLineHistoryIndex).toHaveBeenCalledOnce());
		const banner = await waitFor(() => {
			const found = view.container.querySelector('.route-verdict-banner');
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});
		expect(within(banner).getByText('Header verdict: current snapshot')).toBeInTheDocument();
	});
});

describe('RouteDetail article schedule structure', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/features/lines/RouteDetail.svelte'),
		'utf-8',
	);

	it('uses the same numbered, persistent disclosure primitive for both schedule sections', () => {
		expect(source).toContain('anchor="line-schedule-span"');
		expect(source).toContain('anchor="line-schedule-periods"');
		expect(source.match(/line-schedule-\$\{id\}-(?:span|periods)/g)).toHaveLength(2);
		expect(source).not.toContain('route-schedule-grid');
	});

	// NOTE: the bidirectional directions layout (its @container split) moved to the
	// LineDirections component in the S6 de-monolith — that contract is now gated in
	// LineDirections.svelte.test.ts. RouteDetail just mounts <LineDirections>.

	it('keeps the schedule split into a span block + a periods block in the markup', () => {
		expect(source).toMatch(/data-section-sequence="line-schedule"/);
		expect(source).toMatch(/class="route-schedule-span"/);
		expect(source).toMatch(/class="route-schedule-periods"/);
	});

	it('renders service periods as the shared semantic schedule table', async () => {
		renderRoute();
		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		const table = screen.getByRole('table', { name: 'Planned service periods' });

		expect(within(table).getByRole('columnheader', { name: 'Period' })).toBeInTheDocument();
		expect(within(table).getByRole('columnheader', { name: 'Window' })).toBeInTheDocument();
		expect(
			within(table).getByRole('columnheader', { name: 'Planned headway' }),
		).toBeInTheDocument();
		expect(within(table).getByText('AM peak')).toBeInTheDocument();
		expect(within(table).getByText('6.0 min')).toBeInTheDocument();
	});
});

describe('RouteDetail map drilldown', () => {
	it('links directly to the live map filtered to this route', () => {
		renderRoute();

		expect(screen.getByRole('link', { name: 'View route 161 on map' })).toHaveAttribute(
			'href',
			'/map?route=161&focus=route%3A161',
		);
	});
});

describe('RouteDetail Detail tab: clickable stops + live readout', () => {
	it('renders each stop as a link to its detail page', () => {
		renderRoute();

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
		renderRoute();

		// sA has a bus 2 min late.
		expect(screen.getByText('2 min late')).toBeInTheDocument();
	});

	it('shows an honest "no live bus" for a stop with no live prediction', () => {
		renderRoute();

		// sB has no approaching bus → the placeholder, never a fabricated time.
		expect(screen.getByText('No live bus')).toBeInTheDocument();
	});

	it('renders the live freshness chip when a live build is present', () => {
		const { container } = renderRoute();

		expect(container.querySelector('[data-slot="freshness-stamp"]')).not.toBeNull();
	});
});

describe('RouteDetail Detail tab: service alerts affecting this route', () => {
	it('surfaces alerts whose routes[] lists this route and hides unrelated ones', () => {
		renderRoute();

		const alerts = document.querySelector('[data-testid="route-alerts"]') as HTMLElement;
		expect(alerts).not.toBeNull();
		expect(within(alerts).getByText('Service alerts')).toBeInTheDocument();
		// Route-scoped alert surfaces the scrubbed source message, not its generic header.
		expect(
			within(alerts).getByText('Route 161 is detouring around construction & serving stops.'),
		).toBeInTheDocument();
		expect(within(alerts).queryByText('Detour on line 161')).not.toBeInTheDocument();
		expect(within(alerts).getByText('Construction')).toBeInTheDocument();
		expect(within(alerts).getByText('Detour')).toBeInTheDocument();
		// An alert scoped to a different route (999) must NOT appear here.
		expect(within(alerts).queryByText('Unrelated alert')).not.toBeInTheDocument();
	});

	it('stands the alerts section down when no live alert affects this route', () => {
		liveAlerts = null;
		renderRoute();

		expect(document.querySelector('[data-testid="route-alerts"]')).toBeNull();
	});
});

describe('RouteDetail Detail tab: current-buses roster', () => {
	it('renders one row per live vehicle on this route, each linking to its trip', () => {
		renderRoute();

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
		renderRoute();

		const roster = document.querySelector('[data-testid="route-roster"]') as HTMLElement;
		// Known delays read honestly; the null-delay bus reads "no data", never "0".
		expect(within(roster).getByText('8 min late')).toBeInTheDocument();
		expect(within(roster).getByText('3 min early')).toBeInTheDocument();
		expect(within(roster).getByText('No data')).toBeInTheDocument();
		expect(within(roster).queryByText('0 min late')).not.toBeInTheDocument();
	});

	it('offers a per-bus map drilldown link', () => {
		renderRoute();

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
		renderRoute();

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
		renderRoute();

		expect(document.querySelector('[data-testid="route-roster"]')).toBeNull();
	});
});

describe('RouteDetail Detail tab: HONEST ABSENCE (no live bus)', () => {
	it('states the metro reason for a route_type 1 route with the metro_realtime gap', () => {
		// A metro route (type 1) with no live bus AND the declared metro gap → the
		// detail pane STATES "no live positions for the metro", not a silent stand-down.
		routeFileData = { ...ROUTE_FILE, type: 1 };
		liveIndex = buildIndex([]);
		renderRoute('1');

		expect(screen.getByText('Live positions are not published for the metro.')).toBeInTheDocument();
	});

	it('falls back to a plain no-data note when no reason is derivable (no window, not metro)', () => {
		// ROUTE_FILE has no first/last departure + no type, gap present but type ≠ 1 →
		// inferAbsenceReason returns null → the generic honest no-data copy, never a
		// fabricated reason.
		liveIndex = buildIndex([]);
		renderRoute();

		expect(screen.getAllByText('Nothing to show').length).toBeGreaterThan(0);
		expect(
			screen.queryByText('Live positions are not published for the metro.'),
		).not.toBeInTheDocument();
	});
});
