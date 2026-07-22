import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StopsIndex from './StopsIndex.svelte';

// ── /v1 ports ────────────────────────────────────────────────────────────────
// getStop* index shapes are injected via the createResource mock below; getRoute
// and getStopReliability are spied here so the by-line + badge paths can assert
// the LOSSLESS route fetch and the honest 404 probe.
const getStopsIndex = vi.fn();
const getRoutesIndex = vi.fn();
const getRoute = vi.fn();
const getStopReliability = vi.fn();
let viewportRequestsEnabled = true;
const historyCalls = vi.hoisted(() => ({
	getStopHistoryDirectory: vi.fn(),
	getStopHistoryIndex: vi.fn(),
	loadStopHistoryRange: vi.fn(),
}));

// The SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the ?route
// seed AND the round-trip mirror are testable. vi.hoisted runs above the mock
// factories so `mockUrl`/`replaceState` are live before they are referenced.
const state = vi.hoisted(() => ({ url: new URL('http://localhost/stops') }));
const replaceState = vi.hoisted(() =>
	vi.fn((u: string | URL) => {
		state.url = new URL(u, 'http://localhost');
	}),
);
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return state.url;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState }));

function setUrl(path: string): void {
	state.url = new URL(path, 'http://localhost');
}

vi.mock('$lib/v1/repositories/static', () => ({
	getStopsIndex: (...args: unknown[]) => getStopsIndex(...args),
	getRoutesIndex: (...args: unknown[]) => getRoutesIndex(...args),
	getRoute: (...args: unknown[]) => getRoute(...args),
}));
vi.mock('$lib/v1/reliabilitySnapshot.svelte', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	function reliabilityVerdict(pct: number): string {
		return pct >= 80 ? 'on_time' : pct >= 60 ? 'late' : 'severe';
	}
	function createReliabilityLoader() {
		// A reactive cache so a row's `reliability.get(id)` read re-runs when the
		// async probe resolves (mirrors the real loader's SvelteMap).
		const cache = new SvelteMap<
			string,
			{ phase: string; otpPct: number | null; verdict: string | null; series: number[] }
		>();
		const started = new Set<string>();
		const EMPTY = { phase: 'idle', otpPct: null, verdict: null, series: [] as number[] };
		function request(id: string): void {
			if (!id || started.has(id)) return;
			started.add(id);
			void Promise.resolve(getStopReliability(id))
				.then((file: { periods?: Array<{ grain: string; otp_pct: number | null }> } | null) => {
					const day = file?.periods?.filter((p) => p.grain === 'day') ?? [];
					const otp = [...day].reverse().find((p) => p.otp_pct != null)?.otp_pct ?? null;
					cache.set(
						id,
						otp == null
							? { phase: 'empty', otpPct: null, verdict: null, series: [] }
							: { phase: 'ready', otpPct: otp, verdict: reliabilityVerdict(otp), series: [otp] },
					);
				})
				.catch(() => cache.set(id, { phase: 'empty', otpPct: null, verdict: null, series: [] }));
		}
		return {
			get: (id: string) => cache.get(id) ?? EMPTY,
			request,
			reliability: (_node: Element, id: string) => {
				if (viewportRequestsEnabled) request(id);
				return { destroy() {} };
			},
			inFlight: 0,
		};
	}
	return { createReliabilityLoader };
});
vi.mock('$lib/v1/repositories/historic', () => historyCalls);

