import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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

// The live store the Detail tab boots: a minimal stub exposing the index + the
// freshness fields LiveFreshness reads. start()/stop() are no-ops.
const liveStore = {
	index: {} as never,
	generatedUtc: '2026-06-15T12:00:00Z',
	ageSeconds: 12,
	isStale: false,
	start: vi.fn(),
	stop: vi.fn(),
};

vi.mock('$lib/v1', () => ({
	getRoute: vi.fn(),
	getRouteReliability: vi.fn(),
	createLiveStore: () => liveStore,
	getV1Context: () => ({ manifest: {}, labels: {}, lang: 'en' }),
	deriveRouteStopPredictions: () => PREDICTIONS,
}));

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
