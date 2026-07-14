import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '$lib/i18n';
import type { StopReliability } from '$lib/v1';
import { historyRangeRequestFromSearchParams } from '$lib/v1/history';
import { encodeHistoryEntityId } from '$lib/v1/history/entity';
import {
	HistoricCollectionIndexSchema,
	StopHistoryPartitionSchema,
	type HistoricCollectionIndex,
	type HistoricMetricCoverage,
	type HistoricPartitionRef,
	type IsoUtc,
	type StopHistoryPartition,
} from '$lib/v1/schemas';
import {
	createStopHistoryResource,
	type StopHistoryResource,
} from '../data/stopHistoryResource.svelte';
import { stopReliabilityCopy } from '../stops-reliability.copy';
import StopReliabilitySurface from './StopReliabilitySurface.svelte';

const harness = vi.hoisted(() => {
	const page = {
		url: new URL('http://localhost/stop/raw?tab=reliability'),
		state: {},
	};
	const mirrorSearchParams = vi.fn((values: Record<string, string | null>) => {
		const next = new URL(page.url);
		for (const [key, value] of Object.entries(values)) {
			if (value == null) next.searchParams.delete(key);
			else next.searchParams.set(key, value);
		}
		page.url = next;
	});
	return {
		page,
		mirrorSearchParams,
		getStopHistoryIndex: vi.fn(),
		loadStopHistoryRange: vi.fn(),
	};
});

vi.mock('$app/state', () => ({ page: harness.page }));
vi.mock('$lib/site/urlMirror', () => ({
	mirrorSearchParams: harness.mirrorSearchParams,
	mirrorSearchParam: vi.fn(),
}));
vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history')),
	wilsonBounds: (await import('$lib/v1/stats')).wilsonBounds,
	getStopHistoryIndex: harness.getStopHistoryIndex,
	loadStopHistoryRange: harness.loadStopHistoryRange,
}));

const ENTITY_ID = '../A/B?é';
const GENERATED = '2026-07-13T12:00:00Z' as IsoUtc;
const GENERATION = 'c'.repeat(64);
const WINDOW = { from: '2026-01-31', to: '2026-02-01' } as const;

function metric(
	name: HistoricMetricCoverage['metric'],
	aggregation: HistoricMetricCoverage['aggregation'],
	from: string | null = WINDOW.from,
	to: string | null = WINDOW.to,
): HistoricMetricCoverage {
	return {
		metric: name,
		aggregation,
		first_available_date: from,
		last_available_date: to,
		gaps: [],
	};
}

function partitionRef(
	month: string,
	shaCharacter: string,
	from: string,
	to: string,
): HistoricPartitionRef {
	const sha256 = shaCharacter.repeat(64);
	return {
		path: `historic/history/stops/${encodeHistoryEntityId(ENTITY_ID)}/generations/${sha256}/${month}.json`,
		coverage_start: from,
		coverage_end: to,
		count: 1,
		sha256,
		byte_size: 100,
	};
}

const refs = [
	partitionRef('2026-01', 'a', WINDOW.from, WINDOW.from),
	partitionRef('2026-02', 'b', WINDOW.to, WINDOW.to),
];

function collectionIndex(metrics: readonly HistoricMetricCoverage[]): HistoricCollectionIndex {
	return HistoricCollectionIndexSchema.parse({
		generated_utc: GENERATED,
		family: 'stops',
		selection_mode: 'range',
		entity_id: ENTITY_ID,
		collection_generation_id: GENERATION,
		first_available_date: WINDOW.from,
		last_available_date: WINDOW.to,
		gaps: [],
		partitions: refs,
		metrics,
	});
}

const completeIndex = collectionIndex([
	metric('delay', 'additive'),
	metric('delay_percentiles', 'daily_only'),
	metric('occupancy', 'additive'),
]);

const partialOccupancyIndex = collectionIndex([
	metric('delay', 'additive'),
	metric('delay_percentiles', 'daily_only'),
	metric('occupancy', 'additive', WINDOW.from, WINDOW.from),
]);

const noDelayIndex = collectionIndex([metric('delay_percentiles', 'daily_only')]);

