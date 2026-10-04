import {
	render as renderSvelte,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StopFile, StopReliability, StopDeparture } from '$lib/v1';
import type { IdentitySeed } from '$lib/v1/serverContext';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import { createSurfaceHarness } from '../../../tests/surfaceHarness';
import StopDetail from './StopDetail.svelte';

vi.mock('@testing-library/svelte', { spy: true });

const stopDetailSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/features/stops/StopDetail.svelte'), 'utf-8');

const stopDetailNav = vi.hoisted(() => {
	const page = { url: new URL('http://localhost/stop/57191'), state: {} };
	const defaultReplaceState = (url: string | URL) => {
		page.url = new URL(url, 'http://localhost');
	};
	return {
		page,
		defaultReplaceState,
		replaceState: vi.fn(defaultReplaceState),
	};
});

vi.mock('$app/state', () => ({ page: stopDetailNav.page }));
vi.mock('$app/navigation', () => ({
	replaceState: stopDetailNav.replaceState,
}));

const STOP_FILE = {
	generated_utc: '2026-06-15T12:00:00Z',
	id: '57191',
	name: 'Test stop',
	lat: 45.5,
	lon: -73.6,
	scheduled: [],
	routes_served: ['51', '80'],
} as unknown as StopFile;

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
		description: '<p>La ligne <strong>51</strong> est détournée &amp; reste en service.</p>',
		description_en: '<p>Route <strong>51</strong> is diverted &amp; remains in service.</p>',
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

function habitsMatrix(): (number | null)[][] {
	const grid: (number | null)[][] = Array.from({ length: 7 }, () =>
		Array.from({ length: 24 }, () => null),
	);
	grid[1][8] = 0.9;
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
		{ route: '99', avg_delay_min: null },
	],
	day_of_week: [
		{ day_of_week_iso: 1, avg_delay_min: 2.4, severe_pct: 5.0, observation_count: 140 },
		{ day_of_week_iso: 3, avg_delay_min: 3.1, severe_pct: 18.2, observation_count: 2 },
		{ day_of_week_iso: 5, avg_delay_min: 9.4, severe_pct: 14.9, observation_count: 96 },
		{ day_of_week_iso: 7, avg_delay_min: null, severe_pct: null, observation_count: 0 },
	],
	occupancy_mix: { empty: 0.05, many_seats: 0.15, few_seats: 0.25, standing: 0.45, full: 0.1 },
} as StopReliability;

const RELIABILITY_WITH_TOD = {
	...RELIABILITY,
	periods: [
		...RELIABILITY.periods!,
		{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 2.1, severe_pct: 5 },
		{ grain: 'midday', otp_pct: 91, avg_delay_min: 1.4, severe_pct: 3 },
		{ grain: 'pm_peak', otp_pct: 74, avg_delay_min: 5.6, severe_pct: 12 },
		{ grain: 'evening', otp_pct: 90, avg_delay_min: 1.8, severe_pct: 4 },
		{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		{ grain: 'weekday', otp_pct: 80, avg_delay_min: 3.4, severe_pct: 7 },
		{ grain: 'weekend', otp_pct: 86, avg_delay_min: 2.2, severe_pct: 4 },
	],
} as StopReliability;

const FIELD_EMPTY_RELIABILITY = {
	generated_utc: RELIABILITY.generated_utc,
	id: '57191',
	name: 'Test stop',
	periods: [],
	habits: null,
	by_route: [],
	day_of_week: [],
	occupancy_mix: null,
	daily: [],
} as StopReliability;

const HABITS_ONLY_RELIABILITY = {
	...FIELD_EMPTY_RELIABILITY,
	habits: { scale: 'severe_relative', matrix: habitsMatrix() },
} as StopReliability;

const STOP_HISTORY_INDEX = {
	generated_utc: '2026-07-13T12:00:00Z',
	family: 'stops',
	selection_mode: 'range',
	entity_id: '57191',
	collection_generation_id: 'a'.repeat(64),
	first_available_date: '2026-01-31',
	last_available_date: '2026-02-01',
	gaps: [],
	partitions: [
		{
			path: `historic/history/stops/3537313931/generations/${'b'.repeat(64)}/2026-01.json`,
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
			count: 1,
			sha256: 'b'.repeat(64),
			byte_size: 100,
		},
		{
			path: `historic/history/stops/3537313931/generations/${'c'.repeat(64)}/2026-02.json`,
			coverage_start: '2026-02-01',
			coverage_end: '2026-02-01',
			count: 1,
			sha256: 'c'.repeat(64),
			byte_size: 100,
		},
	],
	metrics: [],
};

const DEPARTURES = [
	{ eta_utc: '2026-06-15T12:05:00Z', route: '51', delay_min: 4 },
	{ eta_utc: '2026-06-15T12:08:00Z', route: '80', delay_min: 0 },
	{ eta_utc: '2026-06-15T12:11:00Z', route: '51', delay_min: -2 },
] as StopDeparture[];

const DEPARTURES_B = [
	{ eta_utc: '2026-06-15T12:06:00Z', route: '12', delay_min: 0 },
	{ eta_utc: '2026-06-15T12:09:00Z', route: '12', delay_min: 0 },
] as StopDeparture[];

let stopFileData: StopFile = STOP_FILE;
let alertsData: { generated_utc: string; alerts: typeof ALERTS } | null = {
	generated_utc: '2026-06-15T12:00:00Z',
	alerts: ALERTS,
};

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
		stops: ['10254'],
	},
];

const liveStore = {
	familyStates: {
		departures: { phase: 'ready', consecutiveFailures: 0 },
		alerts: { phase: 'ready', consecutiveFailures: 0 },
	},
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
	familyStates: {
		departures: { phase: 'idle', consecutiveFailures: 0 },
		alerts: { phase: 'idle', consecutiveFailures: 0 },
	},
	departures: null,
	alerts: null,
	index: { byStopId: new Map<string, StopDeparture[]>() },
};

const silentBoardLiveStore = {
	...liveStore,
	departures: { generated_utc: '2026-06-15T12:00:00Z' },
	network: { non_responding_by_route: [{ route_id: '51', count: 3 }] },
	index: { byStopId: new Map<string, StopDeparture[]>() },
};

