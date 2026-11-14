import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ReliabilitySnapshot } from '#lib/v1/reliabilitySnapshot.svelte.ts';
import type { RouteIndexEntry, StopIndexEntry, Vehicle } from '#lib/v1/schemas/index.ts';
import SearchSurface from './SearchSurface.svelte';

const ROUTES: RouteIndexEntry[] = [
	{ id: '1', short: '1', long: 'Ligne 1 Verte', type: 1, color: '009EE0' },
	{ id: '161', short: '161', long: 'Van Horne', type: 3, color: null },
];
const STOPS: StopIndexEntry[] = [
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

const localeState = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fr' }));
vi.mock('#lib/i18n/index.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/i18n/index.ts')>()),
	getLocale: () => localeState.locale,
}));

const urlBox = vi.hoisted(() => ({ query: 'q=ber' }));
const liveHarness = vi.hoisted(() => ({ createLiveStore: vi.fn() }));
function setUrlQuery(q: string) {
	urlBox.query = q;
}

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost/search?${urlBox.query}`);
		},
	},
}));

vi.mock('#lib/v1/repositories/static.ts', () => ({
	getRoutesIndex: vi.fn(),
	getStopsIndex: vi.fn(),
}));
vi.mock('#lib/v1/boot.ts', () => ({
	getV1Context: () => ({ manifest: {}, labels: {}, lang: 'en' }),
}));
vi.mock('#lib/v1/live/store.svelte.ts', () => ({
	LIVE_FAMILIES: ['vehicles', 'trips', 'departures', 'alerts', 'network'],
	createLiveStore: liveHarness.createLiveStore,
}));
vi.mock('#lib/v1/reliabilitySnapshot.svelte.ts', () => ({
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

vi.mock('#lib/v1/resource.svelte.ts', () => ({
	createResource: (fetcher: () => unknown) => {
		const data = nextResource();
		void fetcher;
		return { data, error: null, loading: false, settled: true, reload: vi.fn() };
	},
}));

let resourceCall = 0;
let routeData: RouteIndexEntry[] = ROUTES;
let stopData: StopIndexEntry[] = STOPS;
function nextResource() {
	resourceCall += 1;
	return resourceCall % 2 === 1
		? { generated_utc: '2026-06-16T00:00:00Z', routes: routeData }
		: { generated_utc: '2026-06-16T00:00:00Z', stops: stopData };
}

beforeEach(() => {
	localeState.locale = 'en';
	routeSnaps.clear();
	stopSnaps.clear();
	resourceCall = 0;
	routeData = ROUTES;
	stopData = STOPS;
	setUrlQuery('q=ber');
	liveHarness.createLiveStore.mockReset().mockReturnValue({
		vehicles: { generated_utc: '2026-06-16T00:00:00Z', vehicles: VEHICLES },
		generatedUtc: '2026-06-16T00:00:00Z',
		familyStates: {
			vehicles: {
				active: true,
				retainedGeneration: '2026-06-16T00:00:00Z',
				health: { retained: true, state: 'live', ageSeconds: 0, isStale: false, notice: null },
			},
		},
		ageSeconds: 0,
		isStale: false,
		start: vi.fn(),
		stop: vi.fn(),
	});
});

describe('SearchSurface idle state', () => {
	it("preserves each surface's tied line and stop order", () => {
		routeData = [
			{ id: 'z', short: '20', long: 'Café', type: 3 },
			{ id: 'a', short: '3', long: 'Café', type: 3 },
		];
		stopData = [
			{ id: 'z', code: 'z', name: 'Zulu Hub', lat: 0, lon: 0 },
			{ id: 'a', code: 'a', name: 'Alpha Hub', lat: 0, lon: 0 },
		];
		for (const [q, name, hrefs] of [
			['café', 'Lines', ['/lines/z', '/lines/a']],
			['hub', 'Stops', ['/stop/z', '/stop/a']],
		] as const) {
			setUrlQuery(`q=${q}`);
			const view = render(SearchSurface);
			expect(
				within(view.getByRole('region', { name }))
					.getAllByRole('link')
					.map((r) => r.getAttribute('href')),
			).toEqual(hrefs);
			view.unmount();
		}
	});
	it("keeps exact, prefix, substring and reversed-token matches in today's order", () => {
		routeData = ['x hub', 'hub north', 'hub', 'hub x'].map((long, i) => ({
			id: `r${i}`,
			short: `n${i}`,
			long,
			type: 3,
		}));
		for (const [q, ids] of [
			['hub', ['r2', 'r1', 'r3', 'r0']],
			['x hub', ['r0', 'r3']],
			['n1', ['r1']],
			['r1', ['r1']],
			['40061', []],
			['400', []],
		] as const) {
			setUrlQuery(`q=${q}`);
			const view = render(SearchSurface);
			expect(
				view.queryByRole('region', { name: 'Lines' })
					? within(view.getByRole('region', { name: 'Lines' }))
							.getAllByRole('link')
							.map((r) => r.getAttribute('href'))
					: [],
			).toEqual(ids.map((id) => `/lines/${id}`));
			expect(view.queryAllByRole('link', { name: /Live bus/ })).toHaveLength(q === '40061' ? 1 : 0);
			view.unmount();
		}
	});
	it.each(['en', 'fr'] as const)('omits the catalogue census and live age in %s', (locale) => {
		localeState.locale = locale;
		setUrlQuery('');
		const { container } = render(SearchSurface);
		expect(container.querySelector('[data-slot="search-census"]')).toBeNull();
		expect(container.querySelector('[data-slot="freshness-stamp"]')).toBeNull();
		expect(screen.queryByText(/The network right now|Le réseau en ce moment/)).toBeNull();
		expect(
			screen.getByRole('button', { name: /^(Line number|Numéro de ligne)$/ }),
		).toBeInTheDocument();
	});

	it('uses the shared listing search with an accessible name and magnifier', () => {
		const { container } = render(SearchSurface);
		const box = screen.getByRole('textbox', { name: 'Search lines, stops and buses' });
		expect(box.closest('[data-slot="listing-search-field"]')).not.toBeNull();
		expect(box.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(container.querySelector('label[for="surface-search-input"]')).toBeNull();
	});

	it('shows the instructional idle note before the rider types', () => {
		setUrlQuery('');
		render(SearchSurface);
		expect(liveHarness.createLiveStore.mock.calls[0]?.[2]).toEqual({
			families: ['vehicles'],
		});
		expect(screen.getByText('Search a line, stop or bus')).toBeInTheDocument();
	});
});

describe('SearchSurface inline reliability', () => {
	it('renders the OTP% badge on a stop result whose reliability loaded', () => {
		stopSnaps.set('10146', snap({ phase: 'ready', otpPct: 88, verdict: 'reliable' }));
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

		const scopeGroup = screen.getByRole('tablist', { name: 'Show' });
		await within(scopeGroup)
			.getByRole('tab', { name: /Lines \(1\)/ })
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
		expect(
			within(busRow.closest('[data-slot="entity-result-row"]')!).getByText('+4 min'),
		).toBeInTheDocument();
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

it('preserves mode filtering relative to stop deduplication', async () => {
	stopData = [
		{ id: 'rail-first', code: 'r', name: 'Station Central', lat: 0, lon: 0, mode: 'rail' },
		{ id: 'metro-second', code: 'm', name: 'Station Central', lat: 0, lon: 0, mode: 'metro' },
	];
	setUrlQuery('q=central');
	const view = render(SearchSurface);
	expect(view.getByRole('link', { name: /Station Central/ })).toHaveAttribute(
		'href',
		'/stop/rail-first',
	);
	await view.getByRole('button', { name: 'Métro' }).click();
	expect(view.queryByRole('region', { name: 'Stops' })).toBeNull();
	expect(view.getByText('No results')).toBeInTheDocument();
});

it.each(['en', 'fr'] as const)('keeps header caps and full page counts in %s', (locale) => {
	localeState.locale = locale;
	routeData = Array.from({ length: 51 }, (_, i) => ({
		id: String(i),
		short: String(i),
		long: 'Hub',
		type: 3,
	}));
	stopData = Array.from({ length: 51 }, (_, i) => ({
		id: String(i),
		code: String(i),
		name: 'Hub',
		lat: 0,
		lon: 0,
	}));
	setUrlQuery('q=hub');
	const view = render(SearchSurface);
	for (const name of locale === 'en' ? ['Lines', 'Stops'] : ['Lignes', 'Arrêts']) {
		const group = within(view.getByRole('region', { name }));
		expect(group.getAllByRole('link')).toHaveLength(50);
		expect(group.getByText(locale === 'en' ? '51 results' : '51 résultats')).toBeInTheDocument();
		expect(group.getByText(locale === 'en' ? '+1 more' : '+1 de plus')).toBeInTheDocument();
	}
});

it.each(['CRÉMAZIE', 'cremazie', 'Berri-UQAM', 'uqam berri'])(
	'matches accents and punctuation without changing labels: %s',
	(q) => {
		stopData = [{ id: 'c', code: 'c', name: 'Station Crémazie', lat: 0, lon: 0 }, STOPS[1]];
		setUrlQuery('q=' + encodeURIComponent(q));
		const view = render(SearchSurface);
		expect(view.getByRole('link', { name: /Station/ })).toHaveTextContent(
			q.toLowerCase().includes('mazie') ? 'Station Crémazie' : 'Station Berri-UQAM',
		);
	},
);

it.each(['en', 'fr'] as const)(
	'distinguishes blank, punctuation-only and unmatched queries in both locales: %s',
	async (locale) => {
		localeState.locale = locale;
		for (const q of ['', '   ', '---', 'zzzz']) {
			setUrlQuery('q=' + encodeURIComponent(q));
			const view = render(SearchSurface);
			expect(view.queryAllByRole('region')).toHaveLength(0);
			if (q === 'zzzz')
				expect(
					view.getByText(locale === 'en' ? 'No results' : 'Aucun résultat'),
				).toBeInTheDocument();
			else {
				expect(view.getByRole('note')).toHaveTextContent(
					locale === 'en'
						? 'Search a line, stop or bus'
						: 'Rechercher une ligne, un arrêt ou un bus',
				);
				expect(
					view.getByRole('button', { name: locale === 'en' ? 'Line number' : 'Numéro de ligne' }),
				).toBeInTheDocument();
				expect(view.container.querySelector('[data-slot="freshness-stamp"]')).toBeNull();
			}
			view.unmount();
		}
		setUrlQuery('q=van horne');
		const view = render(SearchSurface);
		await view.getByRole('button', { name: 'Métro' }).click();
		expect(view.getByText(locale === 'en' ? 'No results' : 'Aucun résultat')).toBeInTheDocument();
	},
);

it('keeps stop codes, cross-street order and existing stop representatives', () => {
	stopData = [
		{ id: 'first', code: '100', name: 'Park / Road', lat: 0, lon: 0 },
		{ id: 'same-code', code: '100', name: 'Park / Road', lat: 0, lon: 0 },
		{ id: 'other', code: '200', name: 'Park / Road', lat: 0, lon: 0 },
		{ id: 'station-first', code: '300', name: 'Station Central', lat: 0, lon: 0 },
		{ id: 'station-second', code: '400', name: 'Station Central', lat: 0, lon: 0 },
	];
	for (const [q, hrefs] of [
		['100', ['/stop/first']],
		['road park', ['/stop/first', '/stop/other']],
		['central', ['/stop/station-first']],
	] as const) {
		setUrlQuery('q=' + q);
		const view = render(SearchSurface);
		expect(
			within(view.getByRole('region', { name: 'Stops' }))
				.getAllByRole('link')
				.map((r) => r.getAttribute('href')),
		).toEqual(hrefs);
		view.unmount();
	}
});
