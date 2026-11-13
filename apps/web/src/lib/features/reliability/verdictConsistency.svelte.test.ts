import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteReliability, StopReliability, NetworkTrend } from '#lib/v1/index.ts';
import { isoUtc } from '#lib/v1/schemas/types.ts';
import type { ReliabilityWindow } from '#lib/v1/verdict.ts';
import LinesIndex from '../lines/LinesIndex.svelte';
import RouteDetail from '../lines/RouteDetail.svelte';
import RouteReliabilityClusters from '../lines/reliability/RouteReliabilityClusters.svelte';
import StopReliabilitySurface from '../stops/reliability/sections/StopReliabilitySurface.svelte';
import NetworkSurface from '../network/reliability/sections/NetworkSurface.svelte';

const harness = vi.hoisted(() => {
	const page = { url: new URL('http://localhost/lines/24'), state: {} };
	return {
		page,
		route: null as RouteReliability | null,
		stop: null as StopReliability | null,
		network: null as NetworkTrend | null,
		mirrorSearchParams: vi.fn((values: Record<string, string | null>) => {
			const next = new URL(page.url);
			for (const [key, value] of Object.entries(values)) {
				if (value == null) next.searchParams.delete(key);
				else next.searchParams.set(key, value);
			}
			page.url = next;
		}),
	};
});
vi.mock('$app/state', () => ({ page: harness.page }));
vi.mock('#lib/site/urlMirror.ts', () => ({
	mirrorSearchParams: harness.mirrorSearchParams,
	mirrorSearchParam: vi.fn(),
}));
vi.mock('#lib/v1/repositories/historic.ts', () => ({
	getRouteReliability: async () => harness.route,
	getStopReliability: async () => harness.stop,
	getRouteReliabilityIndex: async () => new Set(['24']),
	getNetworkTrend: async () => harness.network,
	getLineHistoryIndex: async () => null,
	getNetworkHistoryIndex: async () => null,
	loadLineHistoryRange: vi.fn(),
	loadNetworkHistoryRange: vi.fn(),
}));
vi.mock('#lib/v1/repositories/static.ts', () => ({
	getRoutesIndex: async () => ({
		generated_utc: '2026-11-02T00:00:00Z',
		routes: [{ id: '24', short: '24', type: 3 }],
	}),
	getRoute: async () => ({ id: '24', generated_utc: '2026-11-02T00:00:00Z', directions: [] }),
}));
vi.mock('#lib/v1/repositories/provenance.ts', () => ({
	getProvenance: async () => ({ conformance: null }),
}));
vi.mock('#lib/v1/boot.ts', () => ({
	getV1Context: () => ({
		manifest: { short_name: 'Test', display_name: 'Test', files: { live: { ttl_s: 30 } } },
		lang: 'en',
		labels: {},
	}),
}));
vi.mock('#lib/v1/live/store.svelte.ts', () => ({
	LIVE_FAMILIES: ['vehicles', 'trips', 'departures', 'alerts', 'network'],
	createLiveStore: () => ({
		vehicles: null,
		trips: null,
		alerts: null,
		network: null,
		departures: null,
		index: {
			vehiclesById: new Map(),
			vehiclesByRoute: new Map(),
			vehiclesByTrip: new Map(),
			stopsById: new Map(),
			tripsById: new Map(),
			alertsById: new Map(),
		},
		familyStates: Object.fromEntries(
			['vehicles', 'trips', 'departures', 'alerts', 'network'].map((family) => [
				family,
				{
					phase: 'idle',
					active: false,
					retainedGeneration: null,
					health: {
						state: 'never-loaded',
						ageSeconds: null,
						isStale: false,
						retained: false,
						notice: null,
					},
				},
			]),
		),
		loading: false,
		error: null,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
	}),
}));

afterEach(() => {
	cleanup();
	harness.page.url = new URL('http://localhost/lines/24');
});

function publishedPoint(window: ReliabilityWindow) {
	return {
		date: window.date,
		otp_pct: window.otp_pct,
		observation_count: window.observation_count,
		wilson_lo: window.wilson_lo,
		wilson_hi: window.wilson_hi,
	};
}

