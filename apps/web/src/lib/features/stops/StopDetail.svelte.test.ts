import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StopDetail from './StopDetail.svelte';

vi.mock('$lib/v1', () => ({
	getStop: vi.fn(),
	getStopReliability: vi.fn(),
	getV1Context: () => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
	createLiveStore: () => ({
		vehicles: null,
		trips: null,
		departures: null,
		alerts: null,
		network: null,
		index: { byStopId: new Map() },
		generatedUtc: null,
		ageSeconds: null,
		isStale: false,
		loading: false,
		error: null,
		start: vi.fn(),
		stop: vi.fn(),
		refresh: vi.fn(),
	}),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: null,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

describe('StopDetail map drilldown', () => {
	it('links directly to the live map filtered to this stop', () => {
		render(StopDetail, { props: { id: '57191' } });

		expect(screen.getByRole('link', { name: 'View stop 57191 on map' })).toHaveAttribute(
			'href',
			'/map?stop=57191',
		);
	});
});
