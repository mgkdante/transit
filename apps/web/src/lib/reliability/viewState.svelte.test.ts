import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createReliabilityViewState } from './viewState.svelte';
import { reactiveRoot, stateCell } from './__fixtures__/reactiveRoot.svelte';
import { RELIABILITY_GRAINS } from './grains';
import { HOTSPOT_GRAINS, OFFENDER_GRAINS } from './ladderGrains';
import { reliabilityCopy } from '#lib/features/lines/reliability/reliability.copy.ts';
import { windowedSeries } from '#lib/features/network/reliability/data/trendWindow.ts';
import { HistoricCollectionIndexSchema } from '#lib/v1/schemas/history.ts';
import type { HistoricCollectionIndex } from '#lib/v1/schemas/history.ts';
import type { TrendPoint } from '#lib/v1/index.ts';
import {
	historyRangeRequestFromSearchParams,
	type HistoryRangeResource,
} from '#lib/v1/history/rangeResource.svelte.ts';

const harness = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/network'), state: {} },
}));
vi.mock('$app/state', () => ({ page: harness.page }));
vi.mock('#lib/site/urlMirror.ts', () => ({
	mirrorSearchParams: vi.fn((values: Record<string, string | null>) => {
		const next = new URL(harness.page.url);
		for (const [key, value] of Object.entries(values)) {
			if (value == null) next.searchParams.delete(key);
			else next.searchParams.set(key, value);
		}
		harness.page.url = next;
	}),
}));

interface Dataset {
	readonly id: string;
	readonly periods?: readonly { grain: string; date?: string }[];
	readonly daily?: readonly { date: string }[];
	readonly series?: readonly TrendPoint[];
}
const calendar: Dataset = {
	id: 'current',
	periods: [{ grain: 'day' }, { grain: 'week' }, { grain: 'month' }],
};
const copy = reliabilityCopy.en.history;
const labels = () => ({
	day: 'Day',
	week: 'Week',
	month: 'Month',
	range: 'Date window',
	shift: 'Shift',
});
const roots: Array<() => void> = [];

function mount<T>(create: () => T): T {
	const root = reactiveRoot(create);
	roots.push(root.destroy);
	flushSync();
	return root.value;
}

function history() {
	const input = stateCell<HistoryRangeResource<HistoricCollectionIndex, Dataset>>({
		request: historyRangeRequestFromSearchParams(harness.page.url.searchParams),
		state: 'current',
		index: null,
		resolved: null,
		value: null,
		error: null,
		setRequest(request) {
			input.value = {
				...input.value,
				request,
				state: request.hasFrom || request.hasTo ? 'loading-range' : 'current',
				value: null,
				resolved: null,
			};
		},
		retry: vi.fn(),
		destroy: vi.fn(),
	});
	return input;
}

beforeEach(() => {
	harness.page.url = new URL('http://localhost/network?focus=keep');
});
afterEach(() => {
	for (const destroy of roots.splice(0)) destroy();
});