let useEmptyLive = false;
let useSilentBoard = false;
let reliabilityData: StopReliability | null = RELIABILITY;
let provenanceData: { generated_utc: string; gaps: string[] } = {
	generated_utc: '2026-06-15T12:00:00Z',
	gaps: [],
};
let currentLocale: 'en' | 'fr' = 'en';
const getStopSpy = vi.fn((_id: string) => stopFileData);
const getStopReliabilitySpy = vi.fn((_id: string) => reliabilityData);
const stopHistoryHarness = vi.hoisted(() => ({
	getStopHistoryDirectory: vi.fn(),
	getStopHistoryIndex: vi.fn(),
	loadStopHistoryRange: vi.fn(),
	createLiveStore: vi.fn(),
}));
const reliabilityReloadSpy = vi.fn();
let reliabilityResourceState: {
	data: StopReliability | null;
	error: Error | null;
	loading: boolean;
	settled: boolean;
} | null = null;
const stopSurface = createSurfaceHarness({
	url: {
		initial: '/stop/57191',
		origin: 'http://localhost',
		set: (url) => {
			stopDetailNav.page.url = url;
			stopDetailNav.page.state = {};
			window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
		},
	},
	locale: {
		initial: 'en' as const,
		set: (locale) => {
			currentLocale = locale;
		},
	},
	storage: [
		{
			port: sessionStorage,
			keys: [
				'transit.persisted:stop-reliability-controls',
				'transit.persisted:stop-reliability-toc',
			],
		},
	],
	resetters: [resetStopSurfaceState],
	mount: renderSvelte,
});

vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => currentLocale };
});

