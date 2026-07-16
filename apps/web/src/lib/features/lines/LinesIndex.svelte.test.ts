import { render, screen, waitFor, within } from '@testing-library/svelte';
import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
import LinesIndex from './LinesIndex.svelte';

// A controllable per-id reliability map the mocked loader reads. Tests seed it
// before render so the badge / sort / filter behaviour is deterministic (no real
// fetch, no viewport gating).
const snapshots = new SvelteMap<string, ReliabilitySnapshot>();
const requested: string[] = [];
let viewportRequestsEnabled = true;
const historyCalls = vi.hoisted(() => ({
	getLineHistoryDirectory: vi.fn(),
	getLineHistoryIndex: vi.fn(),
	loadLineHistoryRange: vi.fn(),
}));

function snap(partial: Partial<ReliabilitySnapshot>): ReliabilitySnapshot {
	return { phase: 'idle', otpPct: null, verdict: null, series: [], ...partial };
}

const ROUTES = [
	{ id: '24', short: '24', long: 'Sherbrooke', type: 3 },
	{ id: '161', short: '161', long: 'Van Horne', type: 3 },
	{ id: '99', short: '99', long: 'Villeray', type: 3 },
];

// Mock the WHOLE $lib/v1 barrel (importing the real one pulls config that reads
// import.meta.env, absent in the node-less test env). Provide just what
// LinesIndex consumes: the routes loader, the lazy reliability loader, and the
// trivial problem-verdict predicate.
vi.mock('$lib/v1', () => ({
	getRoutesIndex: vi.fn(),
	isProblemVerdict: (v: string | null) => v === 'late' || v === 'severe',
	createReliabilityLoader: () => {
		const record = (target: string | { id: string; known?: boolean }) => {
			const id = typeof target === 'string' ? target : target.id;
			if (!requested.includes(id)) requested.push(id);
		};
		return {
			get: (id: string) => snapshots.get(id) ?? snap({}),
			request: record,
			// The action immediately registers interest (no real IntersectionObserver).
			// The row now passes { id, known } — record just the id (matches prod, which
			// dedupes on id), so the lazy-request assertions still read plain ids.
			reliability: (_node: Element, target: string | { id: string; known?: boolean }) => {
				if (viewportRequestsEnabled) record(target);
				return { destroy() {} };
			},
			get inFlight() {
				return 0;
			},
		};
	},
	...historyCalls,
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: { generated_utc: '2026-06-16T02:00:00Z', routes: ROUTES },
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

function reset() {
	snapshots.clear();
	requested.length = 0;
	viewportRequestsEnabled = true;
	historyCalls.getLineHistoryDirectory.mockClear();
	historyCalls.getLineHistoryIndex.mockClear();
	historyCalls.loadLineHistoryRange.mockClear();
}

describe('LinesIndex retained-history boundary', () => {
	it('stays current and never fans out history discovery or partitions across the listing', () => {
		reset();
		render(LinesIndex);

		expect(historyCalls.getLineHistoryDirectory).not.toHaveBeenCalled();
		expect(historyCalls.getLineHistoryIndex).not.toHaveBeenCalled();
		expect(historyCalls.loadLineHistoryRange).not.toHaveBeenCalled();
		expect(new Set(requested)).toEqual(new Set(['24', '161', '99']));
	});
});

describe('LinesIndex blueprint listing header', () => {
	it('renders one local SVG hero and ten named straight detail sheets', () => {
		reset();
		const { container } = render(LinesIndex);

		const header = container.querySelector('[data-slot="blueprint-listing-header"]');
		expect(header).not.toBeNull();
		if (!header) return;

		const drawings = [...header.querySelectorAll<SVGElement>('[data-blueprint-part]')];
		expect(drawings.map((drawing) => drawing.dataset.blueprintPart)).toEqual([
			'lines-bridge',
			'lines-track-plan',
			'lines-catenary',
			'lines-metro-car',
			'lines-bus',
			'lines-bogie',
			'lines-signal',
			'lines-turnout-crossover-plan',
			'lines-rail-sleeper-gauge-power-section',
			'lines-pantograph-overhead-equipment',
			'lines-signalling-communications-equipment',
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

	it('places controls and result data after the shared header separator', () => {
		reset();
		const { container } = render(LinesIndex);

		const header = container.querySelector('[data-slot="blueprint-listing-header"]');
		expect(header).not.toBeNull();
		if (!header) return;

		expect(header.querySelectorAll('h1')).toHaveLength(1);
		expect(header.querySelector('.blueprint-bg')).toHaveAttribute('aria-hidden', 'true');
		expect(container.querySelector('[data-slot="listing-edge-title"]')).toHaveTextContent('Lines.');
		const separator = container.querySelector('[data-testid="listing-page-separator"]');
		const search = container.querySelector<HTMLElement>('[data-slot="listing-search-field"]');
		const controls = container.querySelector<HTMLElement>('[data-slot="listing-filter-panel"]');
		const stats = header.querySelector('[data-slot="listing-header-stats"]');
		const data = container.querySelector('[data-slot="entity-list"]');
		expect(separator).not.toBeNull();
		expect(search).not.toBeNull();
		expect(controls).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="controls-rail"]')).toBeNull();
		expect(container.querySelectorAll('[data-slot="listing-filter-section"]')).toHaveLength(3);
		expect(container.querySelector('[data-slot="listing-filter-column"]')).toContainElement(search);
		expect(container.querySelector('[data-slot="listing-filter-column"]')).toContainElement(
			controls,
		);
		expect(stats).toHaveAccessibleName('Network inventory');
		expect(
			[...stats!.querySelectorAll('[data-slot="listing-header-stat"]')].map((stat) => [
				stat.querySelector('dt')?.textContent,
				stat.querySelector('dd')?.textContent?.trim(),
			]),
		).toEqual([
			['Lines', '3'],
			['Bus', '3'],
			['Metro', '0'],
			['Modes', '1'],
		]);
		expect(data).not.toBeNull();
		expect(separator?.compareDocumentPosition(search as Node) ?? 0).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(separator?.compareDocumentPosition(data as Node) ?? 0).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		const list = container.querySelector('[data-slot="entity-list"]');
		expect(list).toHaveClass('entity-list--cards');
		expect(list?.querySelectorAll('[data-slot="card"]')).toHaveLength(ROUTES.length);
	});
});

describe('LinesIndex listing system', () => {
	it('keeps inventory in the header and makes the catalogue the entire body', () => {
		reset();
		const { container } = render(LinesIndex);

		expect(container.querySelector('[data-slot="listing-header-stats"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="listing-intro"]')).toBeNull();
		expect(container.querySelector('[data-slot="listing-overview-card"]')).toBeNull();
		expect(container.querySelector('.lines-verdict')).toBeNull();
		expect(container.querySelectorAll('[data-slot="entity-result-row"]')).toHaveLength(
			ROUTES.length,
		);
	});

	it('labels the published long name as a route name and sends riders to the detail for every direction', () => {
		reset();
		render(LinesIndex);

		expect(screen.getByText('Route name · Van Horne')).toBeInTheDocument();
		expect(
			screen.getByText('Open a line to see every published direction and destination together.'),
		).toBeInTheDocument();
		expect(screen.queryByText(/^Destination ·/)).not.toBeInTheDocument();
	});

	it('filters by the existing GTFS route type without changing the URL contract', async () => {
		reset();
		render(LinesIndex);

		await screen.getByTestId('lines-mode-bus').click();
		expect(screen.getAllByRole('link', { name: /(?:24|99|161)/ })).not.toHaveLength(0);
		expect(window.location.search).toBe('');
	});

	it('stands down an unknown GTFS route type instead of inventing a rider-facing mode', () => {
		reset();
		const originalType = ROUTES[2].type;
		ROUTES[2].type = 99;
		try {
			const { container } = render(LinesIndex);
			expect(screen.queryByText(/type-99/i)).not.toBeInTheDocument();
			expect(screen.getByRole('link', { name: /99.*Villeray/i })).toBeInTheDocument();
			const modesStat = [...container.querySelectorAll('[data-slot="listing-header-stat"]')].find(
				(stat) => stat.querySelector('dt')?.textContent === 'Modes',
			);
			expect(modesStat?.querySelector('dd')).toHaveTextContent('—');
		} finally {
			ROUTES[2].type = originalType;
		}
	});
});

describe('LinesIndex map drilldown', () => {
	it('keeps the route detail link and adds a separate filtered-map link', () => {
		reset();
		render(LinesIndex);

		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toHaveAttribute(
			'href',
			'/lines/161',
		);
		expect(screen.getByRole('link', { name: 'View route 161 on map' })).toHaveAttribute(
			'href',
			'/map?route=161&focus=route%3A161',
		);
	});
});

describe('LinesIndex reliability badge', () => {
	it('renders the OTP% badge for a route whose reliability has loaded', () => {
		reset();
		snapshots.set('161', snap({ phase: 'ready', otpPct: 82, verdict: 'late' }));
		render(LinesIndex);

		// The badge surfaces the OTP% inline on the row.
		expect(screen.getByText('82%')).toBeInTheDocument();
	});

	it('shows NO badge for a route still loading or with no data (honesty)', () => {
		reset();
		snapshots.set('161', snap({ phase: 'loading' }));
		snapshots.set('24', snap({ phase: 'empty' }));
		const { container } = render(LinesIndex);

		// No reliability badge node renders for loading / empty rows.
		expect(container.querySelector('[data-slot="reliability-badge"]')).toBeNull();
		// The name + glyph still render — the row degrades to today's bare link.
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();
	});

	it('requests reliability only for the rendered rows (lazy)', () => {
		reset();
		render(LinesIndex);
		// Every rendered row registered interest via the action — and only those ids.
		expect(new Set(requested)).toEqual(new Set(['24', '161', '99']));
	});
});

describe('LinesIndex worst-first sort', () => {
	it('reorders severe → late → on_time when sorting by least reliable', async () => {
		reset();
		snapshots.set('24', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		snapshots.set('161', snap({ phase: 'ready', otpPct: 55, verdict: 'severe' }));
		snapshots.set('99', snap({ phase: 'ready', otpPct: 80, verdict: 'late' }));
		render(LinesIndex);

		// Each row carries the detail link first, then the map drilldown — read the
		// first (the entity-row link) for the row's identity.
		const rowName = (li: HTMLElement) => within(li).getAllByRole('link')[0].textContent;

		// Default alphabetical order: 24, 99, 161.
		expect(rowName(screen.getAllByRole('listitem')[0])).toContain('24');

		// Flip to worst-first.
		await screen.getByTestId('lines-sort-worst').click();

		// 161 is severe → it leads worst-first.
		expect(rowName(screen.getAllByRole('listitem')[0])).toContain('161');
	});

	it('requests every filtered candidate and commits one ranking only after all are terminal', async () => {
		reset();
		viewportRequestsEnabled = false;
		render(LinesIndex);
		const lineOrder = () =>
			screen
				.getAllByRole('listitem')
				.map((row) => within(row).getAllByRole('link')[0].getAttribute('href'));

		await screen.getByTestId('lines-sort-worst').click();

		expect(new Set(requested)).toEqual(new Set(['24', '99', '161']));
		expect(lineOrder()).toEqual(['/lines/24', '/lines/99', '/lines/161']);
		expect(screen.getByRole('status')).toHaveTextContent(
			'Calculating reliability ranking for the filtered lines…',
		);

		snapshots.set('161', snap({ phase: 'ready', otpPct: 55, verdict: 'severe' }));
		await waitFor(() => expect(screen.getByText('55%')).toBeInTheDocument());
		// A partial answer never reshuffles the catalogue.
		expect(lineOrder()).toEqual(['/lines/24', '/lines/99', '/lines/161']);
		expect(screen.getByRole('status')).toHaveTextContent(
			'Calculating reliability ranking for the filtered lines…',
		);

		snapshots.set('24', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		snapshots.set('99', snap({ phase: 'ready', otpPct: 80, verdict: 'late' }));
		await waitFor(() => expect(lineOrder()).toEqual(['/lines/161', '/lines/99', '/lines/24']));
		expect(screen.getByRole('status')).toHaveTextContent('');
	});
});

describe('LinesIndex reliability status filter', () => {
	it('narrows to problem lines (late/severe) and hides the healthy ones', async () => {
		reset();
		snapshots.set('24', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		snapshots.set('161', snap({ phase: 'ready', otpPct: 55, verdict: 'severe' }));
		snapshots.set('99', snap({ phase: 'ready', otpPct: 80, verdict: 'late' }));
		render(LinesIndex);

		await screen.getByTestId('lines-status-problem').click();

		// The on-time line (24) drops; the late/severe lines remain.
		expect(screen.queryByRole('link', { name: /24.*Sherbrooke/i })).toBeNull();
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /99.*Villeray/i })).toBeInTheDocument();
	});

	it('keeps a row whose verdict has not loaded yet (never blanks the list on load)', async () => {
		reset();
		snapshots.set('24', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		// 161 + 99 still loading (verdict null) — they must stay under the problem filter.
		render(LinesIndex);

		await screen.getByTestId('lines-status-problem').click();

		expect(screen.queryByRole('link', { name: /24.*Sherbrooke/i })).toBeNull();
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();
	});

	it('announces a checking caption while any filtered verdict is idle or loading', async () => {
		reset();
		// All three rows still loading → the filtered list is non-empty but verdict-less.
		render(LinesIndex);

		const liveRegion = screen.getByRole('status');
		// Silent under the default "all" status (no premature announcement).
		expect(liveRegion).toHaveTextContent('');

		await screen.getByTestId('lines-status-problem').click();

		// Now the problem filter is on with no loaded verdict yet → the caption speaks.
		expect(liveRegion).toHaveTextContent('Checking reliability for the filtered lines…');
	});

	it('excludes terminal empty and healthy rows, and stops checking only when every candidate settles', async () => {
		reset();
		viewportRequestsEnabled = false;
		render(LinesIndex);

		await screen.getByTestId('lines-status-problem').click();
		expect(new Set(requested)).toEqual(new Set(['24', '99', '161']));
		expect(screen.getByRole('status')).toHaveTextContent(
			'Checking reliability for the filtered lines…',
		);

		snapshots.set('24', snap({ phase: 'empty' }));
		snapshots.set('99', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		await waitFor(() => {
			expect(screen.queryByRole('link', { name: /24.*Sherbrooke/i })).toBeNull();
			expect(screen.queryByRole('link', { name: /99.*Villeray/i })).toBeNull();
		});
		// The unresolved line is temporarily retained with honest checking copy.
		expect(screen.getByRole('link', { name: /161.*Van Horne/i })).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent(
			'Checking reliability for the filtered lines…',
		);

		snapshots.set('161', snap({ phase: 'empty' }));
		await waitFor(() => expect(screen.queryByRole('link', { name: /161.*Van Horne/i })).toBeNull());

		expect(screen.getByRole('status')).toHaveTextContent('');
	});
});
