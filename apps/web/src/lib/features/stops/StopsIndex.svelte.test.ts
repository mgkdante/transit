import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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

// Mock ONLY the $lib/v1 surface the component touches (avoid importActual — the
// real barrel pulls config that reads import.meta.env, which is absent in this
// env). We ship a faithful-enough createReliabilityLoader('stop') that fetches
// through getStopReliability so the honest-probe + badge paths are exercised.
vi.mock('$lib/v1', async () => {
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
				request(id);
				return { destroy() {} };
			},
			inFlight: 0,
		};
	}
	return {
		getStopsIndex: (...a: unknown[]) => getStopsIndex(...a),
		getRoutesIndex: (...a: unknown[]) => getRoutesIndex(...a),
		getRoute: (...a: unknown[]) => getRoute(...a),
		createReliabilityLoader,
		...historyCalls,
	};
});

// A minimal reactive createResource stub: it invokes the fetcher once and exposes
// its resolved value. Keyed by which /v1 fn the fetcher calls, so the stops index,
// routes index and per-route fetch each resolve to their own fixture.
const STOPS = {
	generated_utc: '2026-06-16T02:00:00Z',
	stops: [
		{ id: '57191', name: 'Van Horne / Rockland', lat: 45.5, lon: -73.6, code: '57191' },
		{ id: '11000', name: 'Station Crémazie', lat: 45.55, lon: -73.62, code: '11000' },
		{ id: '22000', name: 'Papineau / Rachel', lat: 45.53, lon: -73.57, code: '22000' },
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
		void Promise.resolve(fetcher())
			.then((d) => {
				state.data = d;
			})
			.finally(() => {
				state.loading = false;
				state.settled = true;
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

describe('StopsIndex — find by typing', () => {
	it('keeps the stop detail link and adds a separate filtered-map link', async () => {
		render(StopsIndex);
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search stops' }), {
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
	});

	it('finds an accented station typed without accents and tags it as métro', async () => {
		render(StopsIndex);
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search stops' }), {
			target: { value: 'cremazie' },
		});
		expect(await screen.findByRole('link', { name: /Station Crémazie/i })).toHaveAttribute(
			'href',
			'/stop/11000',
		);
		expect(screen.getByText('Métro')).toBeInTheDocument();
	});
});

describe('StopsIndex — reliability badges (honest probe)', () => {
	it('shows NO badge for a stop whose history 404s (never a fabricated 0%)', async () => {
		render(StopsIndex);
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search stops' }), {
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
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search stops' }), {
			target: { value: 'rockland' },
		});
		await screen.findByRole('link', { name: /Van Horne \/ Rockland/i });
		await waitFor(() =>
			expect(document.querySelector('[data-slot="reliability-badge"]')).not.toBeNull(),
		);
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
		expect(await screen.findByText('No published stop list for this line.')).toBeInTheDocument();
	});

	it('exposes an accessible combobox (a11y AA) with the line-filter label', async () => {
		render(StopsIndex);
		// bits-ui Combobox.Input carries role=combobox + our aria-label — the
		// screen-reader entry point for find-by-line.
		expect(await screen.findByRole('combobox', { name: 'Filter by line' })).toBeInTheDocument();
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
