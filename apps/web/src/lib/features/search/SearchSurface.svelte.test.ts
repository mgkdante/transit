import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
import type { Vehicle } from '$lib/v1/schemas';
import SearchSurface from './SearchSurface.svelte';

const ROUTES = [
	{ id: '1', short: '1', long: 'Ligne 1 Verte', type: 1, color: '009EE0' },
	{ id: '161', short: '161', long: 'Van Horne', type: 3, color: null },
];
const STOPS = [
	{
		id: '57191',
		code: '57191',
		name: 'Van Horne / Rockland',
		lat: 45.53,
		lon: -73.59,
		mode: 'bus',
	},
	{
		id: '10146',
		code: '10146',
		name: 'Station Berri-UQAM',
		lat: 45.51,
		lon: -73.56,
		mode: 'metro',
	},
];
const VEHICLES: Vehicle[] = [
	{
		id: '40061',
		lat: 45.5,
		lon: -73.6,
		status: 'late',
		updated_utc: '2026-06-16T00:00:00Z' as Vehicle['updated_utc'],
		route: '161',
		trip: '296851600',
		next_stop: '57191',
		bearing: 90,
		occupancy: 'few_seats',
		delay_min: 4,
	},
];

const routeSnaps = new Map<string, ReliabilitySnapshot>();
const stopSnaps = new Map<string, ReliabilitySnapshot>();
function snap(partial: Partial<ReliabilitySnapshot>): ReliabilitySnapshot {
	return { phase: 'idle', otpPct: null, verdict: null, series: [], ...partial };
}

const urlBox = vi.hoisted(() => ({ query: 'q=ber' }));
const liveHarness = vi.hoisted(() => ({ createLiveStore: vi.fn() }));
function setUrlQuery(q: string) {
	urlBox.query = q;
}

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: { url: URL }) => void) => {
			run({ url: new URL(`http://localhost/search?${urlBox.query}`) });
			return () => {};
		},
	},
}));

vi.mock('$lib/v1/repositories/static', () => ({
	getRoutesIndex: vi.fn(),
	getStopsIndex: vi.fn(),
}));
vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({ manifest: {}, labels: {}, lang: 'en' }),
}));
vi.mock('$lib/v1/live/store.svelte', () => ({
	createLiveStore: liveHarness.createLiveStore,
}));
vi.mock('$lib/v1/reliabilitySnapshot.svelte', () => ({
	createReliabilityLoader: (kind: 'route' | 'stop') => {
		const store = kind === 'route' ? routeSnaps : stopSnaps;
		return {
			get: (id: string) => store.get(id) ?? snap({}),
			request: vi.fn(),
			reliability: () => ({ destroy() {} }),
			get inFlight() {
				return 0;
			},
		};
	},
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (fetcher: () => unknown) => {
		const data = nextResource();
		void fetcher;
		return { data, error: null, loading: false, settled: true, reload: vi.fn() };
	},
}));

let resourceCall = 0;
function nextResource() {
	resourceCall += 1;
	return resourceCall % 2 === 1
		? { generated_utc: '2026-06-16T00:00:00Z', routes: ROUTES }
		: { generated_utc: '2026-06-16T00:00:00Z', stops: STOPS };
}

beforeEach(() => {
	routeSnaps.clear();
	stopSnaps.clear();
	resourceCall = 0;
	setUrlQuery('q=ber');
	liveHarness.createLiveStore.mockReset().mockReturnValue({
		vehicles: { generated_utc: '2026-06-16T00:00:00Z', vehicles: VEHICLES },
		generatedUtc: '2026-06-16T00:00:00Z',
		ageSeconds: 0,
		isStale: false,
		start: vi.fn(),
		stop: vi.fn(),
	});
});

describe('SearchSurface idle state', () => {
	it('shows the instructional idle note before the rider types', () => {
		setUrlQuery('');
		render(SearchSurface);
		expect(liveHarness.createLiveStore.mock.calls[0]?.[1]).toEqual({
			families: ['vehicles'],
		});
		expect(screen.getByText('Search a line, stop or bus')).toBeInTheDocument();
	});
});

describe('SearchSurface result drilldown', () => {
	it('links a line result to its detail page and a stop result to its detail page', () => {
		setUrlQuery('q=ber');
		render(SearchSurface);
		expect(screen.getByRole('link', { name: /Station Berri-UQAM/i })).toHaveAttribute(
			'href',
			'/stop/10146',
		);
	});
});