vi.mock('$lib/v1/repositories/static', () => ({
	getStop: (id: string) => getStopSpy(id),
}));
vi.mock('$lib/v1/repositories/historic', () => ({
	getStopReliability: (id: string) => getStopReliabilitySpy(id),
	getStopHistoryDirectory: stopHistoryHarness.getStopHistoryDirectory,
	getStopHistoryIndex: stopHistoryHarness.getStopHistoryIndex,
	loadStopHistoryRange: stopHistoryHarness.loadStopHistoryRange,
}));
vi.mock('$lib/v1/repositories/provenance', () => ({ getProvenance: () => provenanceData }));
vi.mock('$lib/v1/live/store.svelte', () => ({
	createLiveStore: stopHistoryHarness.createLiveStore,
}));
vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({
		manifest: {
			short_name: 'STM',
			display_name: 'Société de transport de Montréal',
			files: { live: { ttl_s: 30 } },
		},
		labels: {},
		lang: 'en',
	}),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (loader: () => unknown) => {
		const data = loader();
		if (data === reliabilityData && reliabilityResourceState != null) {
			return {
				get data() {
					return reliabilityResourceState?.data ?? null;
				},
				get error() {
					return reliabilityResourceState?.error ?? null;
				},
				get loading() {
					return reliabilityResourceState?.loading ?? false;
				},
				get settled() {
					return reliabilityResourceState?.settled ?? true;
				},
				reload: reliabilityReloadSpy,
			};
		}
		return {
			data,
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

function resetStopSurfaceState() {
	stopDetailNav.replaceState.mockReset().mockImplementation(stopDetailNav.defaultReplaceState);
	useEmptyLive = false;
	useSilentBoard = false;
	reliabilityData = RELIABILITY;
	stopFileData = STOP_FILE;
	alertsData = { generated_utc: '2026-06-15T12:00:00Z', alerts: ALERTS };
	provenanceData = { generated_utc: '2026-06-15T12:00:00Z', gaps: [] };
	currentLocale = 'en';
	getStopSpy.mockClear();
	getStopReliabilitySpy.mockClear();
	stopHistoryHarness.getStopHistoryDirectory.mockReset();
	stopHistoryHarness.getStopHistoryIndex.mockReset();
	stopHistoryHarness.getStopHistoryIndex.mockResolvedValue(null);
	stopHistoryHarness.loadStopHistoryRange.mockReset();
	stopHistoryHarness.createLiveStore
		.mockReset()
		.mockImplementation(() =>
			useSilentBoard ? silentBoardLiveStore : useEmptyLive ? emptyLiveStore : liveStore,
		);
	reliabilityResourceState = null;
	reliabilityReloadSpy.mockClear();
	liveStore.index.byStopId.clear();
	liveStore.index.byStopId.set('57191', DEPARTURES);
	liveStore.index.byStopId.set('99999', DEPARTURES_B);
	quietModeStore.resetForTest();
}

beforeEach(() => stopSurface.reset());

type StopDetailTestProps = { id: string; seed?: IdentitySeed };

function render(_component: typeof StopDetail, options: { props: StopDetailTestProps }) {
	const seededProps = {
		seed: { id: options.props.id, name: stopFileData.name ?? `#${options.props.id}` },
		...options.props,
	};
	const view = stopSurface.mount(StopDetail, { props: seededProps });
	return {
		...view,
		rerender: (props: StopDetailTestProps) =>
			view.rerender({
				seed: {
					id: props.id,
					name: props.id === stopFileData.id ? stopFileData.name : `#${props.id}`,
				},
				...props,
			}),
	};
}

afterAll(() => {
	expect(vi.mocked(renderSvelte).mock.calls.length).toBeLessThanOrEqual(70);
});

function articleCardFor(body: Element | null): HTMLElement {
	const card = body?.closest('[data-slot="card"]');
	if (!(card instanceof HTMLElement))
		throw new Error('Expected article card around presenter body');
	return card;
}

describe('StopDetail article contract', () => {
	it('uses the server identity seed for the first-render title and renders one article head', () => {
		const { container } = render(StopDetail, {
			props: { id: '57191', seed: { id: '57191', name: 'Seeded station name' } },
		});
		expect(stopHistoryHarness.createLiveStore.mock.calls[0]?.[1]).toEqual({
			families: ['departures'],
		});

		expect(
			screen.getByRole('heading', { level: 1, name: 'Seeded station name' }),
		).toBeInTheDocument();
		expect(container.querySelectorAll('h1')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="article-header"]')).toHaveLength(1);
		expect(container.querySelector('.surface-head')).toBeNull();
	});

	it('recovers the real client name when the server seed had to fall back to the id', () => {
		render(StopDetail, {
			props: { id: '57191', seed: { id: '57191', name: '57191' } },
		});

		expect(screen.getByRole('heading', { level: 1, name: 'Test stop' })).toBeInTheDocument();
	});

	it('exposes exactly the canonical Detail, Schedule and Reliability tabs', () => {
		render(StopDetail, { props: { id: '57191' } });

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual([
			'Detail',
			'Schedule',
			'Reliability',
		]);
	});

	it('keeps exactly one centered reliability summary while its owning rail changes by tab', async () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const summaries = () =>
			container.querySelectorAll<HTMLElement>('[data-slot="stop-reliability-summary"]');
		const summary = () => summaries()[0];

		expect(summaries()).toHaveLength(1);
		expect(summary()).toHaveTextContent('Severe-delay share');
		expect(summary()).toHaveTextContent('6%');
		expect(summary()).toHaveTextContent('Average delay');
		expect(summary()).toHaveTextContent('3.2 min');
		expect(summary().closest('[data-slot="detail-shell-summary"]')).not.toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(summaries()).toHaveLength(1);
		expect(summary().closest('[data-slot="detail-shell-summary"]')).not.toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(summaries()).toHaveLength(1);
		expect(summary().closest('[data-slot="reliability-rail-summary"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="detail-shell-summary"]')).toBeNull();
	});

	it('fills a percentile-only day summary from the latest daily row', () => {
		reliabilityData = {
			...RELIABILITY,
			periods: [{ ...RELIABILITY.periods![0], avg_delay_min: null, severe_pct: null }],
			daily: [{ date: '2026-06-15', observation_count: 50, severe_count: 10, avg_delay_min: 2.7 }],
		};
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const summary = container.querySelector('[data-slot="stop-reliability-summary"]');
		expect(summary).toHaveTextContent('20%');
		expect(summary).toHaveTextContent('2.7 min');
		expect(summary).toHaveTextContent('Jun 15, 2026');
	});

	it('uses historic freshness on the reliability tab', () => {
		reliabilityData = {
			...RELIABILITY,
			generated_utc: '2026-06-14T06:00:00Z' as StopReliability['generated_utc'],
		};
		stopDetailNav.page.url = new URL('http://localhost/stop/57191?tab=reliability');
		const { container } = render(StopDetail, { props: { id: '57191' } });
		expect(container.querySelector('[data-slot="article-header"] time')).toHaveAttribute(
			'datetime',
			'2026-06-14T06:00:00Z',
		);
	});

	it('reserves no summary gap when this stop has no summary metrics', async () => {
		reliabilityData = HABITS_ONLY_RELIABILITY;
		const { container } = render(StopDetail, { props: { id: '57191' } });

		expect(container.querySelector('[data-slot="stop-reliability-summary"]')).toBeNull();
		expect(container.querySelector('[data-slot="detail-shell-summary"]')).toBeNull();

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(container.querySelector('[data-slot="reliability-rail-summary"]')).toBeNull();
		expect(container.querySelector('[data-slot="reliability-rail-layout"]')).not.toBeNull();
	});

	it('uses one disclosure frame around live departures instead of nesting a terminal card', () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const departuresCard = container.querySelector(
			'[data-toc="stop-detail-departures"]',
		) as HTMLElement;

		expect(departuresCard.querySelector('[data-slot="terminal-panel"]')).toBeNull();
		expect(
			within(departuresCard).getByRole('table', { name: 'Reported departures' }),
		).toBeInTheDocument();
	});

	it('localizes the article identity labels without replacing their real values', () => {
		currentLocale = 'fr';
		render(StopDetail, {
			props: { id: '57191', seed: { id: '57191', name: 'Station test' } },
		});

		expect(screen.getByRole('link', { name: '← Retour aux arrêts' })).toHaveAttribute(
			'href',
			'/fr/stops',
		);
		expect(screen.getByRole('list', { name: 'Données d’identité de l’arrêt' })).toHaveTextContent(
			'ID arrêt 57191',
		);
		expect(screen.getAllByText('STM').length).toBeGreaterThan(0);
	});

	it.each(['next', 'info', 'unknown'])(
		'normalizes the legacy/unknown %s tab to a clean Detail URL without dropping range filters',
		async (legacy) => {
			stopDetailNav.page.url = new URL(
				`http://localhost/stop/57191?tab=${legacy}&from=2026-01-31&to=2026-02-01&line=51`,
			);
			render(StopDetail, { props: { id: '57191' } });

			await waitFor(() => expect(stopDetailNav.replaceState).toHaveBeenCalled());
			const normalized = stopDetailNav.replaceState.mock.calls
				.map(([url]) => new URL(url as string | URL, 'http://localhost'))
				.find(
					(url) =>
						!url.searchParams.has('tab') &&
						url.searchParams.get('from') === '2026-01-31' &&
						url.searchParams.get('to') === '2026-02-01' &&
						url.searchParams.get('line') === '51',
				);
			expect(normalized).toBeDefined();
		},
	);

	it('does not let the inactive reliability pane restore a legacy tab while shallow state lags', async () => {
		const initial = new URL(
			'http://localhost/stop/57191?tab=next&from=2026-01-31&to=2026-02-01&line=51',
		);
		stopDetailNav.page.url = initial;
		window.history.replaceState({}, '', `${initial.pathname}${initial.search}`);
		stopDetailNav.replaceState.mockImplementation(() => undefined);

		try {
			render(StopDetail, { props: { id: '57191' } });
			await waitFor(() => expect(stopDetailNav.replaceState).toHaveBeenCalled());
			await Promise.resolve();

			const finalWrite = new URL(
				stopDetailNav.replaceState.mock.calls.at(-1)?.[0] as string | URL,
				window.location.origin,
			);
			expect(finalWrite.searchParams.has('tab')).toBe(false);
			expect(finalWrite.searchParams.get('from')).toBe('2026-01-31');
			expect(finalWrite.searchParams.get('to')).toBe('2026-02-01');
			expect(finalWrite.searchParams.get('line')).toBe('51');
		} finally {
			stopDetailNav.replaceState.mockImplementation((url: string | URL) => {
				stopDetailNav.page.url = new URL(url, 'http://localhost');
			});
			window.history.replaceState({}, '', '/');
		}
	});

	it('keeps the default Detail URL clean and carries one bulk disclosure state across article panes', async () => {
		stopFileData = {
			...STOP_FILE,
			scheduled: [{ route: '51', headsign: 'Nord', times: ['08:00'] }],
		} as unknown as StopFile;
		const { container } = render(StopDetail, { props: { id: '57191' } });

		expect(stopDetailNav.page.url.searchParams.has('tab')).toBe(false);
		const tabs = container.querySelector<HTMLElement>('[data-slot="entity-detail-tabs"]');
		expect(container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(
			tabs as HTMLElement,
		);
		const detailCards = Array.from(
			container.querySelectorAll<HTMLElement>('[data-toc^="stop-detail-"]'),
		);
		expect(detailCards).toHaveLength(2);
		for (const card of detailCards) {
			expect(card.querySelector('[data-section-trigger]')).toHaveAttribute('aria-expanded', 'true');
		}
		const focus = screen.getByTestId('quiet-mode-toggle');
		await fireEvent.click(focus);
		await waitFor(() => {
			for (const card of detailCards) {
				expect(card.querySelector('[data-section-trigger]')).toHaveAttribute(
					'aria-expanded',
					'false',
				);
			}
		});

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(tabs);
		const scheduleCard = container.querySelector(
			'[data-toc="stop-schedule-service"]',
		) as HTMLElement;
		expect(scheduleCard.querySelector('[data-section-trigger]')).toHaveAttribute(
			'aria-expanded',
			'false',
		);

		await fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		for (const card of detailCards) {
			expect(card.querySelector('[data-section-trigger]')).toHaveAttribute(
				'aria-expanded',
				'false',
			);
		}

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(tabs);
		expect(container.querySelector('[data-slot="reliability-pane"]')).not.toBeNull();
	});

	it('uses the shared connected section stack for Detail and Schedule cards', async () => {
		stopFileData = {
			...STOP_FILE,
			scheduled: [{ route: '51', headsign: 'Nord', times: ['08:00'] }],
		} as unknown as StopFile;
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const detailStack = container.querySelector(
			'[data-slot="article-section-stack"]',
		) as HTMLElement;
		const detailCards = Array.from(detailStack?.children ?? []);

		expect(detailStack).not.toBeNull();
		expect(detailCards).toHaveLength(2);
		for (const card of detailCards) {
			expect(card.matches('[data-slot="card"].section-card[data-toc^="stop-detail-"]')).toBe(true);
			expect(card.querySelector('[data-section-trigger]')).not.toBeNull();
		}

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		const scheduleStack = container.querySelector(
			'[data-slot="article-section-stack"][data-section-sequence="stop-schedule"]',
		) as HTMLElement;
		const scheduleCards = Array.from(scheduleStack?.children ?? []);

		expect(scheduleCards).toHaveLength(1);
		expect(
			scheduleCards[0]?.matches(
				'[data-slot="card"].section-card[data-toc="stop-schedule-service"]',
			),
		).toBe(true);
		expect(scheduleCards[0]?.querySelector('[data-section-trigger]')).not.toBeNull();
	});

	it('does not retain a page-local Detail card-stack gap', () => {
		const source = stopDetailSource();

		expect(source).toContain('ArticleSectionStack');
		expect(source).not.toMatch(/\.stop-detail\s*\{/);
	});

	it('renders article navigation that follows the active Detail and Schedule sections', async () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const rail = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;

		expect(within(rail).getByRole('button', { name: 'On this page' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Next departures' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Stop information' })).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(
			within(rail).getByRole('button', { name: 'Sample weekday schedule' }),
		).toBeInTheDocument();
	});

	it('preserves a manual facts-card choice across a tab round-trip', async () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const headerContent = container.querySelector('.header__content') as HTMLElement;
		const actionRow = container.querySelector('[data-slot="article-header-actions"]');
		const controlRow = container.querySelector('[data-slot="article-header-controls"]');
		const factsCard = container.querySelector('[data-toc="stop-detail-facts"]') as HTMLElement;
		const trigger = within(factsCard).getByRole('button');

		expect(actionRow).not.toBeNull();
		expect(actionRow?.querySelector('a')).not.toBeNull();
		expect(controlRow).toContainElement(screen.getByTestId('quiet-mode-controls'));
		expect(Array.from(headerContent.children).at(-1)).toBe(controlRow);

		await fireEvent.click(trigger);
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(screen.getByTestId('quiet-mode-toggle')).toBeVisible();
		await fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});

	it('remounts the persisted facts-card state when the stop id changes in place', async () => {
		const view = render(StopDetail, { props: { id: '57191' } });
		const firstCard = view.container.querySelector('[data-toc="stop-detail-facts"]') as HTMLElement;

		await fireEvent.click(within(firstCard).getByRole('button'));
		expect(within(firstCard).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
		await view.rerender({ id: 'NEW', seed: { id: 'NEW', name: 'New stop' } });

		const nextCard = view.container.querySelector('[data-toc="stop-detail-facts"]') as HTMLElement;
		expect(nextCard).not.toBe(firstCard);
		expect(within(nextCard).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
	});
});

describe('StopDetail retained-history ownership', () => {
	it('keeps the default singleton surface intact and loads no retained partition', async () => {
		const view = render(StopDetail, { props: { id: '57191' } });

		expect(getStopSpy).toHaveBeenCalledWith('57191');
		expect(getStopReliabilitySpy).toHaveBeenCalledWith('57191');
		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		const pane = view.container.querySelector('[data-slot="reliability-pane"]') as HTMLElement;
		expect(pane).not.toBeNull();
		expect(within(pane).getByText('Day')).toBeInTheDocument();
		expect(within(pane).getByText('82%')).toBeInTheDocument();
		expect(stopHistoryHarness.loadStopHistoryRange).not.toHaveBeenCalled();

		await waitFor(() => expect(stopHistoryHarness.getStopHistoryIndex).toHaveBeenCalledOnce());
		expect(stopHistoryHarness.getStopHistoryDirectory).not.toHaveBeenCalled();
	});

	it('keeps discovery on the raw awkward stop id and aborts stale ownership on id changes', async () => {
		stopHistoryHarness.getStopHistoryIndex.mockImplementation(() => new Promise(() => undefined));
		const view = render(StopDetail, { props: { id: 'A/B ?#' } });

		await waitFor(() => expect(stopHistoryHarness.getStopHistoryIndex).toHaveBeenCalledOnce());
		const firstCall = stopHistoryHarness.getStopHistoryIndex.mock.calls[0];
		const firstContext = firstCall?.[1] as { signal: AbortSignal } | undefined;
		expect(firstCall?.[0]).toBe('A/B ?#');
		expect(firstContext?.signal.aborted).toBe(false);
		expect(stopHistoryHarness.getStopHistoryDirectory).not.toHaveBeenCalled();
		expect(stopHistoryHarness.loadStopHistoryRange).not.toHaveBeenCalled();

		await view.rerender({ id: 'NEXT/STOP' });
		await waitFor(() => expect(stopHistoryHarness.getStopHistoryIndex).toHaveBeenCalledTimes(2));
		expect(firstContext?.signal.aborted).toBe(true);
		expect(stopHistoryHarness.getStopHistoryIndex.mock.calls[1]?.[0]).toBe('NEXT/STOP');

		const secondContext = stopHistoryHarness.getStopHistoryIndex.mock.calls[1]?.[1] as
			| { signal: AbortSignal }
			| undefined;
		view.unmount();
		expect(secondContext?.signal.aborted).toBe(true);
	});

	it('passes the retained resource only to StopReliabilitySurface', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/stops/StopDetail.svelte'),
			'utf-8',
		);
		const reliabilitySurfaces = source.match(/<StopReliabilitySurface\s[\s\S]*?\/>/g) ?? [];
		const outsideReliabilitySurfaces = reliabilitySurfaces.reduce(
			(remaining, surface) => remaining.replace(surface, ''),
			source,
		);

		expect(reliabilitySurfaces).toHaveLength(2);
		expect(reliabilitySurfaces.every((surface) => surface.includes('history={stopHistory}'))).toBe(
			true,
		);
		expect(outsideReliabilitySurfaces).not.toMatch(/\bhistory=\{stopHistory\}/);
	});

	it('keeps retained query parameters out of line links', async () => {
		stopDetailNav.page.url = new URL(
			'http://localhost/stop/57191?tab=reliability&grain=day&from=2026-01-31&to=2026-02-01',
		);
		const view = render(StopDetail, { props: { id: '57191' } });

		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="stop-by-route"]')).not.toBeNull(),
		);
		const lineLinks = view.container.querySelectorAll<HTMLAnchorElement>('a[href^="/lines/"]');
		expect(lineLinks.length).toBeGreaterThan(0);
		for (const link of lineLinks) {
			const url = new URL(link.href);
			expect(url.search).toBe('');
			expect(url.hash).toBe('');
		}
	});
});

