import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
import LinesIndex from './LinesIndex.svelte';

// A controllable per-id reliability map the mocked loader reads. Tests seed it
// before render so the badge / sort / filter behaviour is deterministic (no real
// fetch, no viewport gating).
const snapshots = new Map<string, ReliabilitySnapshot>();
const requested: string[] = [];
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
	// The network verdict band (§C5.3): a null-network live store → the band stands down
	// to the honest "still measuring" empty. selectVerdict is stubbed to the absent shape.
	getV1Context: () => ({ manifest: { provider: 'demo', files: {} }, labels: {}, lang: 'en' }),
	createLiveStore: () => ({ network: null, start: () => {}, stop: () => {} }),
	selectVerdict: () => ({ status: 'absent', ban: null, sentence: 'Still measuring.' }),
	createReliabilityLoader: () => ({
		get: (id: string) => snapshots.get(id) ?? snap({}),
		request: (target: string | { id: string; known?: boolean }) =>
			requested.push(typeof target === 'string' ? target : target.id),
		// The action immediately registers interest (no real IntersectionObserver).
		// The row now passes { id, known } — record just the id (matches prod, which
		// dedupes on id), so the lazy-request assertions still read plain ids.
		reliability: (_node: Element, target: string | { id: string; known?: boolean }) => {
			requested.push(typeof target === 'string' ? target : target.id);
			return { destroy() {} };
		},
		get inFlight() {
			return 0;
		},
	}),
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

describe('LinesIndex map drilldown', () => {
	it('keeps the route detail link and adds a separate filtered-map link', () => {
		reset();
		render(LinesIndex);

		expect(screen.getByRole('link', { name: /161 Van Horne/i })).toHaveAttribute(
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
		expect(screen.getByRole('link', { name: /161 Van Horne/i })).toBeInTheDocument();
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
		const sortGroup = screen.getByRole('radiogroup', { name: 'Sort' });
		await within(sortGroup).getByRole('radio', { name: 'Least reliable' }).click();

		// 161 is severe → it leads worst-first.
		expect(rowName(screen.getAllByRole('listitem')[0])).toContain('161');
	});
});

describe('LinesIndex reliability status filter', () => {
	it('narrows to problem lines (late/severe) and hides the healthy ones', async () => {
		reset();
		snapshots.set('24', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		snapshots.set('161', snap({ phase: 'ready', otpPct: 55, verdict: 'severe' }));
		snapshots.set('99', snap({ phase: 'ready', otpPct: 80, verdict: 'late' }));
		render(LinesIndex);

		const statusGroup = screen.getByRole('radiogroup', { name: 'Reliability' });
		await within(statusGroup).getByRole('radio', { name: 'Late' }).click();

		// The on-time line (24) drops; the late/severe lines remain.
		expect(screen.queryByRole('link', { name: /24 Sherbrooke/i })).toBeNull();
		expect(screen.getByRole('link', { name: /161 Van Horne/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /99 Villeray/i })).toBeInTheDocument();
	});

	it('keeps a row whose verdict has not loaded yet (never blanks the list on load)', async () => {
		reset();
		snapshots.set('24', snap({ phase: 'ready', otpPct: 96, verdict: 'on_time' }));
		// 161 + 99 still loading (verdict null) — they must stay under the problem filter.
		render(LinesIndex);

		const statusGroup = screen.getByRole('radiogroup', { name: 'Reliability' });
		await within(statusGroup).getByRole('radio', { name: 'Late' }).click();

		expect(screen.queryByRole('link', { name: /24 Sherbrooke/i })).toBeNull();
		expect(screen.getByRole('link', { name: /161 Van Horne/i })).toBeInTheDocument();
	});

	it('announces a polite SR caption while the filtered list is all still-loading verdicts', async () => {
		reset();
		// All three rows still loading → the filtered list is non-empty but verdict-less.
		render(LinesIndex);

		const liveRegion = screen.getByRole('status');
		// Silent under the default "all" status (no premature announcement).
		expect(liveRegion).toHaveTextContent('');

		const statusGroup = screen.getByRole('radiogroup', { name: 'Reliability' });
		await within(statusGroup).getByRole('radio', { name: 'Late' }).click();

		// Now the problem filter is on with no loaded verdict yet → the caption speaks.
		expect(liveRegion).toHaveTextContent('Loading reliability for the visible lines…');
	});

	it('falls silent once a visible row has a real verdict under the problem filter', async () => {
		reset();
		snapshots.set('161', snap({ phase: 'ready', otpPct: 55, verdict: 'severe' }));
		render(LinesIndex);

		const statusGroup = screen.getByRole('radiogroup', { name: 'Reliability' });
		await within(statusGroup).getByRole('radio', { name: 'Late' }).click();

		// At least one visible row resolved → no pending caption.
		expect(screen.getByRole('status')).toHaveTextContent('');
	});
});