describe('SearchSurface inline reliability', () => {
	it('renders the OTP% badge on a stop result whose reliability loaded', () => {
		stopSnaps.set('10146', snap({ phase: 'ready', otpPct: 88, verdict: 'late' }));
		render(SearchSurface);
		expect(screen.getByText('88%')).toBeInTheDocument();
	});

	it('shows no badge for a result with no reliability data (honesty)', () => {
		stopSnaps.set('10146', snap({ phase: 'empty' }));
		const { container } = render(SearchSurface);
		expect(container.querySelector('[data-slot="reliability-badge"]')).toBeNull();
		expect(screen.getByRole('link', { name: /Station Berri-UQAM/i })).toBeInTheDocument();
	});
});

describe('SearchSurface line mode + colour', () => {
	it('renders a guarded colour swatch only when the GTFS colour is present', () => {
		setUrlQuery('q=ligne');
		const { container } = render(SearchSurface);
		const swatch = container.querySelector('.entity-row-swatch') as HTMLElement | null;
		expect(swatch).not.toBeNull();
		expect(swatch?.getAttribute('style')).toContain('#009ee0');
	});

	it('tags a métro line with its mode', () => {
		setUrlQuery('q=ligne');
		render(SearchSurface);
		const lines = screen.getByRole('region', { name: 'Lines' });
		expect(within(lines).getByText('Métro')).toBeInTheDocument();
	});
});

describe('SearchSurface stop mode tag for all modes', () => {
	it('tags a plain BUS stop with a visible mode tag (today untagged)', () => {
		setUrlQuery('q=van horne');
		render(SearchSurface);
		const stops = screen.getByRole('region', { name: 'Stops' });
		expect(within(stops).getByText('Bus')).toBeInTheDocument();
	});
});

describe('SearchSurface scope filter', () => {
	it('restricts to lines, hiding stop results', async () => {
		setUrlQuery('q=van horne');
		render(SearchSurface);
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Van Horne \/ Rockland/i })).toBeInTheDocument();

		const scopeGroup = screen.getByRole('radiogroup', { name: 'Show' });
		await within(scopeGroup)
			.getByRole('radio', { name: /Lines \(1\)/ })
			.click();

		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Van Horne \/ Rockland/i })).toBeNull();
	});
});

describe('SearchSurface mode chip filter', () => {
	it('narrows to métro lines/stops when the Métro chip is on', async () => {
		setUrlQuery('q=van horne');
		render(SearchSurface);
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();

		const metroChip = screen.getByRole('button', { name: 'Métro' });
		await metroChip.click();

		expect(screen.queryByRole('link', { name: /161.*Van Horne/i })).toBeNull();
	});
});

describe('SearchSurface vehicle results', () => {
	it('shows a matched live bus with status, signed delay, and resolved next stop', () => {
		setUrlQuery('q=40061');
		render(SearchSurface);

		const busRow = screen.getByRole('link', { name: 'Live bus 40061, Late, Delay: +4 min' });
		expect(busRow).toBeInTheDocument();
		expect(busRow).toHaveAttribute('href', '/map?vehicle=40061');
		expect(within(busRow).getByText('Late')).toBeInTheDocument();
		expect(within(busRow).getByText('+4 min')).toBeInTheDocument();
		expect(within(busRow).getByText('Next: Van Horne / Rockland')).toBeInTheDocument();
	});
});

describe('SearchSurface collection disclosure (M6i F25)', () => {
	const NOTICE_EN =
		'Lines, stops and buses are matched in your browser; address search is sent to our server and the Government of Canada Geo.ca service.';

	it('shows the disclosure on the search page, idle and with a query', () => {
		setUrlQuery('');
		const idle = render(SearchSurface);
		expect(within(idle.container).getByText(NOTICE_EN)).toBeInTheDocument();
		idle.unmount();

		setUrlQuery('q=van horne');
		const queried = render(SearchSurface);
		expect(within(queried.container).getByText(NOTICE_EN)).toBeInTheDocument();
	});

	it('presents the disclosure to assistive tech (not an aria-hidden twin)', () => {
		render(SearchSurface);
		expect(screen.getByText(NOTICE_EN)).not.toHaveAttribute('aria-hidden', 'true');
	});
});