describe('StopDetail retained-history singleton boundary', () => {
	it('keeps a habits-only current singleton visible without an explicit retained range', async () => {
		reliabilityData = HABITS_ONLY_RELIABILITY;
		const view = render(StopDetail, { props: { id: '57191' } });

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		const habits = view.container.querySelector('[data-slot="stop-habits"]');
		expect(habits).not.toBeNull();
		expect(
			within(articleCardFor(habits)).getByRole('button', {
				name: 'Relative severe-delay score by hour',
			}),
		).toBeInTheDocument();
		expect(stopHistoryHarness.loadStopHistoryRange).not.toHaveBeenCalled();
	});

	it('preserves current habits while an explicit retained range loads', async () => {
		reliabilityData = HABITS_ONLY_RELIABILITY;
		stopDetailNav.page.url = new URL(
			'http://localhost/stop/57191?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		stopHistoryHarness.getStopHistoryIndex.mockResolvedValue(STOP_HISTORY_INDEX);
		stopHistoryHarness.loadStopHistoryRange.mockImplementation(() => new Promise(() => undefined));
		const view = render(StopDetail, { props: { id: '57191' } });

		await waitFor(() => expect(stopHistoryHarness.loadStopHistoryRange).toHaveBeenCalledOnce());
		const habits = view.container.querySelector('[data-slot="stop-habits"]');
		expect(habits).not.toBeNull();
		expect(
			within(articleCardFor(habits)).getByRole('button', {
				name: 'Relative severe-delay score by hour',
			}),
		).toBeInTheDocument();
	});

	it.each([
		['settled null', null],
		['settled field-empty', FIELD_EMPTY_RELIABILITY],
	] as const)(
		'keeps the existing ResourceBoundary empty for a default %s singleton',
		async (_, value) => {
			reliabilityData = value;
			const view = render(StopDetail, { props: { id: '57191' } });

			await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
			await waitFor(() =>
				expect(
					view.container.querySelector('[data-slot="edge-state"][data-variant="empty"]'),
				).not.toBeNull(),
			);
			expect(view.container.querySelector('.stop-reliability')).toBeNull();
			expect(stopHistoryHarness.loadStopHistoryRange).not.toHaveBeenCalled();
		},
	);

	it.each([
		['null', null],
		['field-empty', FIELD_EMPTY_RELIABILITY],
	] as const)(
		'mounts StopReliabilitySurface for an explicit retained range over a %s singleton',
		async (_, value) => {
			reliabilityData = value;
			stopDetailNav.page.url = new URL(
				'http://localhost/stop/57191?tab=reliability&from=2026-01-31&to=2026-02-01',
			);
			stopHistoryHarness.getStopHistoryIndex.mockResolvedValue(STOP_HISTORY_INDEX);
			stopHistoryHarness.loadStopHistoryRange.mockImplementation(
				() => new Promise(() => undefined),
			);
			const view = render(StopDetail, { props: { id: '57191' } });

			await waitFor(() => expect(stopHistoryHarness.getStopHistoryIndex).toHaveBeenCalledOnce());
			await waitFor(() => expect(stopHistoryHarness.loadStopHistoryRange).toHaveBeenCalledOnce());
			expect(view.container.querySelector('.stop-reliability')).not.toBeNull();
		},
	);

	it('does not let retained discovery bypass a pending singleton boundary', async () => {
		reliabilityData = null;
		reliabilityResourceState = { data: null, error: null, loading: true, settled: false };
		stopDetailNav.page.url = new URL(
			'http://localhost/stop/57191?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		stopHistoryHarness.getStopHistoryIndex.mockResolvedValue(STOP_HISTORY_INDEX);
		stopHistoryHarness.loadStopHistoryRange.mockImplementation(() => new Promise(() => undefined));
		const view = render(StopDetail, { props: { id: '57191' } });

		await waitFor(() => expect(stopHistoryHarness.getStopHistoryIndex).toHaveBeenCalledOnce());
		await waitFor(() => expect(stopHistoryHarness.loadStopHistoryRange).toHaveBeenCalledOnce());
		expect(view.container.querySelector('[data-variant="skeleton"]')).not.toBeNull();
		expect(view.container.querySelector('.stop-reliability')).toBeNull();
	});

	it('does not let retained discovery bypass a singleton error or its retry action', async () => {
		reliabilityData = null;
		reliabilityResourceState = {
			data: null,
			error: new Error('singleton unavailable'),
			loading: false,
			settled: true,
		};
		stopDetailNav.page.url = new URL(
			'http://localhost/stop/57191?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		stopHistoryHarness.getStopHistoryIndex.mockResolvedValue(STOP_HISTORY_INDEX);
		stopHistoryHarness.loadStopHistoryRange.mockImplementation(() => new Promise(() => undefined));
		const view = render(StopDetail, { props: { id: '57191' } });

		await waitFor(() => expect(stopHistoryHarness.getStopHistoryIndex).toHaveBeenCalledOnce());
		await waitFor(() => expect(stopHistoryHarness.loadStopHistoryRange).toHaveBeenCalledOnce());
		const error = await screen.findByRole('alert');
		expect(error).toHaveTextContent('Data unavailable');
		expect(view.container.querySelector('.stop-reliability')).toBeNull();

		await fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
		expect(reliabilityReloadSpy).toHaveBeenCalledOnce();
	});
});

describe('StopDetail map drilldown', () => {
	it('links directly to the live map filtered to this stop', () => {
		render(StopDetail, { props: { id: '57191' } });

		expect(screen.getByRole('link', { name: 'View stop 57191 on map' })).toHaveAttribute(
			'href',
			'/map?stop=57191&focus=stop%3A57191',
		);
	});
});

describe('StopDetail article head', () => {
	it('renders the stop NAME as the article h1', () => {
		render(StopDetail, { props: { id: '57191' } });

		expect(screen.getByRole('heading', { level: 1, name: 'Test stop' })).toBeInTheDocument();
	});

	it('shows real stop identity/provider metadata and a single back link', () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });

		expect(screen.getAllByText(/Stop ID/i).length).toBeGreaterThan(0);
		expect(screen.getAllByText('57191').length).toBeGreaterThan(0);
		expect(screen.getAllByText('STM').length).toBeGreaterThan(0);
		expect(container.querySelectorAll('a[href="/stops"]')).toHaveLength(1);
	});
});

