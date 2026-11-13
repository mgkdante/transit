import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomePulse from './HomePulse.svelte';

const { state, createLiveStoreSpy } = vi.hoisted(() => ({
	state: {
		network: null as Record<string, unknown> | null,
		healthState: 'live' as string,
		hotspots: null as Record<string, unknown> | null,
	},
	createLiveStoreSpy: vi.fn(),
}));

vi.mock('#lib/nav/index.ts', async () => {
	const { routeFor } = await vi.importActual<typeof import('#lib/nav/intent.svelte.ts')>(
		'#lib/nav/intent.svelte.ts',
	);
	return { routeFor };
});
vi.mock('#lib/v1/live/store.svelte.ts', () => ({
	LIVE_FAMILIES: ['vehicles', 'trips', 'departures', 'alerts', 'network'],
	createLiveStore: (manifest: unknown, _reader: unknown, options: unknown) => {
		createLiveStoreSpy(manifest, options);
		return {
			get network() {
				return state.network;
			},
			get familyStates() {
				return {
					network: {
						active: true,
						retainedGeneration: null,
						health: {
							state: state.healthState,
							retained: state.network != null,
							ageSeconds: 12,
							isStale: false,
							notice: null,
						},
					},
				};
			},
			start: vi.fn(),
			stop: vi.fn(),
		};
	},
}));
vi.mock('#lib/v1/resource.svelte.ts', () => ({
	createResource: (_loader: unknown, options?: { key?: () => unknown }) => {
		const key = options?.key?.();
		return {
			get data() {
				if (key === 'home-hotspots') return state.hotspots;
				return { routes: [{ id: '7-354', short: '7' }] };
			},
			error: null,
			loading: false,
			settled: true,
		};
	},
}));
vi.mock('#lib/v1/repositories/historic.ts', () => ({ getHotspots: vi.fn() }));
vi.mock('#lib/v1/repositories/static.ts', () => ({ getRoutesIndex: vi.fn() }));

const manifest = { provider: 'fixture', tz: 'America/Toronto' } as never;
const liveNetwork = {
	generated_utc: '2026-11-12T23:50:24Z',
	vehicles_in_service: 355,
	on_time_pct: 57,
	status_dist: { on_time: 69, late: 78, severe: 42, early: 71, unknown: 95 },
	non_responding: 18,
	feed_freshness_s: 20,
};
const dayRanking = {
	generated_utc: '2026-11-11T00:00:00Z',
	by_grain: [
		{
			grain: 'week',
			date: '2026-11-04',
			window_end: '2026-11-10',
			entries: [
				{ id: '7-354', type: 'route', rank: 1, name: 'Carleton <> St-Laurent', severe_pct: 24 },
				{ id: 'S9', type: 'stop', rank: 2, name: 'RIDEAU / SUSSEX', severe_pct: 21.5 },
			],
		},
	],
};

afterEach(() => {
	state.network = null;
	state.healthState = 'live';
	state.hotspots = null;
	createLiveStoreSpy.mockClear();
});

describe('Home accountability strip', () => {
	it('always offers the map and network health, even before data boots', () => {
		render(HomePulse, { props: { locale: 'en', city: 'Ottawa', manifest: null } });
		expect(screen.getByRole('heading', { name: 'Right now in Ottawa' })).toBeInTheDocument();
		const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
		expect(links).toEqual(['/map', '/network']);
		expect(createLiveStoreSpy).not.toHaveBeenCalled();
	});

	it('shows live counts with the denominator behind the late count', () => {
		state.network = liveNetwork;
		render(HomePulse, { props: { locale: 'en', city: 'Ottawa', manifest } });
		expect(createLiveStoreSpy).toHaveBeenCalledWith(manifest, { families: ['network'] });
		const late = screen.getByText('More than 5 min late').closest('div') as HTMLElement;
		expect(late).toHaveTextContent('42');
		expect(late).toHaveTextContent('of 260 buses with a delay reading');
		expect(screen.getByText('Buses in service').closest('div')).toHaveTextContent('355');
		expect(screen.getByText('Trips without a signal').closest('div')).toHaveTextContent('18');
		expect(screen.getByText('More than 1 min early').closest('div')).toHaveTextContent('71');
		expect(screen.getByText('On time').closest('div')).toHaveTextContent(
			'1 min early to 5 min late',
		);
	});

	it('says the live numbers are missing instead of showing zeros', () => {
		state.healthState = 'failed-no-data';
		render(HomePulse, { props: { locale: 'fr', city: 'Montréal', manifest } });
		expect(screen.getByText(/la donnée manque/)).toHaveAttribute('role', 'status');
		expect(screen.queryByText('Bus en service')).toBeNull();
	});

	it('names the worst lines by route number and links each ranking to its page', () => {
		state.network = liveNetwork;
		state.hotspots = dayRanking;
		render(HomePulse, { props: { locale: 'en', city: 'Ottawa', manifest } });
		const lines = screen.getByRole('region', { name: 'Most delayed lines' });
		const line = within(lines).getByRole('link');
		expect(line).toHaveAttribute('href', '/lines/7-354');
		expect(within(line).getByText('7')).toBeInTheDocument();
		expect(line).toHaveTextContent('Carleton <> St-Laurent');
		expect(line).toHaveTextContent('24% severely late');
		const stops = screen.getByRole('region', { name: 'Most delayed stops' });
		expect(within(stops).getByRole('link')).toHaveAttribute('href', '/stop/S9');
		expect(within(stops).getByRole('link')).toHaveTextContent('Rideau / Sussex');
		expect(screen.getByRole('link', { name: /All hotspots/ })).toHaveAttribute('href', '/hotspots');
		expect(screen.getByText(/republished weekly/)).toHaveTextContent('data through');
	});
});
