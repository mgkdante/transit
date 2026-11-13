import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomePulse from './HomePulse.svelte';

const { state, createLiveStoreSpy } = vi.hoisted(() => ({
	state: {
		network: null as Record<string, unknown> | null,
		healthState: 'live' as string,
		hotspots: null as Record<string, unknown> | null,
		hotspotsSettled: true,
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
			get settled() {
				return key === 'home-hotspots' ? state.hotspotsSettled : true;
			},
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
	state.hotspotsSettled = true;
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
		expect(late).toHaveTextContent('of 260');
		expect(late).toHaveTextContent('buses with a delay reading');
		expect(screen.getByText('Buses in service').closest('div')).toHaveTextContent('355');
		expect(screen.getByText('Trips without a signal').closest('div')).toHaveTextContent('18');
		expect(screen.getByText('More than 1 min early').closest('div')).toHaveTextContent('71');
		expect(screen.getByText('On time').closest('div')).toHaveTextContent(
			'1 min early to 5 min late',
		);
	});

	it('has its final shape before any data arrives, so nothing below it moves', () => {
		state.healthState = 'never-loaded';
		state.hotspotsSettled = false;
		render(HomePulse, { props: { locale: 'en', city: 'Ottawa', manifest } });
		expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
			'Buses in service',
			'On time',
			'More than 5 min late',
			'More than 1 min early',
			'Trips without a signal',
		]);
		expect(screen.getByRole('region', { name: 'Most delayed lines' })).toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Most delayed stops' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /All hotspots/ })).toBeInTheDocument();
		expect(screen.queryByRole('status')).toBeNull();
		// The count the late figure is out of has its line before the number exists.
		const late = screen.getByText('More than 5 min late').closest('div') as HTMLElement;
		expect(late.querySelector('.pulse-of')?.textContent).toBe('');
	});

	it('explains a figure no reading stands behind instead of printing a number', () => {
		state.network = {
			...liveNetwork,
			on_time_pct: null,
			status_dist: { on_time: 0, late: 0, severe: 0, early: 0, unknown: 355 },
		};
		render(HomePulse, { props: { locale: 'en', city: 'Ottawa', manifest } });
		for (const label of ['On time', 'More than 5 min late', 'More than 1 min early']) {
			const tile = screen.getByText(label).closest('div') as HTMLElement;
			expect(
				within(tile).getByRole('button', { name: 'No data, not enough readings yet' }),
			).toBeInTheDocument();
			expect(tile).not.toHaveTextContent(/\d(?! min)/);
		}
		expect(screen.getByText('Buses in service').closest('div')).toHaveTextContent('355');
	});

	it('says the live numbers are unavailable instead of showing zeros', () => {
		state.healthState = 'failed-no-data';
		render(HomePulse, { props: { locale: 'fr', city: 'Montréal', manifest } });
		expect(screen.getByText(/Chiffres en direct indisponibles/)).toHaveAttribute('role', 'status');
		for (const label of ['Bus en service', 'À l’heure', 'Plus de 5 min de retard'])
			expect(screen.getByText(label).closest('div')).not.toHaveTextContent(/\d(?! min)/);
	});

	it('tells a failed ranking load apart from a ranking that does not exist yet', () => {
		state.network = liveNetwork;
		render(HomePulse, { props: { locale: 'en', city: 'Ottawa', manifest } });
		const lines = screen.getByRole('region', { name: 'Most delayed lines' });
		expect(within(lines).getByRole('status')).toHaveTextContent(
			'No weekly ranking has been published yet.',
		);
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
		expect(line).toHaveTextContent('24% of readings more than 5 min late');
		const stops = screen.getByRole('region', { name: 'Most delayed stops' });
		expect(within(stops).getByRole('link')).toHaveAttribute('href', '/stop/S9');
		expect(within(stops).getByRole('link')).toHaveTextContent('Rideau / Sussex');
		expect(screen.getByRole('link', { name: /All hotspots/ })).toHaveAttribute('href', '/hotspots');
		expect(screen.getByText(/republished weekly/)).toBeInTheDocument();
		expect(screen.getByText(/^Data through/)).toHaveTextContent('10');
	});
});