describe('the same reliability evidence across every surface', () => {
	it('renders a reliable Verdict on all five surfaces', async () => {
		const point = {
			date: '2026-11-02',
			otp_pct: 85,
			observation_count: 4000,
			wilson_lo: 84,
			wilson_hi: 86,
		};
		harness.route = {
			id: '24',
			generated_utc: isoUtc().parse('2026-11-02T00:00:00Z'),
			periods: [{ ...point, grain: 'day', on_time: 3400 }],
			periods_by_grain: [
				{ grain: 'day', date: point.date },
				{
					grain: 'week',
					date: '2026-10-27',
					by_daytype: [{ grain: 'weekday', observation_count: 4000, on_time: 3400 }],
				},
			],
		};
		harness.stop = {
			id: '24',
			generated_utc: harness.route.generated_utc,
			periods: [
				{ grain: 'day', otp_pct: 85, observation_count: 4000, wilson_lo: 84, wilson_hi: 86 },
			],
		};
		harness.network = { generated_utc: harness.route.generated_utc, series: [point] };
		for (const mount of [
			() => render(RouteDetail, { props: { id: '24', seed: { id: '24', name: '24' } } }),
			() => render(RouteReliabilityClusters, { props: { data: harness.route!, locale: 'en' } }),
			() => render(StopReliabilitySurface, { props: { data: harness.stop!, locale: 'en' } }),
			() => render(NetworkSurface),
		]) {
			const view = mount();
			await waitFor(() =>
				expect(view.container.querySelector('[data-slot="verdict"]')).toHaveAttribute(
					'data-status',
					'reliable',
				),
			);
			expect(view.container.querySelector('.verdict__ban')).toHaveTextContent('85%');
			expect(harness.page.url.searchParams.get('grain')).toBeNull();
			cleanup();
		}
		const listing = render(LinesIndex);
		await waitFor(() => expect(listing.getByTestId('lines-sort-worst')).toBeInTheDocument());
		await fireEvent.click(listing.getByTestId('lines-sort-worst'));
		await waitFor(() =>
			expect(listing.container.querySelector('[data-slot="reliability-badge"]')).toHaveAttribute(
				'data-status',
				'reliable',
			),
		);
		expect(listing.container.querySelector('[data-slot="reliability-badge"]')).toHaveTextContent(
			'85%',
		);
		await fireEvent.click(listing.getByTestId('lines-status-problem'));
		await waitFor(() =>
			expect(listing.container.querySelector('[data-slot="reliability-badge"]')).toBeNull(),
		);
	});
});