// A minimal reactive createResource stub: it invokes the fetcher once and exposes
// its resolved value. Keyed by which /v1 fn the fetcher calls, so the stops index,
// routes index and per-route fetch each resolve to their own fixture.
const STOPS = {
	generated_utc: '2026-06-16T02:00:00Z',
	stops: [
		{
			id: '57191',
			name: 'Van Horne / Rockland',
			lat: 45.5,
			lon: -73.6,
			code: '57191',
			mode: 'bus',
			routes: ['161'],
		},
		{
			id: '11000',
			name: 'Station Crémazie',
			lat: 45.55,
			lon: -73.62,
			code: '11000',
			mode: 'metro',
			routes: ['2'],
		},
		{
			id: '22000',
			name: 'Papineau / Rachel',
			lat: 45.53,
			lon: -73.57,
			code: '22000',
			mode: 'bus',
			routes: ['29'],
		},
	],
};
const ROUTES = {
	generated_utc: '2026-06-16T02:00:00Z',
	routes: [
		{ id: '80', short: '80', long: 'Avenue du Parc', type: 3 },
		{ id: '11', short: '11', long: 'Mont-Royal', type: 3 },
	],
};

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (fetcher: () => Promise<unknown>) => {
		const state = $state<{ data: unknown; error: unknown; loading: boolean; settled: boolean }>({
			data: null,
			error: null,
			loading: true,
			settled: false,
		});
		let sequence = 0;
		$effect(() => {
			const token = ++sequence;
			let active = true;
			state.loading = true;
			state.error = null;
			void Promise.resolve(fetcher())
				.then((d) => {
					if (active && token === sequence) state.data = d;
				})
				.catch((error) => {
					if (active && token === sequence) state.error = error;
				})
				.finally(() => {
					if (!active || token !== sequence) return;
					state.loading = false;
					state.settled = true;
				});
			return () => {
				active = false;
			};
		});
		return {
			get data() {
				return state.data;
			},
			get error() {
				return state.error;
			},
			get loading() {
				return state.loading;
			},
			get settled() {
				return state.settled;
			},
			reload: vi.fn(),
		};
	},
}));