describe('StopDetail reliability — grain picker', () => {
	it('localizes the reliability card grain heading (EN) instead of the raw contract string', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const pane = document.querySelector('[data-slot="reliability-pane"]') as HTMLElement;
		expect(pane).not.toBeNull();
		expect(within(pane).getByText('Day')).toBeInTheDocument();
		expect(within(pane).queryByText('day')).not.toBeInTheDocument();
	});

	it('localizes the reliability card grain heading in FR (Jour, not the raw "day")', () => {
		currentLocale = 'fr';
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Fiabilité' }));

		const pane = document.querySelector('[data-slot="reliability-pane"]') as HTMLElement;
		expect(pane).not.toBeNull();
		expect(within(pane).getByText('Jour')).toBeInTheDocument();
		expect(within(pane).queryByText('day')).not.toBeInTheDocument();
	});
});

describe('StopDetail reliability — habits heatmap', () => {
	it('renders the habits heatmap when the matrix carries data', () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const habitsTile = container.querySelector('[data-slot="stop-habits"]') as HTMLElement;
		expect(
			within(articleCardFor(habitsTile)).getByRole('button', {
				name: 'Relative severe-delay score by hour',
			}),
		).toBeInTheDocument();
		expect(
			within(habitsTile).getByRole('figure', {
				name: 'Relative score within this stop, by day and hour',
			}),
		).toBeInTheDocument();
	});

	it('renders NO heatmap (not a fabricated grid) when habits is absent', () => {
		reliabilityData = { ...RELIABILITY, habits: null };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.queryByText('Relative severe-delay score by hour')).not.toBeInTheDocument();
	});
});