describe('reliability view-state public contract', () => {
	it.each(['grain=week,month', 'grain=bogus&grain=week', 'grain=%20week'])(
		'opens the first valid calendar grain from %s',
		(query) => {
			harness.page.url.search = query;
			const resource = history();
			const view = mount(() =>
				createReliabilityViewState({
					snapshot: () => calendar,
					retained: { resource: () => resource.value, copy: () => copy },
					grains: { keys: RELIABILITY_GRAINS, labels },
					locale: () => 'en',
				}),
			);
			expect(view.grain).toBe('week');
			expect(harness.page.url.searchParams.has('grain')).toBe(false);
		},
	);
	it('drops a garbage grain without crashing or losing unrelated URL state', () => {
		harness.page.url.search = 'grain=garbage&focus=keep';
		const resource = history();
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => calendar,
				retained: { resource: () => resource.value, copy: () => copy },
				grains: { keys: RELIABILITY_GRAINS, labels },
				locale: () => 'en',
			}),
		);
		expect(view.grain).toBe('day');
		expect(harness.page.url.searchParams.has('grain')).toBe(false);
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
	});
	it.each(['day', 'week', 'month'] as const)(
		'keeps an explicit %s grain in the URL after data arrives',
		(grain) => {
			harness.page.url.search = `grain=${grain}`;
			const snapshot = stateCell<Dataset | null>(null);
			const resource = history();
			const view = mount(() =>
				createReliabilityViewState({
					snapshot: () => snapshot.value,
					retained: { resource: () => resource.value, copy: () => copy },
					grains: { keys: RELIABILITY_GRAINS, labels },
					locale: () => 'en',
				}),
			);
			expect(view.grain).toBe(grain);
			snapshot.value = calendar;
			flushSync();
			expect(view.grain).toBe(grain);
			expect(harness.page.url.searchParams.get('grain')).toBe(grain);
		},
	);
	it.each([
		{ entity: 'hotspots', keys: HOTSPOT_GRAINS },
		{ entity: 'repeat offenders', keys: OFFENDER_GRAINS },
	])('supports the $entity grain-only path and tokenized links', ({ keys }) => {
		harness.page.url.search = 'grain=bogus&grain=month&focus=keep';
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => calendar,
				grains: { keys, labels, present: () => new Set(keys) },
				locale: () => 'en',
				url: () => ({ date: '2026-07-12', n: '5' }),
			}),
		);
		expect(view.grain).toBe('month');
		expect(view.navigator).toBeNull();
		expect(harness.page.url.searchParams.get('grain')).toBe('month');
		expect(harness.page.url.searchParams.get('date')).toBe('2026-07-12');
		expect(harness.page.url.searchParams.get('n')).toBe('5');
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		view.selectGrain('week');
		flushSync();
		expect(view.grain).toBe('week');
	});
	it('keeps the hotspot shift extension', () => {
		harness.page.url.search = 'grain=shift';
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => calendar,
				grains: { keys: HOTSPOT_GRAINS, labels, present: () => new Set(HOTSPOT_GRAINS) },
				locale: () => 'en',
			}),
		);
		expect(view.grain).toBe('shift');
		expect(harness.page.url.searchParams.get('grain')).toBe('shift');
	});
	it('makes no live announcement on a plain default load', () => {
		const resource = history();
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => calendar,
				retained: { resource: () => resource.value, copy: () => copy },
				grains: { keys: RELIABILITY_GRAINS, labels },
				locale: () => 'en',
			}),
		);
		expect(view.announcements).toEqual({ correction: null, live: '' });
		expect(view.navigator?.liveAnnouncement).toBe(false);
	});
	it('line keeps its range control separate from calendar grains', () => {
		harness.page.url = new URL('http://localhost/lines/24?from=2026-01-31&to=2026-02-01');
		const snapshot: Dataset = {
			id: 'line',
			periods: [
				{ grain: 'day', date: '2026-01-31' },
				{ grain: 'day', date: '2026-02-01' },
				{ grain: 'week' },
			],
		};
		const resource = history();
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => snapshot,
				retained: { resource: () => resource.value, copy: () => copy },
				grains: { keys: ['day', 'week', 'month', 'range'] as const, labels },
				locale: () => 'en',
			}),
		);
		expect(view.grain).toBe('range');
		expect(view.segments.map((segment) => segment.key)).toEqual(['day', 'week', 'month', 'range']);
		expect(view.navigator?.value).toEqual({ from: '2026-01-31', to: '2026-02-01' });
		view.selectGrain('week');
		flushSync();
		expect(view.grain).toBe('week');
		expect(resource.value.request.hasFrom).toBe(false);
		expect(resource.value.request.hasTo).toBe(false);
		expect(view.window).toBeUndefined();
		expect(harness.page.url.searchParams.get('grain')).toBe('week');
	});
	it.each([
		['grain=bogus&grain=week', 'day'],
		['grain=week', 'week'],
	] as const)('line preserves its unavailable-grain policy for %s', (query, expected) => {
		harness.page.url.search = query;
		const resource = history();
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => ({ periods: [{ grain: 'day', date: '2026-07-12' }] }),
				retained: { resource: () => resource.value, copy: () => copy },
				grains: { keys: ['day', 'week', 'month', 'range'] as const, labels },
				locale: () => 'en',
			}),
		);
		expect(view.grain).toBe(expected);
	});
	it('stop uses its own current daily dates when retained discovery is absent', () => {
		harness.page.url = new URL('http://localhost/stop/1?from=2026-07-11&to=2026-07-12');
		const snapshot: Dataset = {
			id: 'stop',
			periods: [{ grain: 'day', date: '2026-01-01' }],
			daily: [{ date: '2026-07-12' }, { date: '2026-07-11' }, { date: '2026-07-12' }],
		};
		const resource = history();
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => snapshot,
				retained: { resource: () => resource.value, copy: () => copy },
				grains: { keys: RELIABILITY_GRAINS, labels },
				locale: () => 'en',
			}),
		);
		expect(view.navigator?.availableDates).toEqual(['2026-07-11', '2026-07-12']);
		expect(view.window).toEqual({ from: '2026-07-11', to: '2026-07-12' });
		expect(view.data).toBe(snapshot);
		expect(view.history.active).toBe(false);
	});
	it('network restores all 7/30/90 chart choices independently of its retained window', () => {
		const current: Dataset = {
			id: 'network',
			series: Array.from({ length: 90 }, (_, i) => ({
				date: new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10),
				otp_pct: 85,
			})),
		};
		const retained: Dataset = { id: 'retained', series: [{ date: '2026-01-31', otp_pct: 70 }] };
		const resource = history();
		const view = mount(() =>
			createReliabilityViewState({
				snapshot: () => current,
				retained: { resource: () => resource.value, copy: () => copy },
				grains: { keys: RELIABILITY_GRAINS, labels },
				apply: (_snapshot, selected) => selected,
				locale: () => 'en',
			}),
		);
		view.navigator?.onRangeChange?.({ from: '2026-01-31', to: '2026-01-31' });
		flushSync();
		expect(view.data).toBeNull();
		resource.value = {
			...resource.value,
			state: 'ready',
			value: retained,
			index: HistoricCollectionIndexSchema.parse({
				family: 'network',
				selection_mode: 'range',
				generated_utc: '2026-07-13T12:00:00Z',
				first_available_date: '2026-01-31',
				last_available_date: '2026-01-31',
				gaps: [],
				partitions: [
					{
						path: 'historic/history/network/2026-01.json',
						coverage_start: '2026-01-31',
						coverage_end: '2026-01-31',
						count: 1,
					},
				],
			}),
			resolved: {
				selection: { from: '2026-01-31', to: '2026-01-31' },
				canonicalWindow: { from: '2026-01-31', to: '2026-01-31' },
				correction: null,
				intersectingGaps: [],
			},
		};
		flushSync();
		expect(view.data).toBe(retained);
		expect(view.window).toEqual({ from: '2026-01-31', to: '2026-01-31' });
		expect(current.series).toHaveLength(90);
		view.navigator?.onRangeChange?.(undefined);
		flushSync();
		expect(view.window).toBeUndefined();
		expect(view.data).toBe(current);
		for (const days of [7, 30, 90] as const)
			expect(
				windowedSeries('day', { daily: view.data?.series ?? [], weekly: [], monthly: [] }, days),
			).toHaveLength(days);
	});
});