beforeEach(() => {
	viewportRequestsEnabled = true;
	getStopsIndex.mockResolvedValue(STOPS);
	getRoutesIndex.mockResolvedValue(ROUTES);
	// Default: no stop has published reliability (404 → null → no badge, honest).
	getStopReliability.mockResolvedValue(null);
	getRoute.mockResolvedValue(null);
	setUrl('/stops');
	replaceState.mockClear();
	historyCalls.getStopHistoryDirectory.mockClear();
	historyCalls.getStopHistoryIndex.mockClear();
	historyCalls.loadStopHistoryRange.mockClear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('StopsIndex retained-history boundary', () => {
	it('stays current and never fans out retained discovery or partitions across the listing', async () => {
		render(StopsIndex);
		await screen.findByRole('combobox', { name: 'Filter by line' });

		expect(historyCalls.getStopHistoryDirectory).not.toHaveBeenCalled();
		expect(historyCalls.getStopHistoryIndex).not.toHaveBeenCalled();
		expect(historyCalls.loadStopHistoryRange).not.toHaveBeenCalled();
	});
});

describe('StopsIndex blueprint listing header', () => {
	it('renders one local SVG hero and ten named straight detail sheets', async () => {
		const { container } = render(StopsIndex);
		await screen.findByRole('combobox', { name: 'Filter by line' });

		const header = container.querySelector('[data-slot="blueprint-listing-header"]');
		expect(header).not.toBeNull();
		if (!header) return;

		const drawings = [...header.querySelectorAll<SVGElement>('[data-blueprint-part]')];
		expect(drawings.map((drawing) => drawing.dataset.blueprintPart)).toEqual([
			'stops-plan',
			'stops-glass-shelter',
			'stops-simple-shelter',
			'stops-post',
			'stops-station-section',
			'stops-bus',
			'stops-signal',
			'stops-metro-platform-circulation-plan',
			'stops-heated-glass-shelter-section',
			'stops-accessible-bus-curb-section',
			'stops-passenger-information-equipment',
		]);
		expect(header.querySelectorAll('[data-blueprint-layer="hero"]')).toHaveLength(1);
		expect(header.querySelectorAll('.edge-detail')).toHaveLength(10);
		expect(drawings.every((drawing) => drawing.tagName.toLowerCase() === 'svg')).toBe(true);
		expect(header.querySelector('picture, img, canvas, image')).toBeNull();
		expect(header.querySelector('[href^="http"], [href^="//"]')).toBeNull();
		expect(header.querySelector('[transform]')).toBeNull();
		for (const element of header.querySelectorAll<HTMLElement>('[style]')) {
			expect(element.getAttribute('style')).not.toMatch(/(?:transform|rotate|skew)/i);
		}
	});

	it('places controls and result data after the shared header separator', async () => {
		const { container } = render(StopsIndex);
		await screen.findByRole('combobox', { name: 'Filter by line' });

		const header = container.querySelector('[data-slot="blueprint-listing-header"]');
		expect(header).not.toBeNull();
		if (!header) return;

		expect(header.querySelectorAll('h1')).toHaveLength(1);
		expect(header.querySelector('.blueprint-bg')).toHaveAttribute('aria-hidden', 'true');
		expect(container.querySelector('[data-slot="listing-edge-title"]')).toHaveTextContent('Stops.');
		const separator = container.querySelector('[data-testid="listing-page-separator"]');
		const search = container.querySelector<HTMLElement>('[data-slot="listing-search-field"]');
		const controls = container.querySelector<HTMLElement>('[data-slot="listing-filter-panel"]');
		const stats = header.querySelector('[data-slot="listing-header-stats"]');
		const data = container.querySelector('[data-slot="entity-list"]');
		expect(separator).not.toBeNull();
		expect(search).not.toBeNull();
		expect(controls).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="listing-filter-column"]')).toContainElement(search);
		expect(container.querySelector('[data-slot="listing-filter-column"]')).toContainElement(
			controls,
		);
		expect(container.querySelectorAll('[data-slot="listing-filter-section"]')).toHaveLength(2);
		expect(stats).toHaveAccessibleName('Network inventory');
		expect(
			[...stats!.querySelectorAll('[data-slot="listing-header-stat"]')].map((stat) => [
				stat.querySelector('dt')?.textContent,
				stat.querySelector('dd')?.textContent?.trim(),
			]),
		).toEqual([
			['Stops', '3'],
			['Bus', '2'],
			['Metro', '1'],
			['Lines', '2'],
		]);
		expect(data).not.toBeNull();
		expect(separator?.compareDocumentPosition(search as Node) ?? 0).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(separator?.compareDocumentPosition(data as Node) ?? 0).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
	});

	it('shows unknown mode inventory as a dash when the snapshot lacks complete mode coverage', async () => {
		const stop = STOPS.stops[0] as unknown as { mode: string | undefined };
		const originalMode = stop.mode;
		stop.mode = undefined;
		try {
			const { container } = render(StopsIndex);
			await screen.findByRole('combobox', { name: 'Filter by line' });
			const statValue = (label: string) =>
				[...container.querySelectorAll('[data-slot="listing-header-stat"]')]
					.find((stat) => stat.querySelector('dt')?.textContent === label)
					?.querySelector('dd');

			expect(statValue('Bus')).toHaveTextContent('—');
			expect(statValue('Metro')).toHaveTextContent('—');
		} finally {
			stop.mode = originalMode;
		}
	});
});

describe('StopsIndex listing system', () => {
	it('gates the route-driven catalogue on the routes index error boundary', async () => {
		getRoutesIndex.mockRejectedValue(new Error('routes unavailable'));
		const { container } = render(StopsIndex);

		await waitFor(() =>
			expect(
				container.querySelector('[data-slot="edge-state"][data-variant="error-v1"]'),
			).not.toBeNull(),
		);
		expect(screen.queryByRole('heading', { name: 'Browse stops by line' })).not.toBeInTheDocument();
	});

	it('keeps inventory in the header and makes per-line cards the entire idle body', async () => {
		const { container } = render(StopsIndex);
		await screen.findByRole('combobox', { name: 'Filter by line' });

		expect(container.querySelector('[data-slot="listing-header-stats"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="listing-intro"]')).toBeNull();
		expect(container.querySelector('[data-slot="listing-overview-card"]')).toBeNull();
		expect(container.querySelector('[data-slot="stops-census"]')).toBeNull();
		expect(container.querySelector('.stops-browse-card')).toBeNull();
		const list = container.querySelector('[data-slot="entity-list"]');
		expect(list).toHaveClass('entity-list--cards', 'entity-list--grid');
		expect(list?.querySelectorAll(':scope > li > [data-slot="card"]')).toHaveLength(
			ROUTES.routes.length,
		);
		expect(screen.getByRole('button', { name: /line 80 Bus Avenue du Parc/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /line 11 Bus Mont-Royal/i })).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: /Browse stops on line 80 Bus Avenue du Parc/i }),
		).toBeInTheDocument();
	});

	it('identifies a street stop as Bus in the shared result row', async () => {
		const { container } = render(StopsIndex);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search stops' }), {
			target: { value: 'rockland' },
		});

		await screen.findByRole('link', { name: /Van Horne \/ Rockland/i });
		expect(
			container.querySelector('[data-slot="entity-result-row"] .entity-row-tag'),
		).toHaveTextContent('Bus');
		expect(container.querySelectorAll('[data-slot="entity-result-row"]')).toHaveLength(1);
	});

	it('provides a browsable line catalogue that selects the existing shareable route axis', async () => {
		getRoute.mockResolvedValue({
			generated_utc: '2026-06-16T02:00:00Z',
			id: '80',
			directions: [{ dir: 0, headsign: 'South', stops: [{ id: '22000', seq: 1 }] }],
		});
		render(StopsIndex);

		expect(
			await screen.findByRole('heading', { name: 'Browse stops by line' }),
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /line 80 Bus Avenue du Parc/i }));
		await waitFor(() => {
			const last = replaceState.mock.calls.at(-1)?.[0] as URL | undefined;
			expect(last?.searchParams.get('route')).toBe('80');
		});
	});

	it('shows the shared loading scaffold instead of a false empty state while a picked line loads', async () => {
		let resolveRoute!: (value: {
			generated_utc: string;
			id: string;
			directions: Array<{
				dir: number;
				headsign: string;
				stops: Array<{ id: string; seq: number }>;
			}>;
		}) => void;
		getRoute.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveRoute = resolve;
				}),
		);
		const { container } = render(StopsIndex);

		expect(
			await screen.findByRole('heading', { name: 'Browse stops by line' }),
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /line 80 Bus Avenue du Parc/i }));
		await waitFor(() => expect(getRoute).toHaveBeenCalledWith('80'));

		expect(screen.queryByText('No published stop list for this line.')).not.toBeInTheDocument();
		expect(
			container.querySelector('[data-slot="edge-state"][data-variant="skeleton"]'),
		).not.toBeNull();

		resolveRoute({
			generated_utc: '2026-06-16T02:00:00Z',
			id: '80',
			directions: [{ dir: 0, headsign: 'South', stops: [{ id: '22000', seq: 1 }] }],
		});
		expect(await screen.findByRole('heading', { name: 'Direction 0 · South' })).toBeInTheDocument();
	});

	it('reveals a selected line stop catalogue in accessible batches of 50', async () => {
		const routeStops = Array.from({ length: 120 }, (_, i) => ({
			id: `route-stop-${i}`,
			name: `Route stop ${i + 1}`,
			seq: i + 1,
		}));
		getRoute.mockResolvedValue({
			generated_utc: '2026-06-16T02:00:00Z',
			id: '80',
			directions: [
				{ dir: 0, headsign: 'South', stops: routeStops.slice(0, 60) },
				{ dir: 1, headsign: 'North', stops: routeStops.slice(60) },
			],
		});
		setUrl('/stops?route=80');
		const { container } = render(StopsIndex);

		await waitFor(() => expect(getRoute).toHaveBeenCalledWith('80'));
		await waitFor(() =>
			expect(container.querySelectorAll('[data-slot="entity-result-row"]')).toHaveLength(50),
		);
		expect(screen.getByRole('heading', { name: 'Direction 0 · South' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Direction 1 · North' })).toBeInTheDocument();
		expect(screen.getByRole('status', { name: 'Stop catalogue progress' })).toHaveTextContent(
			'Showing 50 of 120 stops',
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Load 50 more stops' }));
		expect(container.querySelectorAll('[data-slot="entity-result-row"]')).toHaveLength(100);
		await fireEvent.click(screen.getByRole('button', { name: 'Load 20 more stops' }));
		expect(container.querySelectorAll('[data-slot="entity-result-row"]')).toHaveLength(120);
		expect(screen.queryByRole('button', { name: /more stops/ })).not.toBeInTheDocument();
	});
});

describe('StopsIndex — find by typing', () => {
	it('keeps the stop detail link and adds a separate filtered-map link', async () => {
		render(StopsIndex);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search stops' }), {
			target: { value: 'rockland' },
		});
		expect(await screen.findByRole('link', { name: /Van Horne \/ Rockland/i })).toHaveAttribute(
			'href',
			'/stop/57191',
		);
		expect(screen.getByRole('link', { name: 'View stop 57191 on map' })).toHaveAttribute(
			'href',
			'/map?stop=57191&focus=stop%3A57191',
		);
		const list = document.querySelector('[data-slot="entity-list"]');
		expect(list).toHaveClass('entity-list--cards');
		expect(list?.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
	});

	it('finds an accented station typed without accents and tags it as métro', async () => {
		const { container } = render(StopsIndex);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search stops' }), {
			target: { value: 'cremazie' },
		});
		expect(await screen.findByRole('link', { name: /Station Crémazie/i })).toHaveAttribute(
			'href',
			'/stop/11000',
		);
		expect(
			container.querySelector('[data-slot="entity-result-row"] .entity-row-tag'),
		).toHaveTextContent('Métro');
	});
});