describe('StopDetail reliability — crowding (occupancy_mix)', () => {
	it('renders the occupancy proportion bar when occupancy_mix is present', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const crowding = document.querySelector('[data-slot="stop-crowding"]') as HTMLElement;
		expect(crowding).not.toBeNull();
		expect(
			within(articleCardFor(crowding)).getByRole('button', {
				name: 'Crowding on vehicles seen here',
			}),
		).toBeInTheDocument();
		expect(
			within(crowding).getByText(/How full the vehicles observed at this stop ran/),
		).toBeInTheDocument();
		expect(
			within(crowding).getByRole('figure', {
				name: /Occupancy mix of vehicles observed at this stop/,
			}),
		).toBeInTheDocument();
		expect(within(crowding).getAllByText('45%').length).toBeGreaterThan(0);
		expect(within(crowding).getAllByText('Standing').length).toBeGreaterThan(0);
	});

	it('stands the crowding BAR down but shows the honest no-telemetry note when occupancy_mix is null', () => {
		reliabilityData = { ...RELIABILITY, occupancy_mix: null };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-crowding"]')).toBeNull();
		const empty = document.querySelector('[data-slot="stop-crowding-empty"]') as HTMLElement;
		expect(empty).not.toBeNull();
		expect(
			within(articleCardFor(empty)).getByRole('button', { name: 'Crowding on vehicles seen here' }),
		).toBeInTheDocument();
		const chip = within(empty)
			.getByText('not enough readings yet')
			.closest('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
	});

	it('stands the crowding section down when occupancy_mix is absent (undefined)', () => {
		reliabilityData = { ...RELIABILITY, occupancy_mix: undefined } as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-crowding"]')).toBeNull();
	});

	it('stands down on an all-zero mix (no even split, no all-empty bar)', () => {
		reliabilityData = {
			...RELIABILITY,
			occupancy_mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 0 },
		} as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-crowding"]')).toBeNull();
		expect(document.querySelector('[data-slot="stop-crowding-empty"]')).not.toBeNull();
	});

	it('renders the FR no-telemetry note when occupancy_mix is null', () => {
		currentLocale = 'fr';
		reliabilityData = { ...RELIABILITY, occupancy_mix: null };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Fiabilité' }));

		const empty = document.querySelector('[data-slot="stop-crowding-empty"]') as HTMLElement;
		expect(empty).not.toBeNull();
		const chip = within(empty)
			.getByText('pas assez de mesures')
			.closest('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
	});
});

describe('StopDetail reliability — occupancy-only stop is not gated out as empty', () => {
	it('renders the crowding section for a stop with ONLY occupancy_mix (no periods/dow/by_route)', () => {
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
		expect(
			within(articleCardFor(crowding)).getByRole('button', {
				name: 'Crowding on vehicles seen here',
			}),
		).toBeInTheDocument();
		expect(within(crowding).getAllByText('Standing').length).toBeGreaterThan(0);

		expect(document.querySelector('[data-slot="stop-reliability-pane"]')).toBeNull();
		expect(document.querySelector('[data-slot="reliability-pane"]')).toBeNull();
	});
});

describe('StopDetail reliability — by_route ranked bars', () => {
	it('ranks routes worst-delay first and drops rows with no delay', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.getByText('12.5 min')).toBeInTheDocument();
		expect(screen.getByText('4.1 min')).toBeInTheDocument();

		const rows = screen.getAllByRole('listitem');
		const ranked = rows.filter((r) => within(r).queryByText(/min$/));
		const worstIdx = ranked.findIndex((r) => within(r).queryByText('12.5 min'));
		const milderIdx = ranked.findIndex((r) => within(r).queryByText('4.1 min'));
		expect(worstIdx).toBeGreaterThanOrEqual(0);
		expect(worstIdx).toBeLessThan(milderIdx);
	});
});