function partition(month: string, days: Array<Record<string, unknown>>): StopHistoryPartition {
	return StopHistoryPartitionSchema.parse({
		generated_utc: GENERATED,
		month,
		entity_id: ENTITY_ID,
		days,
	});
}

function retainedDay(
	date: string,
	observations: number,
	severe: number,
	sumDelaySeconds: number,
	occupancy: Record<'empty' | 'many_seats' | 'few_seats' | 'standing' | 'full', number> | null,
) {
	return {
		date,
		delay: {
			observation_count: observations,
			in_clamp_observation_count: observations,
			severe_count: severe,
			sum_delay_seconds: sumDelaySeconds,
		},
		delay_percentiles: {
			observation_count: observations,
			p50_delay_seconds: 30,
			p90_delay_seconds: 180,
		},
		...(occupancy == null ? {} : { occupancy }),
	};
}

// The daily adapter rounds these to 1.1 and 1.0 minutes. Pooling those rounded
// points would print 1.0; pooling the exact sums prints the truthful 1.1.
const retainedPartitions = [
	partition('2026-01', [
		retainedDay(WINDOW.from, 40, 0, 2_758, {
			empty: 0,
			many_seats: 5,
			few_seats: 3,
			standing: 2,
			full: 0,
		}),
	]),
	partition('2026-02', [
		retainedDay(WINDOW.to, 60, 9, 3_776, {
			empty: 0,
			many_seats: 5,
			few_seats: 3,
			standing: 2,
			full: 0,
		}),
	]),
] as StopHistoryPartition[];

const partialOccupancyPartitions = [
	retainedPartitions[0],
	partition('2026-02', [retainedDay(WINDOW.to, 60, 9, 3_776, null)]),
] as StopHistoryPartition[];

const zeroDelayPartitions = [
	partition('2026-01', [
		retainedDay(WINDOW.from, 40, 0, 0, {
			empty: 1,
			many_seats: 0,
			few_seats: 0,
			standing: 0,
			full: 0,
		}),
	]),
	partition('2026-02', [
		retainedDay(WINDOW.to, 60, 0, 0, {
			empty: 1,
			many_seats: 0,
			few_seats: 0,
			standing: 0,
			full: 0,
		}),
	]),
] as StopHistoryPartition[];

const noDelayPartitions = [
	partition('2026-01', [
		{
			date: WINDOW.from,
			delay_percentiles: {
				observation_count: 40,
				p50_delay_seconds: 0,
				p90_delay_seconds: 0,
			},
		},
	]),
	partition('2026-02', [
		{
			date: WINDOW.to,
			delay_percentiles: {
				observation_count: 60,
				p50_delay_seconds: 0,
				p90_delay_seconds: 0,
			},
		},
	]),
] as StopHistoryPartition[];

const habits = Array.from({ length: 7 }, (_, day) =>
	Array.from({ length: 24 }, (_, hour) => (day === 0 && hour === 8 ? 0.75 : null)),
);

const current: StopReliability = {
	generated_utc: GENERATED,
	id: ENTITY_ID,
	name: 'Current stop',
	periods: [
		{
			grain: 'day',
			otp_pct: 77,
			avg_delay_min: 7.7,
			p50_min: 2.5,
			p90_min: 12,
			severe_pct: 23,
			observation_count: 100,
		},
		{
			grain: 'week',
			otp_pct: 22,
			avg_delay_min: 6.6,
			severe_pct: 31,
			observation_count: 100,
		},
		{
			grain: 'month',
			otp_pct: 33,
			avg_delay_min: 5.5,
			severe_pct: 29,
			observation_count: 100,
		},
		{ grain: 'am_peak', severe_pct: 44, avg_delay_min: 4.4 },
		{ grain: 'weekday', severe_pct: 31, avg_delay_min: 3.1 },
	],
	habits: { scale: 'severe_relative', matrix: habits },
	day_of_week: [{ day_of_week_iso: 1, avg_delay_min: 8.8, severe_pct: 45 }],
	by_route: [{ route: '51', avg_delay_min: 8.8 }],
	occupancy_mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 1 },
	daily: [
		{
			date: '2026-07-11',
			observation_count: 40,
			severe_count: 40,
			severe_pct: 100,
			avg_delay_min: 9,
		},
		{
			date: '2026-07-12',
			observation_count: 60,
			severe_count: 59,
			severe_pct: 98.3,
			avg_delay_min: 9,
		},
	],
};

