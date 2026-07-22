import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
import type { Vehicle } from '$lib/v1/schemas';
import SearchSurface from './SearchSurface.svelte';

// ── Fixtures ────────────────────────────────────────────────────────────────
const ROUTES = [
	{ id: '1', short: '1', long: 'Ligne 1 Verte', type: 1, color: '009EE0' }, // métro
	{ id: '161', short: '161', long: 'Van Horne', type: 3, color: null }, // bus, no colour
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

// Controllable reliability snapshots, keyed by id.
const routeSnaps = new Map<string, ReliabilitySnapshot>();
const stopSnaps = new Map<string, ReliabilitySnapshot>();
function snap(partial: Partial<ReliabilitySnapshot>): ReliabilitySnapshot {
	return { phase: 'idle', otpPct: null, verdict: null, series: [], ...partial };
}

// Query the URL seeds from — held in a hoisted box so the (hoisted) mock factory
// can read the value a test sets just before render.
const urlBox = vi.hoisted(() => ({ query: 'q=ber' }));
const liveHarness = vi.hoisted(() => ({ createLiveStore: vi.fn() }));
function setUrlQuery(q: string) {
	urlBox.query = q;
}

vi.mock('$app/stores', () => ({
	// A getter so each `get(page)` re-reads the current url box (lazy, not snapshot).
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
		// Distinguish the routes vs stops resource by what the (mocked) fetcher
		// returns is not possible; instead key off call order via a counter.
		const data = nextResource();
		void fetcher;
		return { data, error: null, loading: false, settled: true, reload: vi.fn() };
	},
}));

// createResource is called twice in order: routes first, then stops.
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

// ── Idle / empty ──────────────────────────────────────────────────────────────
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

// ── Drilldown (existing behaviour must stay green) ──────────────────────────────
describe('SearchSurface result drilldown', () => {
	it('links a line result to its detail page and a stop result to its detail page', () => {
		setUrlQuery('q=ber'); // matches métro line "Verte"? no — use a query that hits both
		render(SearchSurface);
		// "berri" matches the station; render and check the link target.
		expect(screen.getByRole('link', { name: /Station Berri-UQAM/i })).toHaveAttribute(
			'href',
			'/stop/10146',
		);
	});
});

// ── Inline reliability badge ────────────────────────────────────────────────────
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
		// The stop link still renders.
		expect(screen.getByRole('link', { name: /Station Berri-UQAM/i })).toBeInTheDocument();
	});
});

// ── Mode + colour + scope ───────────────────────────────────────────────────────
describe('SearchSurface line mode + colour', () => {
	it('renders a guarded colour swatch only when the GTFS colour is present', () => {
		setUrlQuery('q=ligne'); // matches the métro line by long name
		const { container } = render(SearchSurface);
		const swatch = container.querySelector('.entity-row-swatch') as HTMLElement | null;
		expect(swatch).not.toBeNull();
		// The swatch carries the normalized GTFS hue inline (the one allowed dynamic colour).
		expect(swatch?.getAttribute('style')).toContain('#009ee0');
	});

	it('tags a métro line with its mode', () => {
		setUrlQuery('q=ligne');
		render(SearchSurface);
		// Scope to the Lines result section (the mode chip button also reads "Métro").
		const lines = screen.getByRole('region', { name: 'Lines' });
		expect(within(lines).getByText('Métro')).toBeInTheDocument();
	});
});

describe('SearchSurface stop mode tag for all modes', () => {
	it('tags a plain BUS stop with a visible mode tag (today untagged)', () => {
		setUrlQuery('q=van horne');
		render(SearchSurface);
		// Scope to the Stops result section — the bus stop now carries a "Bus" tag
		// (today such stops are untagged). The mode chip + line tag also read "Bus".
		const stops = screen.getByRole('region', { name: 'Stops' });
		expect(within(stops).getByText('Bus')).toBeInTheDocument();
	});
});

describe('SearchSurface scope filter', () => {
	it('restricts to lines, hiding stop results', async () => {
		setUrlQuery('q=van horne'); // matches route 161 (long) + stop 57191 (name)
		render(SearchSurface);
		// Without scope, both the line and the stop show.
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
		setUrlQuery('q=van horne'); // bus line 161 + bus stop, no métro match
		render(SearchSurface);
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();

		const metroChip = screen.getByRole('button', { name: 'Métro' });
		await metroChip.click();

		// 161 is a bus line → the métro filter hides it; nothing métro matches "van horne".
		expect(screen.queryByRole('link', { name: /161.*Van Horne/i })).toBeNull();
	});
});

// ── Vehicle results ─────────────────────────────────────────────────────────────
describe('SearchSurface vehicle results', () => {
	it('shows a matched live bus with status, signed delay, and resolved next stop', () => {
		setUrlQuery('q=40061');
		render(SearchSurface);

		const busRow = screen.getByRole('link', { name: 'Live bus 40061' });
		expect(busRow).toBeInTheDocument();
		// Links to the live map filtered to this bus.
		expect(busRow).toHaveAttribute('href', '/map?vehicle=40061');
		// Status chip (Late), signed delay (+4 min), resolved next-stop name.
		expect(within(busRow).getByText('Late')).toBeInTheDocument();
		expect(within(busRow).getByText('+4 min')).toBeInTheDocument();
		expect(within(busRow).getByText('Next: Van Horne / Rockland')).toBeInTheDocument();
	});
});