describe('StopsIndex — reliability badges (honest probe)', () => {
	it('shows NO badge for a stop whose history 404s (never a fabricated 0%)', async () => {
		render(StopsIndex);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search stops' }), {
			target: { value: 'rockland' },
		});
		await screen.findByRole('link', { name: /Van Horne \/ Rockland/i });
		// The loader probed the stop id, the fetch fail-softed, and no badge rendered.
		await waitFor(() => expect(getStopReliability).toHaveBeenCalledWith('57191'));
		expect(document.querySelector('[data-slot="reliability-badge"]')).toBeNull();
	});

	it('paints a badge only for a stop with published history', async () => {
		getStopReliability.mockImplementation((id: string) =>
			id === '57191'
				? Promise.resolve({
						generated_utc: '2026-06-16T02:00:00Z',
						id: '57191',
						periods: [{ grain: 'day', otp_pct: 82 }],
					})
				: Promise.resolve(null),
		);
		render(StopsIndex);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search stops' }), {
			target: { value: 'rockland' },
		});
		await screen.findByRole('link', { name: /Van Horne \/ Rockland/i });
		await waitFor(() =>
			expect(document.querySelector('[data-slot="reliability-badge"]')).not.toBeNull(),
		);
	});

	it('requests every eligible stop and freezes source order until one terminal ranking can commit', async () => {
		viewportRequestsEnabled = false;
		const gates = new Map<
			string,
			{
				promise: Promise<{
					generated_utc: string;
					id: string;
					periods: Array<{ grain: string; otp_pct: number }>;
				}>;
				resolve: (value: {
					generated_utc: string;
					id: string;
					periods: Array<{ grain: string; otp_pct: number }>;
				}) => void;
			}
		>();
		getStopReliability.mockImplementation((id: string) => {
			let resolve!: (value: {
				generated_utc: string;
				id: string;
				periods: Array<{ grain: string; otp_pct: number }>;
			}) => void;
			const promise = new Promise<{
				generated_utc: string;
				id: string;
				periods: Array<{ grain: string; otp_pct: number }>;
			}>((done) => {
				resolve = done;
			});
			gates.set(id, { promise, resolve });
			return promise;
		});
		getRoute.mockResolvedValue({
			generated_utc: '2026-06-16T02:00:00Z',
			id: '80',
			directions: [
				{
					dir: 0,
					headsign: 'South',
					stops: [
						{ id: '57191', seq: 1 },
						{ id: '11000', seq: 2 },
						{ id: '22000', seq: 3 },
					],
				},
			],
		});
		setUrl('/stops?route=80');
		render(StopsIndex);
		await screen.findByRole('heading', { name: 'Direction 0 · South' });
		const stopOrder = () =>
			screen
				.getAllByRole('listitem')
				.map((row) => within(row).getAllByRole('link')[0].getAttribute('href'));

		await screen.getByTestId('stops-sort-worst').click();
		await waitFor(() => expect(getStopReliability).toHaveBeenCalledTimes(3));
		expect(new Set(getStopReliability.mock.calls.map(([id]) => id))).toEqual(
			new Set(['57191', '11000', '22000']),
		);
		expect(stopOrder()).toEqual(['/stop/57191', '/stop/11000', '/stop/22000']);
		expect(screen.getByTestId('stops-ranking-status')).toHaveTextContent(
			'Calculating reliability ranking for the filtered stops…',
		);

		const resolve = (id: string, otp: number) =>
			gates.get(id)?.resolve({
				generated_utc: '2026-06-16T02:00:00Z',
				id,
				periods: [{ grain: 'day', otp_pct: otp }],
			});
		resolve('11000', 50);
		await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());
		// One severe answer cannot reorder a partially measured list.
		expect(stopOrder()).toEqual(['/stop/57191', '/stop/11000', '/stop/22000']);

		resolve('57191', 90);
		resolve('22000', 70);
		await waitFor(() => expect(stopOrder()).toEqual(['/stop/11000', '/stop/22000', '/stop/57191']));
		expect(screen.getByTestId('stops-ranking-status')).toHaveTextContent('');
	});
});