function selectedSurface(entity: 'line' | 'stop' | 'network') {
	if (entity === 'line')
		return render(RouteReliabilityClusters, { props: { data: harness.route!, locale: 'en' } });
	if (entity === 'stop')
		return render(StopReliabilitySurface, { props: { data: harness.stop!, locale: 'en' } });
	return render(NetworkSurface);
}
it.each(['line', 'stop', 'network'] as const)(
	'%s keeps explicit windows through grain changes and URL reloads',
	async (entity) => {
		const generated_utc = isoUtc().parse('2026-11-02T00:00:00Z');
		const day = { date: '2026-11-02', grain: 'day', otp_pct: 20, observation_count: 12 };
		const week = {
			date: '2026-10-27',
			grain: 'week',
			otp_pct: 85,
			observation_count: 4000,
			on_time: 3400,
			wilson_lo: 84,
			wilson_hi: 86,
		};
		const month = { date: '2026-10-04', grain: 'month', otp_pct: 40, observation_count: 12 };
		harness.route = {
			id: '24',
			generated_utc,
			periods: [day, week, month],
			periods_by_grain: [
				{ grain: 'day', date: day.date },
				{ grain: 'week', date: week.date, by_daytype: [{ ...week, grain: 'weekday' }] },
				{
					grain: 'month',
					date: month.date,
					by_daytype: [{ ...month, grain: 'weekday', on_time: 5 }],
				},
			],
		} as RouteReliability;
		harness.stop = {
			id: '24',
			generated_utc,
			periods: harness.route.periods?.map((window) => ({
				grain: window.grain,
				otp_pct: window.otp_pct,
				observation_count: window.observation_count,
				wilson_lo: window.wilson_lo,
				wilson_hi: window.wilson_hi,
			})),
		} as StopReliability;
		harness.network = {
			generated_utc,
			series: [day],
			weekly: [publishedPoint(week)],
			monthly: [month],
		} as NetworkTrend;
		harness.page.url = new URL('http://localhost/lines/24?grain=week');
		let view = selectedSurface(entity);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="verdict"]')).toHaveAttribute(
				'data-status',
				'reliable',
			),
		);
		await fireEvent.click(view.getAllByRole('radio', { name: /month|30 days/i })[0]);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="verdict"]')).toHaveAttribute(
				'data-status',
				'tentative',
			),
		);
		expect(harness.page.url.searchParams.get('grain')).toBe('month');
		cleanup();
		view = selectedSurface(entity);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="verdict"]')).toHaveAttribute(
				'data-status',
				'tentative',
			),
		);
		await fireEvent.click(
			view.getAllByRole('radio', {
				name: entity === 'line' ? /Latest complete day/i : /^day|daily/i,
			})[0],
		);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="verdict"]')).toHaveAttribute(
				'data-status',
				'tentative',
			),
		);
		expect(view.container.querySelector('[data-slot="verdict"]')).toHaveTextContent('12');
		expect(harness.page.url.searchParams.get('grain')).toBe('day');
		cleanup();
		view = selectedSurface(entity);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="verdict"]')).toHaveAttribute(
				'data-status',
				'tentative',
			),
		);
		expect(view.container.querySelector('[data-slot="verdict"]')).toHaveTextContent('12');
	},
);

it('banner, list and pane agree on one window', async () => {
	const { closedWeek } = await import('../lines/reliability/__fixtures__/closedWeek');
	harness.route = { ...closedWeek, id: '24' };
	for (const mount of [
		() => render(RouteDetail, { props: { id: '24', seed: { id: '24', name: '24' } } }),
		() => render(RouteReliabilityClusters, { props: { data: harness.route!, locale: 'en' } }),
	]) {
		harness.page.url = new URL('http://localhost/lines/24');
		const view = mount();
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="verdict"]')).toHaveTextContent('84%'),
		);
		if (view.queryAllByRole('radio').length)
			expect(view.getByRole('radio', { name: /Last 7 days/, checked: true })).toBeInTheDocument();
		cleanup();
	}
});

it('list uses the same closed week on arrival', async () => {
	const { closedWeek } = await import('../lines/reliability/__fixtures__/closedWeek');
	harness.route = { ...closedWeek, id: '24' };
	const view = render(LinesIndex);
	await fireEvent.click(await view.findByTestId('lines-sort-worst'));
	await waitFor(() =>
		expect(view.container.querySelector('[data-slot="reliability-badge"]')).toHaveAccessibleName(
			/84.*week to Nov 10/,
		),
	);
});

it.each([true, false])('opens an enabled closed choice when a week exists: %s', async (hasWeek) => {
	const { closedWeek } = await import('../lines/reliability/__fixtures__/closedWeek');
	const data = hasWeek
		? closedWeek
		: {
				...closedWeek,
				periods_by_grain: closedWeek.periods_by_grain!.filter((p) => p.grain === 'day'),
			};
	harness.page.url = new URL('http://localhost/lines/24');
	const view = render(RouteReliabilityClusters, { props: { data, locale: 'en' } });
	const choice = view.getByRole('radio', { checked: true });
	expect(choice).toBeEnabled();
	expect(choice).toHaveAccessibleName(hasWeek ? /Last 7 days/ : /Latest complete day/);
	expect(view.container.querySelector('[data-slot="verdict"]')).toHaveTextContent(
		hasWeek ? '84%' : '85%',
	);
});
