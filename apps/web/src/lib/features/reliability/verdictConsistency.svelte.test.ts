import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteReliability, StopReliability, NetworkTrend } from '#lib/v1/index.ts';
import { isoUtc } from '#lib/v1/schemas/types.ts';
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
		loading: false,
		error: null,
		generatedUtc: null,
		ageSeconds: null,
		isStale: false,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
	}),
}));

afterEach(() => {
	cleanup();
	harness.page.url = new URL('http://localhost/lines/24');
});

describe('the same reliability evidence across every surface', () => {
	it.each([
		[85, 230, 'tentative', [], 85, { on_time: 195, wilson_lo: 79.6, wilson_hi: 88.9 }],
		[80, 1_000_000, 'patchy', [], 80, { on_time: 797_000, wilson_lo: 79.6, wilson_hi: 79.8 }],
		[85, 4000, 'reliable', [], 85],
		[79.6, 1_000_000, 'patchy', [], 80],
		[59.6, 1_000_000, 'patchy', [], 60],
		[85, 100, 'tentative', [], 85],
		[55, 200, 'unreliable', [], 55],
		[65, 40, 'patchy', [], 65],
		[70, 40, 'tentative', [], 70],
		[79, 5000, 'tentative', [], 79],
		[81, 5000, 'tentative', [], 81],
		[79, 10000, 'patchy', [], 79],
		[81, 10000, 'reliable', [], 81],
		[72, 4000, 'patchy', [], 72],
		[48, 4000, 'unreliable', [], 48],
		[85, 29, 'tentative', [], 85],
		[85, null, 'tentative', [], 85],
		[80, 1000, 'tentative', [], 80],
		[
			20,
			12,
			'reliable',
			[{ grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 4000 }],
			85,
		],
		[
			20,
			12,
			'patchy',
			[
				{ grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 29 },
				{ grain: 'month', date: '2026-10-01', otp_pct: 72, observation_count: 4000 },
			],
			72,
		],
		[
			null,
			null,
			'patchy',
			[
				{ grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 29 },
				{ grain: 'month', date: '2026-10-01', otp_pct: 72, observation_count: 4000 },
			],
			72,
		],
	] as const)(
		'%s percent with n=%s produces %s everywhere',
		async (
			otp_pct,
			observation_count,
			status,
			otherWindows,
			headlinePct,
			published = undefined,
		) => {
			const point = {
				date: '2026-11-02',
				otp_pct,
				observation_count,
				wilson_lo: published?.wilson_lo,
				wilson_hi: published?.wilson_hi,
			};
			harness.route = {
				id: '24',
				generated_utc: '2026-11-02T00:00:00Z',
				periods: [
					...(otp_pct == null
						? []
						: [
								{
									...point,
									grain: 'day',
									on_time:
										published?.on_time ??
										(observation_count == null
											? null
											: Math.round((otp_pct / 100) * observation_count)),
								},
							]),
					...otherWindows,
				],
			} as RouteReliability;
			harness.stop = {
				...harness.route,
				periods: harness.route.periods?.map((window) => ({
					grain: window.grain,
					otp_pct: window.otp_pct,
					observation_count: window.observation_count,
					wilson_lo: window.wilson_lo,
					wilson_hi: window.wilson_hi,
				})),
			} as StopReliability;
			harness.network = {
				generated_utc: harness.route.generated_utc,
				series: otp_pct == null ? [] : [point],
				weekly: otherWindows.filter((w) => w.grain === 'week'),
				monthly: otherWindows.filter((w) => w.grain === 'month'),
			} as NetworkTrend;
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
						status,
					),
				);
				if (status !== 'tentative')
					expect(view.container.querySelector('.verdict__ban')).toHaveTextContent(
						`${headlinePct}%`,
					);
				expect(harness.page.url.searchParams.get('grain')).toBeNull();
				cleanup();
			}
			const listing = render(LinesIndex);
			await waitFor(() => expect(listing.getByTestId('lines-sort-worst')).toBeInTheDocument());
			await fireEvent.click(listing.getByTestId('lines-sort-worst'));
			await waitFor(() =>
				expect(
					listing.container.querySelector(
						'[data-slot="reliability-badge"], [data-slot="reliability-hedge"]',
					),
				).not.toBeNull(),
			);
			expect(
				listing.container.querySelector(
					'[data-slot="reliability-badge"], [data-slot="reliability-hedge"]',
				),
			).toHaveAttribute('data-status', status);
			if (observation_count === 29)
				expect(
					listing.container.querySelector('[data-slot="reliability-hedge"]'),
				).toHaveTextContent('29');
			if (status !== 'tentative')
				expect(
					listing.container.querySelector('[data-slot="reliability-badge"]'),
				).toHaveTextContent(`${headlinePct}%`);
			if (status === 'reliable') expect(headlinePct).toBeGreaterThanOrEqual(80);
			await fireEvent.click(listing.getByTestId('lines-status-problem'));
			await waitFor(() => {
				const badge = listing.container.querySelector('[data-slot="reliability-badge"]');
				if (status === 'patchy' || status === 'unreliable')
					expect(badge).toHaveAttribute('data-status', status);
				else expect(badge).toBeNull();
			});
		},
	);
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
		const week = { date: '2026-10-27', grain: 'week', otp_pct: 85, observation_count: 4000 };
		const month = { date: '2026-10-01', grain: 'month', otp_pct: 40, observation_count: 12 };
		harness.route = { id: '24', generated_utc, periods: [day, week, month] } as RouteReliability;
		harness.stop = { ...harness.route } as StopReliability;
		harness.network = {
			generated_utc,
			series: [day],
			weekly: [week],
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
		await fireEvent.click(view.getAllByRole('radio', { name: /month/i })[0]);
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
		await fireEvent.click(view.getAllByRole('radio', { name: /day|daily/i })[0]);
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