describe('StopsIndex — find by line', () => {
	it('seeds the line from ?route= and lists that line’s LOSSLESS stop list, direction-grouped', async () => {
		// A stop served by >5 routes (dropped from the 5-capped stops_index reverse
		// index) is still listed because we fetch the route file directly.
		getRoute.mockResolvedValue({
			generated_utc: '2026-06-16T02:00:00Z',
			id: '80',
			directions: [
				{
					dir: 0,
					stops: [
						{ id: '22000', seq: 1 },
						{ id: '57191', seq: 2 },
					],
				},
				{ dir: 1, stops: [{ id: '11000', seq: 1 }] },
			],
		});
		setUrl('/stops?route=80');
		render(StopsIndex);

		// The route file was fetched (lossless source, not the reverse index).
		await waitFor(() => expect(getRoute).toHaveBeenCalledWith('80'));
		// Both directions render their stops in sequence order.
		expect(await screen.findByText(/Stops on line 80/i)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Papineau \/ Rachel/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Van Horne \/ Rockland/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Station Crémazie/i })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Direction 0' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Direction 1' })).toBeInTheDocument();
	});

	it('shows an honest empty state when the line has no published stop list (getRoute 404)', async () => {
		getRoute.mockResolvedValue(null);
		setUrl('/stops?route=80');
		render(StopsIndex);
		await waitFor(() => expect(getRoute).toHaveBeenCalledWith('80'));
		const message = await screen.findByText('No published stop list for this line.');
		expect(message).toBeInTheDocument();
		expect(message.closest('[data-component="state-notice"]')).toHaveAttribute(
			'data-presentation',
			'silo',
		);
	});

	it('exposes an accessible combobox (a11y AA) with the line-filter label', async () => {
		const { container } = render(StopsIndex);
		// bits-ui Combobox.Input carries role=combobox + our aria-label — the
		// screen-reader entry point for find-by-line.
		expect(await screen.findByRole('combobox', { name: 'Filter by line' })).toBeInTheDocument();
		expect(container.querySelector('.stops-line-filter [data-slot="combobox"]')).not.toBeNull();
	});

	it('mirrors the picked line to ?route= (codec-owned, shareable) and drops it when cleared', async () => {
		setUrl('/stops?route=80');
		getRoute.mockResolvedValue({
			generated_utc: '2026-06-16T02:00:00Z',
			id: '80',
			directions: [{ dir: 0, stops: [{ id: '22000', seq: 1 }] }],
		});
		render(StopsIndex);
		// Seeded from ?route=80 — the clear affordance is present.
		const clear = await screen.findByRole('button', { name: 'Clear line filter' });
		await fireEvent.click(clear);
		// Clearing mirrors `route: null`, dropping the key for a clean canonical URL.
		await waitFor(() => {
			const last = replaceState.mock.calls.at(-1)?.[0] as URL | undefined;
			expect(last?.searchParams.has('route')).toBe(false);
		});
	});
});