describe('StopDetail reliability — weekday seasonality (day_of_week)', () => {
	it('ranks weekdays worst-delay first and drops a null-mean weekday (no fake-0 row)', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const weekday = document.querySelector('[data-slot="stop-weekday"]') as HTMLElement;
		expect(weekday).not.toBeNull();
		expect(
			within(articleCardFor(weekday)).getByRole('button', { name: 'By day of week' }),
		).toBeInTheDocument();

		expect(within(weekday).getByText('Friday')).toBeInTheDocument();
		expect(within(weekday).getByText('Monday')).toBeInTheDocument();
		expect(within(weekday).getByText('Wednesday')).toBeInTheDocument();
		expect(within(weekday).queryByText('Sunday')).not.toBeInTheDocument();

		const list = within(weekday).getByRole('list', { name: 'By day of week' });
		const rows = within(list).getAllByRole('listitem');
		const friIdx = rows.findIndex((r) => within(r).queryByText('Friday'));
		const monIdx = rows.findIndex((r) => within(r).queryByText('Monday'));
		expect(friIdx).toBeGreaterThanOrEqual(0);
		expect(friIdx).toBeLessThan(monIdx);
		expect(within(weekday).queryByText('0.0 min')).not.toBeInTheDocument();
	});

	it('gates the severe share on observation count (under-sampled weekday withheld)', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const weekday = document.querySelector('[data-slot="stop-weekday"]') as HTMLElement;
		expect(within(weekday).getByText('Severe-delay share 5.0%')).toBeInTheDocument();
		expect(within(weekday).queryByText('Severe-delay share 18.2%')).not.toBeInTheDocument();
		expect(within(weekday).getAllByText('Avg delay').length).toBeGreaterThan(0);
		expect(
			within(weekday).getByText(/Trailing-window, observation-weighted estimate/),
		).toBeInTheDocument();
	});

	it('stands the weekday section down when day_of_week is absent', () => {
		reliabilityData = { ...RELIABILITY, day_of_week: undefined };
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-weekday"]')).toBeNull();
		expect(screen.queryByText('By day of week')).not.toBeInTheDocument();
	});

	it('stands the weekday section down when every weekday carries a null mean (no fake-0)', () => {
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
		currentLocale = 'fr';
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Fiabilité' }));

		const weekday = document.querySelector('[data-slot="stop-weekday"]') as HTMLElement;
		expect(weekday).not.toBeNull();
		expect(
			within(articleCardFor(weekday)).getByRole('button', { name: 'Par jour de la semaine' }),
		).toBeInTheDocument();
		expect(within(weekday).getByText('Vendredi')).toBeInTheDocument();
		expect(within(weekday).getByText('Lundi')).toBeInTheDocument();
		expect(within(weekday).queryByText('Friday')).not.toBeInTheDocument();
		expect(within(weekday).queryByText('5')).not.toBeInTheDocument();
	});
});

describe('StopDetail reliability — by time of day (shift + day-type grains)', () => {
	it('renders the by-time-of-day shift list + weekday/weekend comparison when present', () => {
		reliabilityData = RELIABILITY_WITH_TOD;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const tod = document.querySelector('[data-slot="stop-time-of-day"]') as HTMLElement;
		expect(tod).not.toBeNull();
		expect(
			within(articleCardFor(tod)).getByRole('button', { name: 'By time of day' }),
		).toBeInTheDocument();
		expect(within(tod).getByText('Weekday vs weekend')).toBeInTheDocument();

		expect(within(tod).getByText('PM peak')).toBeInTheDocument();
		expect(within(tod).getByText('AM peak')).toBeInTheDocument();
		expect(within(tod).getByText('Weekday')).toBeInTheDocument();
		expect(within(tod).getByText('Weekend')).toBeInTheDocument();

		const shiftList = within(tod).getByRole('list', { name: 'By time of day' });
		const shiftRows = within(shiftList).getAllByRole('listitem');
		const pmIdx = shiftRows.findIndex((r) => within(r).queryByText('PM peak'));
		const amIdx = shiftRows.findIndex((r) => within(r).queryByText('AM peak'));
		expect(pmIdx).toBeGreaterThanOrEqual(0);
		expect(pmIdx).toBeLessThan(amIdx);

		expect(within(tod).queryByText('Night')).not.toBeInTheDocument();
		expect(
			within(tod).getByText(/Trailing-window, observation-weighted estimate/),
		).toBeInTheDocument();
	});

	it('stands the whole section down when the stop carries no shift/day-type grains', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(document.querySelector('[data-slot="stop-time-of-day"]')).toBeNull();
		expect(screen.queryByText('By time of day')).not.toBeInTheDocument();
	});

	it('drops an avg-only (severe-null) shift period — partition + ranker stay in lock-step', () => {
		reliabilityData = {
			...RELIABILITY,
			periods: [
				...RELIABILITY.periods!,
				{ grain: 'am_peak', otp_pct: 70, avg_delay_min: 6.4, severe_pct: null },
				{ grain: 'midday', otp_pct: 91, avg_delay_min: 1.4, severe_pct: 3 },
			],
		} as StopReliability;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const tod = document.querySelector('[data-slot="stop-time-of-day"]') as HTMLElement;
		expect(tod).not.toBeNull();
		expect(within(tod).queryByText('AM peak')).not.toBeInTheDocument();
		expect(within(tod).queryByText('6.4 min')).not.toBeInTheDocument();
		expect(within(tod).getByText('Midday')).toBeInTheDocument();
		expect(within(tod).getByText('3.0%')).toBeInTheDocument();
	});

	it('keeps the GrainPicker calendar-only even when shift grains are present', () => {
		reliabilityData = RELIABILITY_WITH_TOD;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		const group = screen.getAllByRole('radiogroup', { name: 'Roll-up period' })[0];
		const radios = within(group).getAllByRole('radio');
		expect(radios.map((r) => r.textContent?.trim())).toEqual(['Day', 'Week', 'Month']);
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
		render(StopDetail, { props: { id: '57191' } });

		expect(screen.getByText('Showing 3 of 3 departures')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		expect(screen.getByText('Showing 1 of 3 departures')).toBeInTheDocument();
		expect(screen.getByText('+4 min late')).toBeInTheDocument();
		expect(screen.queryByText('2 min early')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		expect(screen.getByText('Showing 3 of 3 departures')).toBeInTheDocument();
	});

	it('shows an honest empty state when a filter combination matches nothing', async () => {
		render(StopDetail, { props: { id: '57191' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Early' }));
		await fireEvent.click(screen.getByRole('button', { name: '80' }));

		const empty = screen.getByTestId('departures-filter-empty');
		expect(empty).toBeInTheDocument();
		expect(empty).toHaveAttribute('data-component', 'state-notice');
		expect(empty).toHaveAttribute('data-presentation', 'silo');
		expect(screen.getByText('Showing 0 of 3 departures')).toBeInTheDocument();
	});
});

describe('StopDetail live departures — HONEST ABSENCE (empty board)', () => {
	it('describes only report absence when a served route has a silent trip', () => {
		stopFileData = {
			...STOP_FILE,
			scheduled: [{ route: '51', headsign: 'X', times: ['00:00', '23:59'] }],
		} as unknown as StopFile;
		useSilentBoard = true;
		render(StopDetail, { props: { id: '57191' } });

		expect(
			screen.getByText('No departures reported for this stop in this report.'),
		).toBeInTheDocument();
		expect(screen.queryByText('scheduled, but nothing is reporting live')).toBeNull();
	});

	it('falls back to the generic honest no-data copy when no reason is derivable', () => {
		stopFileData = { ...STOP_FILE, scheduled: [] } as unknown as StopFile;
		useSilentBoard = true;
		render(StopDetail, { props: { id: '57191' } });

		expect(
			screen.getByText('No departures reported for this stop in this report.'),
		).toBeInTheDocument();
		expect(screen.queryByText('scheduled, but nothing is reporting live')).not.toBeInTheDocument();
	});
});

describe('StopDetail — service alerts affecting this stop', () => {
	it('surfaces alerts that list this stop OR a route it serves, and hides unrelated ones', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));

		const alerts = document.querySelector('[data-testid="stop-alerts"]') as HTMLElement;
		expect(alerts).not.toBeNull();
		expect(within(alerts).getByText('Service alerts')).toBeInTheDocument();

		expect(within(alerts).getByText('Elevator out of service')).toBeInTheDocument();
		expect(
			within(alerts).getByText('Route 51 is diverted & remains in service.'),
		).toBeInTheDocument();
		expect(within(alerts).queryByText('Detour on line 51')).not.toBeInTheDocument();
		expect(within(alerts).queryByText('Unrelated alert')).not.toBeInTheDocument();
		expect(within(alerts).getByText('Construction')).toBeInTheDocument();
		expect(within(alerts).getByText('Detour')).toBeInTheDocument();
	});

	it('localizes the alerts section + headlines in FR', () => {
		currentLocale = 'fr';
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Détail' }));

		const alerts = document.querySelector('[data-testid="stop-alerts"]') as HTMLElement;
		expect(within(alerts).getByText('Avis de service')).toBeInTheDocument();
		expect(
			within(alerts).getByText('La ligne 51 est détournée & reste en service.'),
		).toBeInTheDocument();
		expect(within(alerts).queryByText('Détour ligne 51')).not.toBeInTheDocument();
		expect(within(alerts).getByText('Travaux')).toBeInTheDocument();
	});

	it('stands the alerts section down when no live alert affects this stop', () => {
		useEmptyLive = true;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));

		expect(document.querySelector('[data-testid="stop-alerts"]')).toBeNull();
	});

	it('surfaces an alert the live feed targets by CODE when id != code (metro regression)', () => {
		stopFileData = STOP_FILE_BY_CODE;
		alertsData = { generated_utc: '2026-06-15T12:00:00Z', alerts: ALERTS_BY_CODE as typeof ALERTS };
		render(StopDetail, { props: { id: 'STATION-1' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));

		const alerts = document.querySelector('[data-testid="stop-alerts"]') as HTMLElement;
		expect(alerts).not.toBeNull();
		expect(within(alerts).getByText('Metro elevator out of service')).toBeInTheDocument();
	});
});

