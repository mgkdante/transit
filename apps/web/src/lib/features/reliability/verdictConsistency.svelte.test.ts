import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteReliability, StopReliability, NetworkTrend } from '$lib/v1';
import LinesIndex from '../lines/LinesIndex.svelte';
import RouteDetail from '../lines/RouteDetail.svelte';
import RouteReliabilityClusters from '../lines/reliability/RouteReliabilityClusters.svelte';
import StopReliabilitySurface from '../stops/reliability/sections/StopReliabilitySurface.svelte';
import NetworkSurface from '../network/reliability/sections/NetworkSurface.svelte';

const harness = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/lines/24'), state: {} },
	route: null as RouteReliability | null,
	stop: null as StopReliability | null,
	network: null as NetworkTrend | null,
}));
vi.mock('$app/state', () => ({ page: harness.page }));
vi.mock('$lib/site/urlMirror', () => ({ mirrorSearchParams: vi.fn(), mirrorSearchParam: vi.fn() }));
vi.mock('$lib/v1/repositories/historic', () => ({
	getRouteReliability: async () => harness.route,
	getStopReliability: async () => harness.stop,
	getRouteReliabilityIndex: async () => new Set(['24']),
	getNetworkTrend: async () => harness.network,
	getLineHistoryIndex: async () => null,
	getNetworkHistoryIndex: async () => null,
	loadLineHistoryRange: vi.fn(),
	loadNetworkHistoryRange: vi.fn(),
}));
vi.mock('$lib/v1/repositories/static', () => ({
	getRoutesIndex: async () => ({
		generated_utc: '2026-11-02T00:00:00Z',
		routes: [{ id: '24', short: '24', type: 3 }],
	}),
	getRoute: async () => ({ id: '24', generated_utc: '2026-11-02T00:00:00Z', directions: [] }),
}));
vi.mock('$lib/v1/repositories/provenance', () => ({
	getProvenance: async () => ({ conformance: null }),
}));
vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({
		manifest: { short_name: 'Test', display_name: 'Test', files: { live: { ttl_s: 30 } } },
		lang: 'en',
		labels: {},
	}),
}));
vi.mock('$lib/v1/live/store.svelte', () => ({
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

afterEach(cleanup);

describe('the same reliability evidence across every surface', () => {
	it.each([
		[85, 4000, 'reliable', [], 85],
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
		async (otp_pct, observation_count, status, otherWindows, headlinePct) => {
			const point = { date: '2026-11-02', otp_pct, observation_count };
			harness.route = {
				id: '24',
				generated_utc: '2026-11-02T00:00:00Z',
				periods: [...(otp_pct == null ? [] : [{ ...point, grain: 'day' }]), ...otherWindows],
			} as RouteReliability;
			harness.stop = { ...harness.route } as StopReliability;
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
		},
	);
});
