import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkFile } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import NetworkHealth from './NetworkHealth.svelte';

const { openSurface, network } = vi.hoisted(() => ({
	openSurface: vi.fn(),
	network: {
		generated_utc: '2026-06-16T02:00:00Z' as IsoUtc,
		vehicles_in_service: 10,
		on_time_pct: 80,
		status_dist: {
			early: 0,
			on_time: 8,
			late: 2,
			severe: 0,
			unknown: 0,
		},
		delay_p50_min: 1,
		delay_p90_min: 6,
		non_responding: 0,
		feed_freshness_s: 20,
		coverage_pct: 95,
		occupancy_mix: null,
	} satisfies NetworkFile,
}));

vi.mock('$lib/nav', async () => {
	return {
		layout: { isDesktop: true },
		openSurface,
	};
});

vi.mock('$lib/v1', async () => {
	return {
		STATUS_CODES: ['early', 'on_time', 'late', 'severe', 'unknown'],
		OCCUPANCY_CODES: ['empty', 'many_seats', 'few_seats', 'standing', 'full'],
		getV1Context: () => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
		createLiveStore: () => ({
			vehicles: null,
			trips: null,
			departures: null,
			alerts: null,
			network,
			index: {
				vehiclesById: new Map(),
				vehiclesByRoute: new Map(),
				vehiclesByTrip: new Map(),
				stopsById: new Map(),
				tripsById: new Map(),
				alertsById: new Map(),
			},
			generatedUtc: network.generated_utc,
			ageSeconds: 20,
			isStale: false,
			loading: false,
			error: null,
			start: vi.fn(),
			stop: vi.fn(),
			refresh: vi.fn(),
		}),
		getNetworkTrend: vi.fn(),
	};
});

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: { series: [] },
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

describe('NetworkHealth drilldown', () => {
	it('opens the live map with a status filter when a status segment is selected', async () => {
		openSurface.mockClear();
		render(NetworkHealth);

		await fireEvent.click(screen.getByRole('img', { name: 'Late: 20%' }));

		expect(openSurface).toHaveBeenCalledExactlyOnceWith({ kind: 'map', search: 'status=late' });
	});
});