describe('StopDetail — per-stop state resets on navigation', () => {
	it('clears the departures status filter when the stop id changes', async () => {
		const { rerender } = render(StopDetail, { props: { id: '57191' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Late' }));
		expect(screen.getByText('Showing 1 of 3 departures')).toBeInTheDocument();

		await rerender({ id: '99999' });

		expect(screen.getByText('Showing 2 of 2 departures')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'false');
	});
});

const SEVERE_DEPARTURES = [
	{ eta_utc: '2026-06-15T12:05:00Z', route: '51', delay_min: 9 },
	{ eta_utc: '2026-06-15T12:08:00Z', route: '80', delay_min: 0 },
] as StopDeparture[];

describe('StopDetail live departures — colored statuses (S8B)', () => {
	it('offers all four tone chips incl. a representable SEVERE (not absorbed into late)', () => {
		render(StopDetail, { props: { id: '57191' } });
		expect(screen.getByRole('button', { name: /On-time/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Late/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Severe/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Early/ })).toBeInTheDocument();
	});

	it('tints each departure caption with the shared status fill AND a redundant glyph', () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		const late = Array.from(container.querySelectorAll('.stop-departure-delay')).find((el) =>
			el.textContent?.includes('+4 min late'),
		) as HTMLElement;
		expect(late).toBeDefined();
		expect(late.getAttribute('data-tone')).toBe('late');
		expect(late.getAttribute('style') ?? '').toContain('--dataviz-status-late');
		expect(late.querySelector('.stop-departure-glyph')?.textContent).toBe('▲');
	});

	it('bands a >=5 min departure to the SEVERE tone (its own severe fill)', () => {
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

describe('StopDetail schedule — semantic timetable + honest gaps', () => {
	it('renders route, destination and departures in one scoped schedule table', async () => {
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
		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		const table = screen.getByRole('table', { name: 'Sample weekday times by line' });
		expect(within(table).getByRole('columnheader', { name: 'Line' })).toBeInTheDocument();
		expect(within(table).getByRole('columnheader', { name: 'Destination' })).toBeInTheDocument();
		expect(within(table).getByRole('columnheader', { name: 'Departures' })).toBeInTheDocument();
		expect(within(table).getByText('51')).toBeInTheDocument();
		expect(within(table).getByText('Nord')).toBeInTheDocument();
		expect(container.querySelectorAll('.stop-schedule-time time')).toHaveLength(6);
	});

	it('states an honest per-route absence inside the route table row', async () => {
		stopFileData = {
			...STOP_FILE,
			scheduled: [{ route: '99', headsign: 'Vide', times: [] }],
		} as unknown as StopFile;
		const { container } = render(StopDetail, { props: { id: '57191' } });
		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
		const table = screen.getByRole('table', { name: 'Sample weekday times by line' });
		expect(container.querySelector('.stop-schedule-times')).toBeNull();
		const row = table.querySelector('tbody tr') as HTMLElement;
		expect(row).toHaveTextContent('99');
		expect(row.querySelector('[data-slot="absent-value"]')).not.toBeNull();
	});
});

describe('StopDetail info — 2-col layout + tri-state accessibility (S8B/A3)', () => {
	it('lays the Info pane out as facts (left) + alerts (right)', () => {
		const { container } = render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		const info = container.querySelector('.stop-info') as HTMLElement;
		expect(info).not.toBeNull();
		expect(info.querySelector('.stop-info-facts')).not.toBeNull();
		expect(info.querySelector('[data-testid="stop-alerts"]')).not.toBeNull();
	});

	it('renders accessibility as YES when wheelchair === true', () => {
		stopFileData = { ...STOP_FILE, wheelchair: true } as unknown as StopFile;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		expect(screen.getByText('Wheelchair accessible')).toBeInTheDocument();
	});

	it('renders accessibility as NO when wheelchair === false', () => {
		stopFileData = { ...STOP_FILE, wheelchair: false } as unknown as StopFile;
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		expect(screen.getByText('Not wheelchair accessible')).toBeInTheDocument();
	});

	it('renders an honest UNKNOWN (not a silent omit) when wheelchair is absent', () => {
		render(StopDetail, { props: { id: '57191' } });
		fireEvent.click(screen.getByRole('tab', { name: 'Detail' }));
		expect(screen.getByText('Accessibility')).toBeInTheDocument();
		expect(screen.queryByText('Wheelchair accessible')).not.toBeInTheDocument();
		expect(screen.queryByText('Not wheelchair accessible')).not.toBeInTheDocument();
	});
});