function explicitUrl(extra = ''): URL {
	return new URL(
		`http://localhost/stop/${encodeURIComponent(ENTITY_ID)}?tab=reliability&grain=week&from=${WINDOW.from}&to=${WINDOW.to}&focus=keep${extra}`,
	);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const resources: StopHistoryResource[] = [];

function createHistory(): StopHistoryResource {
	const resource = createStopHistoryResource(
		ENTITY_ID,
		historyRangeRequestFromSearchParams(harness.page.url.searchParams),
	);
	resources.push(resource);
	return resource;
}

function renderSurface(history: StopHistoryResource, locale: Locale = 'en') {
	return render(StopReliabilitySurface, {
		props: { data: current, locale, history } as never,
	});
}

function expectAnnounced(container: HTMLElement, message: RegExp | string): void {
	const statuses = [...container.querySelectorAll<HTMLElement>('[role="status"]')];
	const matches = statuses.some((status) =>
		typeof message === 'string'
			? status.textContent?.includes(message)
			: message.test(status.textContent ?? ''),
	);
	expect.soft(matches).toBe(true);
}

beforeEach(() => {
	harness.page.url = new URL(
		`http://localhost/stop/${encodeURIComponent(ENTITY_ID)}?tab=reliability`,
	);
	harness.mirrorSearchParams.mockClear();
	harness.getStopHistoryIndex.mockReset().mockResolvedValue(completeIndex);
	harness.loadStopHistoryRange.mockReset().mockResolvedValue(retainedPartitions);
});

afterEach(() => {
	for (const resource of resources.splice(0)) resource.destroy();
	cleanup();
});

describe('StopReliabilitySurface retained Stop history', () => {
	it('keeps the current default untouched, discovers only the raw stop, and loads no partition', async () => {
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(harness.getStopHistoryIndex).toHaveBeenCalledTimes(1));
		expect(harness.getStopHistoryIndex).toHaveBeenCalledWith(ENTITY_ID, expect.any(Object));
		expect(harness.loadStopHistoryRange).not.toHaveBeenCalled();
		expect(view.container.querySelector('[data-slot="daily-range-verdict"]')).toHaveTextContent(
			'99.0%',
		);
		expect(view.container.querySelector('[data-slot="stop-crowding"]')).toHaveTextContent('100%');
	});

	it('uses one controlled navigator in the existing rail, keeps three grains, and removes the local picker', async () => {
		harness.page.url = explicitUrl();
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(history.state).toBe('ready'));
		expect(view.container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		const rail = view.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getAllByRole('radio', { name: /Day|Week|Month/ })).toHaveLength(3);
		expect(within(rail).getAllByRole('region', { name: /stop reliability history/i })).toHaveLength(
			1,
		);
		const bounds = rail.querySelectorAll<HTMLInputElement>('input[type="date"]');
		expect(bounds).toHaveLength(2);
		expect(bounds[0]).toHaveValue(WINDOW.from);
		expect(bounds[1]).toHaveValue(WINDOW.to);
		expect(view.container.querySelector('[data-slot="daily-range-controls"]')).toBeNull();
		expect(view.container.querySelectorAll('[data-slot="date-range"]')).toHaveLength(1);
	});

	it('hides current-owned daily and crowding while loading, then uses exact aggregate sums', async () => {
		const pending = deferred<StopHistoryPartition[]>();
		harness.page.url = explicitUrl();
		harness.loadStopHistoryRange.mockReturnValue(pending.promise);
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(harness.loadStopHistoryRange).toHaveBeenCalledTimes(1));
		expect(
			view.container.querySelector('[data-slot="daily-range-verdict"]')?.textContent ?? '',
		).not.toContain('99.0%');
		expect(view.container.querySelector('[data-slot="stop-crowding"]')).toBeNull();
		expectAnnounced(view.container, /loading retained range/i);

		pending.resolve(retainedPartitions);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="daily-range-verdict"]')).toHaveTextContent(
				'9.0%',
			),
		);
		const verdict = view.container.querySelector('[data-slot="daily-range-verdict"]');
		expect(verdict).toHaveTextContent('1.1 min');
		expect(verdict).toHaveTextContent('100');
		expect(verdict).not.toHaveTextContent('1.0 min');
		expect(harness.page.url.searchParams.get('grain')).toBe('week');
		expect(harness.page.url.searchParams.get('tab')).toBe('reliability');
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		expect(harness.page.url.searchParams.get('from')).toBe(WINDOW.from);
		expect(harness.page.url.searchParams.get('to')).toBe(WINDOW.to);
	});

	it('announces partial occupancy while rendering the retained mix', async () => {
		harness.page.url = explicitUrl();
		harness.getStopHistoryIndex.mockResolvedValue(partialOccupancyIndex);
		harness.loadStopHistoryRange.mockResolvedValue(partialOccupancyPartitions);
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(history.state).toBe('partial'));
		expectAnnounced(view.container, /partial retained metric coverage/i);
		const crowding = view.container.querySelector('[data-slot="stop-crowding"]');
		expect(crowding).toHaveTextContent('50%');
		expect(crowding).not.toHaveTextContent('100%');
		expect(crowding).toHaveTextContent(/selected range/i);
		expect(crowding).not.toHaveTextContent(/last 30 days/i);
	});

	it.each([
		['en', /current snapshot/i],
		['fr', /portrait actuel/i],
	] as const)(
		'keeps current-only period, habits, weekday, time, and route sections with one %s scope label',
		async (locale, localizedScope) => {
			harness.page.url = explicitUrl();
			const history = createHistory();
			const view = renderSurface(history, locale);

			await waitFor(() => expect(history.state).toBe('ready'));
			for (const slot of [
				'stop-reliability-pane',
				'stop-habits',
				'stop-weekday',
				'stop-time-of-day',
				'stop-by-route',
			]) {
				expect.soft(view.container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
			}
			expect(view.container.querySelector('[data-slot="stop-reliability-pane"]')).toHaveTextContent(
				'22%',
			);
			expect(view.container.querySelector('[data-slot="stop-by-route"]')).toHaveTextContent('51');
			const scope = view.container.querySelectorAll('[data-slot="history-current-only"]');
			expect(scope).toHaveLength(1);
			expect(scope[0]).toHaveTextContent(localizedScope);
			for (const link of view.container.querySelectorAll<HTMLAnchorElement>('a[href^="/lines/"]')) {
				expect(link.getAttribute('href')).not.toMatch(/[?&](?:tab|grain|from|to)=/);
			}
		},
	);

	it('announces a retained-range error and retries through the real resource', async () => {
		harness.page.url = explicitUrl();
		harness.loadStopHistoryRange
			.mockRejectedValueOnce(new Error('retained range unavailable'))
			.mockResolvedValueOnce(retainedPartitions);
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(history.state).toBe('error'));
		expectAnnounced(view.container, /retained range could not be loaded/i);
		const retry = view.queryByRole('button', { name: /retry/i });
		expect.soft(retry).not.toBeNull();
		if (retry) {
			await fireEvent.click(retry);
			await waitFor(() => expect(harness.loadStopHistoryRange).toHaveBeenCalledTimes(2));
			await waitFor(() => expect(history.state).toBe('ready'));
		}
	});

	it('gives a corrected range exactly one visual owner', async () => {
		harness.page.url = new URL(
			`http://localhost/stop/${encodeURIComponent(ENTITY_ID)}?tab=reliability&grain=week&from=2025-01-01&to=2025-01-02`,
		);
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(history.state).toBe('current'));
		const owners = Array.from(
			view.container.querySelectorAll(
				'[data-slot="history-announcement"], [data-slot="history-correction"]',
			),
		).filter((element) =>
			/unavailable date range|plage non disponible/i.test(element.textContent ?? ''),
		);
		expect(owners).toHaveLength(1);
		expect(harness.page.url.searchParams.get('grain')).toBe('week');
		expect(harness.page.url.searchParams.get('from')).toBeNull();
		expect(harness.page.url.searchParams.get('to')).toBeNull();
	});

	it('keeps current singleton controls and data when the optional retained index is absent', async () => {
		harness.page.url = new URL(
			`http://localhost/stop/${encodeURIComponent(ENTITY_ID)}?tab=reliability&grain=week&from=2026-07-11&to=2026-07-11&focus=keep`,
		);
		harness.getStopHistoryIndex.mockResolvedValue(null);
		const history = createHistory();
		const view = renderSurface(history);

		await waitFor(() => expect(history.state).toBe('current'));
		const rail = view.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getAllByRole('region', { name: /stop reliability history/i })).toHaveLength(
			1,
		);
		const bounds = rail.querySelectorAll<HTMLInputElement>('input[type="date"]');
		expect(bounds).toHaveLength(2);
		expect(bounds[0]).toHaveValue('2026-07-11');
		expect(bounds[1]).toHaveValue('2026-07-11');
		expect(view.container.querySelector('[data-slot="daily-range-verdict"]')).toHaveTextContent(
			'100.0%',
		);
		expect(harness.loadStopHistoryRange).not.toHaveBeenCalled();
		expect(harness.page.url.searchParams.get('from')).toBe('2026-07-11');
		expect(harness.page.url.searchParams.get('to')).toBe('2026-07-11');
		expect(harness.page.url.searchParams.get('grain')).toBe('week');
		expect(harness.page.url.searchParams.get('tab')).toBe('reliability');
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
	});

	it('keeps a measured zero severe share distinct from retained no-delay data', async () => {
		harness.page.url = explicitUrl();
		harness.loadStopHistoryRange.mockResolvedValue(zeroDelayPartitions);
		const zeroHistory = createHistory();
		const zeroView = renderSurface(zeroHistory);

		await waitFor(() => expect(zeroHistory.state).toBe('ready'));
		const verdict = zeroView.container.querySelector('[data-slot="daily-range-verdict"]');
		expect(verdict).toHaveTextContent('0.0%');
		expect(verdict).toHaveTextContent('0.0 min');

		cleanup();
		harness.getStopHistoryIndex.mockResolvedValue(noDelayIndex);
		harness.loadStopHistoryRange.mockResolvedValue(noDelayPartitions);
		const noDataHistory = createHistory();
		const noDataView = renderSurface(noDataHistory);
		await waitFor(() => expect(noDataHistory.state).toBe('no-data'));
		expectAnnounced(noDataView.container, /no data is retained for this range/i);
		expect(
			noDataView.container.querySelector('[data-slot="daily-range-verdict"]')?.textContent ?? '',
		).not.toContain('0.0%');
	});

	it('defines honest Stop-history navigation, state, correction, and current-only copy in EN and FR', () => {
		type HistoryCopy = {
			navigator?: { group?: string };
			partial?: string;
			noData?: string;
			currentOnly?: string;
			loading?: string;
			error?: string;
			retry?: string;
			correction?: Record<string, string>;
		};
		for (const locale of ['en', 'fr'] as const) {
			const historyCopy = (stopReliabilityCopy[locale] as unknown as { history?: HistoryCopy })
				.history;
			expect.soft(historyCopy).toBeDefined();
			expect.soft(historyCopy?.navigator?.group).toBeTruthy();
			expect.soft(historyCopy?.partial).toBeTruthy();
			expect.soft(historyCopy?.noData).toBeTruthy();
			expect.soft(historyCopy?.currentOnly).toBeTruthy();
			expect.soft(historyCopy?.loading).toBeTruthy();
			expect.soft(historyCopy?.error).toBeTruthy();
			expect.soft(historyCopy?.retry).toBeTruthy();
			expect.soft(historyCopy?.correction?.malformed).toBeTruthy();
			expect.soft(historyCopy?.correction?.['outside-coverage']).toBeTruthy();
		}
	});
});
