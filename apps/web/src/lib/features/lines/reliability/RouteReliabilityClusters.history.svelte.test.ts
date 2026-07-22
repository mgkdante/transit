import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteReliability } from '$lib/v1';
import {
	HistoricCollectionIndexSchema,
	LineHistoryPartitionSchema,
	type HistoricCollectionIndex,
	type IsoUtc,
	type LineHistoryPartition,
} from '$lib/v1/schemas';
import { historyRangeRequestFromSearchParams } from '$lib/v1/history/rangeResource.svelte';
import {
	createLineHistoryResource,
	type LineHistoryResource,
} from './data/lineHistoryResource.svelte';
import RouteReliabilityClusters from './RouteReliabilityClusters.svelte';
import { reliabilityCopy } from './reliability.copy';

const harness = vi.hoisted(() => {
	const page = { url: new URL('http://localhost/lines/A%2FB?tab=reliability'), state: {} };
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
		getLineHistoryIndex: vi.fn(),
		loadLineHistoryRange: vi.fn(),
	};
});

vi.mock('$app/state', () => ({ page: harness.page }));
vi.mock('$lib/site/urlMirror', () => ({
	mirrorSearchParams: harness.mirrorSearchParams,
	mirrorSearchParam: vi.fn(),
}));
vi.mock('$lib/nav', () => ({ layout: { isDesktop: true } }));
vi.mock('$lib/v1/repositories/historic', () => ({
	getLineHistoryIndex: harness.getLineHistoryIndex,
	loadLineHistoryRange: harness.loadLineHistoryRange,
}));

const entityId = 'A/B';
const generatedUtc = '2026-07-13T12:00:00Z' as IsoUtc;
const window = { from: '2026-01-31', to: '2026-02-01' } as const;
const generation = 'c'.repeat(64);

function partitionRef(month: string, date: string, shaCharacter: string) {
	const sha = shaCharacter.repeat(64);
	return {
		path: `historic/history/lines/412f42/generations/${sha}/${month}.json`,
		coverage_start: date,
		coverage_end: date,
		count: 1,
		sha256: sha,
		byte_size: 100,
	};
}

function metric(metric: string, aggregation: string) {
	return {
		metric,
		aggregation,
		first_available_date: window.from,
		last_available_date: window.to,
		gaps: [],
	};
}

const historyIndex = HistoricCollectionIndexSchema.parse({
	generated_utc: generatedUtc,
	family: 'lines',
	selection_mode: 'range',
	entity_id: entityId,
	collection_generation_id: generation,
	first_available_date: window.from,
	last_available_date: window.to,
	gaps: [],
	partitions: [
		partitionRef('2026-01', '2026-01-31', 'a'),
		partitionRef('2026-02', '2026-02-01', 'b'),
	],
	metrics: [
		metric('delay', 'additive'),
		metric('delay_percentiles', 'daily_only'),
		metric('cancellation', 'additive'),
		metric('occupancy', 'additive'),
		metric('service_span', 'daily_only'),
		metric('skipped_stops', 'additive'),
	],
}) as HistoricCollectionIndex;

function retainedDay(
	date: string,
	observations: number,
	inClamp: number,
	onTime: number,
	sumDelaySeconds: number,
) {
	return {
		date,
		delay: {
			observation_count: observations,
			in_clamp_observation_count: inClamp,
			on_time_count: onTime,
			severe_count: 1,
			sum_delay_seconds: sumDelaySeconds,
		},
		delay_percentiles: {
			observation_count: observations,
			p50_delay_seconds: 60,
			p90_delay_seconds: 180,
		},
		cancellation: {
			canceled_trip_days: 1,
			total_trip_days: 10,
			scheduled_trip_days: 12,
			delivered_trip_days: 9,
			silent_trip_days: 2,
		},
		occupancy: { empty: 1, many_seats: 2, few_seats: 3, standing: 4, full: 0 },
		service_span: {
			trip_count: 9,
			first_trip_utc: `${date}T10:00:00Z`,
			last_trip_utc: `${date}T20:00:00Z`,
			first_trip_delay_seconds: 30,
			last_trip_delay_seconds: -30,
		},
		skipped_stops: { skipped_stop_count: 2, stop_time_update_count: 100 },
	};
}

const retainedPartitions = [
	LineHistoryPartitionSchema.parse({
		generated_utc: generatedUtc,
		month: '2026-01',
		entity_id: entityId,
		days: [retainedDay('2026-01-31', 10, 5, 2, 600)],
	}),
	LineHistoryPartitionSchema.parse({
		generated_utc: generatedUtc,
		month: '2026-02',
		entity_id: entityId,
		days: [retainedDay('2026-02-01', 90, 90, 81, 5_400)],
	}),
] as LineHistoryPartition[];

const noDelayPartitions = [
	LineHistoryPartitionSchema.parse({
		generated_utc: generatedUtc,
		month: '2026-01',
		entity_id: entityId,
		days: [
			{
				date: '2026-01-31',
				cancellation: {
					canceled_trip_days: 1,
					total_trip_days: 10,
					scheduled_trip_days: 10,
					delivered_trip_days: 9,
					silent_trip_days: 0,
				},
			},
		],
	}),
	LineHistoryPartitionSchema.parse({
		generated_utc: generatedUtc,
		month: '2026-02',
		entity_id: entityId,
		days: [
			{
				date: '2026-02-01',
				cancellation: {
					canceled_trip_days: 0,
					total_trip_days: 10,
					scheduled_trip_days: 10,
					delivered_trip_days: 10,
					silent_trip_days: 0,
				},
			},
		],
	}),
] as LineHistoryPartition[];

const current: RouteReliability = {
	id: entityId,
	generated_utc: generatedUtc,
	periods: [
		{
			grain: 'day',
			date: '2026-07-12',
			otp_pct: 12,
			avg_delay_min: 9,
			observation_count: 100,
			on_time: 12,
		},
		{ grain: 'week', date: '2026-07-06', otp_pct: 22 },
		{ grain: 'month', date: '2026-07', otp_pct: 33 },
		{ grain: 'am_peak', date: null, otp_pct: 44, avg_delay_min: 4 },
	],
	headway: [{ shift: 'am_peak', scheduled_min: 6, observed_min: 9 }],
	habits: { scale: 'repeat_problem_relative', matrix: [[0.5]] },
	weak_stops: [{ id: 'stop-1', name: 'Current stop', avg_delay_min: 8 }],
	cancellations: [
		{
			grain: 'day',
			date: '2026-07-12',
			cancellation_rate_pct: 99,
			canceled_trip_days: 9,
			total_trip_days: 10,
		},
	],
	occupancy_mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 1 },
	occupancy_by_grain: [
		{ grain: 'day', mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 1 } },
	],
	service_spans: [{ date: '2026-07-12', trip_count: 1 }],
	skipped_stops: [
		{
			date: '2026-07-12',
			skipped_stop_rate_pct: 99,
			skipped_stop_count: 9,
			stop_time_update_count: 10,
		},
	],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function createHistory() {
	return createLineHistoryResource(
		entityId,
		historyRangeRequestFromSearchParams(harness.page.url.searchParams),
	);
}

function staticHistory(state: LineHistoryResource['state']): LineHistoryResource {
	return {
		request: { hasFrom: true, hasTo: true, rawFrom: window.from, rawTo: window.to },
		index: historyIndex,
		resolved: null,
		value: null,
		state,
		error: null,
		setRequest: vi.fn(),
		retry: vi.fn(),
		destroy: vi.fn(),
	};
}

function activeWindowText(container: HTMLElement): string {
	return container.querySelector('[data-slot="active-window"]')?.textContent?.trim() ?? '';
}

function expectMultiDayCaption(container: HTMLElement): void {
	const caption = activeWindowText(container);
	expect.soft(caption).toContain(window.from);
	expect.soft(caption).toContain(window.to);
	expect.soft(caption).not.toBe(reliabilityCopy.en.controls.activeWindow.singleDay(window.from));
}

function expectAnnounced(container: HTMLElement, message: string): void {
	const liveStatuses = [...container.querySelectorAll<HTMLElement>('[role="status"]')];
	expect.soft(liveStatuses.some((status) => status.textContent?.includes(message))).toBe(true);
}

beforeEach(() => {
	harness.page.url = new URL('http://localhost/lines/A%2FB?tab=reliability');
	harness.mirrorSearchParams.mockClear();
	harness.getLineHistoryIndex.mockReset().mockResolvedValue(historyIndex);
	harness.loadLineHistoryRange.mockReset().mockResolvedValue(retainedPartitions);
});

afterEach(() => cleanup());

describe('RouteReliabilityClusters retained Line history', () => {
	it('keeps the current default untouched, discovers only this entity, and loads no partition', async () => {
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		await waitFor(() => expect(harness.getLineHistoryIndex).toHaveBeenCalledTimes(1));
		expect(harness.getLineHistoryIndex).toHaveBeenCalledWith(entityId, expect.any(Object));
		expect(harness.loadLineHistoryRange).not.toHaveBeenCalled();
		expect(view.container.querySelector('[data-band="verdict"]')).toHaveTextContent('12%');
		history.destroy();
	});

	it('keeps the default no-range service structure unchanged', async () => {
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.index).not.toBeNull());
			expect(view.container.querySelector('[data-slot="cancellations"]')).not.toBeNull();
			expect(view.container.querySelector('[data-slot="skipped-stops"]')).not.toBeNull();
			expect(view.container.querySelector('[data-slot="service-completeness"]')).toBeNull();
		} finally {
			history.destroy();
		}
	});

	it('uses one navigator in the existing rail and keeps exactly four grain choices', async () => {
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});
		await waitFor(() => expect(history.index).not.toBeNull());

		expect(view.container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		expect(
			view.getAllByRole('radio', { name: /Today|This week|This month|Date range/ }),
		).toHaveLength(4);
		await fireEvent.click(view.getByRole('radio', { name: reliabilityCopy.en.controls.dateRange }));
		const rail = view.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getAllByRole('region', { name: /history/i })).toHaveLength(1);
		expect(rail.querySelectorAll<HTMLInputElement>('input[type="date"]')).toHaveLength(2);
		history.destroy();
	});

	it('does not flash current owned metrics, then renders exact cross-month retained values', async () => {
		const pending = deferred<LineHistoryPartition[]>();
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01&focus=keep',
		);
		harness.loadLineHistoryRange.mockReturnValue(pending.promise);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(harness.loadLineHistoryRange).toHaveBeenCalledTimes(1));
			expect(view.container.querySelector('[data-band="verdict"]')).not.toHaveTextContent('12%');
			expect(
				view.container.querySelector('[data-slot="cancellations"]')?.textContent ?? '',
			).not.toContain('99');
			expectMultiDayCaption(view.container);
			expectAnnounced(view.container, reliabilityCopy.en.history.loading);

			pending.resolve(retainedPartitions);
			await waitFor(() =>
				expect(view.container.querySelector('[data-band="verdict"]')).toHaveTextContent('83%'),
			);
			expectAnnounced(view.container, 'Retained range loaded.');
			expect(view.container.querySelector('[data-slot="cancellations"]')).toHaveTextContent(
				'10.0%',
			);
			expect(view.container.querySelector('[data-slot="skipped-stops"]')).toHaveTextContent('2.0%');
			expect(view.container.querySelector('[data-slot="service-completeness"]')).toHaveTextContent(
				'75.0%',
			);
			expect(harness.page.url.searchParams.get('tab')).toBe('reliability');
			expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		} finally {
			history.destroy();
		}
	});

	it('keeps a corrected-range message visibly mounted after returning to the current view', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2025-01-01&to=2025-01-02',
		);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.state).toBe('current'));
			expect(view.container.querySelector('[data-slot="history-correction"]')).toHaveTextContent(
				reliabilityCopy.en.history.correction['outside-coverage'],
			);
			expect(view.container.querySelector('[data-slot="history-navigator"]')).toBeNull();
		} finally {
			history.destroy();
		}
	});

	it('shows one corrected-range message when an explicit range stays mounted', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&grain=range&from=2025-01-01&to=2025-01-02',
		);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.state).toBe('current'));
			const correction = reliabilityCopy.en.history.correction['outside-coverage'];
			expect(
				Array.from(
					view.container.querySelectorAll(
						'[data-slot="history-announcement"], [data-slot="history-correction"]',
					),
				).filter((element) => element.textContent?.trim() === correction),
			).toHaveLength(1);
		} finally {
			history.destroy();
		}
	});

	it.each([
		['a lone bound', 'from=2026-01-31'],
		['a malformed bound', 'from=not-a-date&to=2026-02-01'],
	] as const)(
		'announces and clears %s without losing the coordinator correction',
		async (_, query) => {
			harness.page.url = new URL(
				`http://localhost/lines/A%2FB?tab=reliability&focus=keep&${query}`,
			);
			const history = createHistory();
			const view = render(RouteReliabilityClusters, {
				props: { data: current, locale: 'en', history },
			});

			try {
				await waitFor(() => expect(history.state).toBe('current'));
				const correction = reliabilityCopy.en.history.correction.malformed;
				expect(
					Array.from(view.container.querySelectorAll('[data-slot="history-correction"]')).filter(
						(element) => element.textContent?.trim() === correction,
					),
				).toHaveLength(1);
				expect(harness.loadLineHistoryRange).not.toHaveBeenCalled();
				expect(harness.page.url.searchParams.get('from')).toBeNull();
				expect(harness.page.url.searchParams.get('to')).toBeNull();
				expect(harness.page.url.searchParams.get('tab')).toBe('reliability');
				expect(harness.page.url.searchParams.get('focus')).toBe('keep');
			} finally {
				history.destroy();
			}
		},
	);

	it('keeps blank-bound range intent canonical when retained discovery fails', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&focus=keep&from=&to=2026-02-01',
		);
		harness.getLineHistoryIndex.mockRejectedValue(new Error('retained index unavailable'));
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.state).toBe('error'));
			expect(activeWindowText(view.container)).toBe(
				reliabilityCopy.en.controls.activeWindow.rangePrompt,
			);
			expect(harness.page.url.searchParams.get('grain')).toBe('range');
			expect(harness.page.url.searchParams.get('from')).toBeNull();
			expect(harness.page.url.searchParams.get('to')).toBeNull();
			expect(harness.page.url.searchParams.get('tab')).toBe('reliability');
			expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		} finally {
			history.destroy();
		}
	});

	it('keeps the current singleton range usable when the optional retained index is absent', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-07-12&to=2026-07-12&focus=keep',
		);
		harness.getLineHistoryIndex.mockResolvedValue(null);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.state).toBe('current'));
			const range = view.getByRole('radio', { name: reliabilityCopy.en.controls.dateRange });
			expect(range).toHaveAttribute('aria-checked', 'true');
			const rail = view.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			expect(within(rail).getAllByRole('region', { name: /history/i })).toHaveLength(1);
			const bounds = rail.querySelectorAll<HTMLInputElement>('input[type="date"]');
			expect(bounds).toHaveLength(2);
			expect(bounds[0]).toHaveValue('2026-07-12');
			expect(bounds[1]).toHaveValue('2026-07-12');
			expect(activeWindowText(view.container)).toContain('2026-07-12');
			expect(harness.loadLineHistoryRange).not.toHaveBeenCalled();
			expect(harness.page.url.searchParams.get('from')).toBe('2026-07-12');
			expect(harness.page.url.searchParams.get('to')).toBe('2026-07-12');
			expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		} finally {
			history.destroy();
		}
	});

	it('keeps both selected bounds visible and announces a partial range with no delay rows', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		harness.loadLineHistoryRange.mockResolvedValue(noDelayPartitions);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.state).toBe('partial'));
			expectMultiDayCaption(view.container);
			expectAnnounced(view.container, reliabilityCopy.en.history.partial);
		} finally {
			history.destroy();
		}
	});

	it('announces an honest no-data retained range', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		const history = staticHistory('no-data');
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		expectMultiDayCaption(view.container);
		expectAnnounced(view.container, reliabilityCopy.en.history.noData);
	});

	it('announces a retained-range error, preserves the multi-day caption, and offers retry', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		harness.loadLineHistoryRange
			.mockRejectedValueOnce(new Error('retained range unavailable'))
			.mockResolvedValueOnce(retainedPartitions);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(history.state).toBe('error'));
			expectMultiDayCaption(view.container);
			expectAnnounced(view.container, reliabilityCopy.en.history.error);

			const retry = view.queryByRole('button', { name: /retry/i });
			expect.soft(retry).not.toBeNull();
			if (retry) {
				await fireEvent.click(retry);
				await waitFor(() => expect(harness.loadLineHistoryRange).toHaveBeenCalledTimes(2));
				await waitFor(() => expect(history.state).toBe('ready'));
			}
		} finally {
			history.destroy();
		}
	});

	it('keeps a deep-linked retained range while discovery is pending even when the current file has no dated rows', async () => {
		const pendingIndex = deferred<HistoricCollectionIndex | null>();
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		harness.getLineHistoryIndex.mockReturnValue(pendingIndex.promise);
		const history = createHistory();
		render(RouteReliabilityClusters, {
			props: { data: { ...current, periods: [] }, locale: 'en', history },
		});

		try {
			await waitFor(() => expect(harness.getLineHistoryIndex).toHaveBeenCalledTimes(1));
			expect(history.request).toEqual({
				hasFrom: true,
				hasTo: true,
				rawFrom: window.from,
				rawTo: window.to,
			});

			pendingIndex.resolve(historyIndex);
			await waitFor(() => expect(harness.loadLineHistoryRange).toHaveBeenCalledTimes(1));
		} finally {
			history.destroy();
		}
	});

	it('labels current-only sections once and never propagates the selected range into stop links', async () => {
		harness.page.url = new URL(
			'http://localhost/lines/A%2FB?tab=reliability&from=2026-01-31&to=2026-02-01',
		);
		const history = createHistory();
		const view = render(RouteReliabilityClusters, {
			props: { data: current, locale: 'en', history },
		});
		await waitFor(() => expect(history.state).toBe('ready'));

		expect(view.container.querySelectorAll('[data-slot="history-current-only"]')).toHaveLength(1);
		for (const link of view.container.querySelectorAll<HTMLAnchorElement>('a[href^="/stop/"]')) {
			expect(link.getAttribute('href')).not.toMatch(/[?&](?:tab|grain|from|to)=/);
		}
		history.destroy();
	});

	it('defines honest retained-history and current-only copy in English and French', () => {
		for (const locale of ['en', 'fr'] as const) {
			const historyCopy = reliabilityCopy[locale].history;
			expect(historyCopy.partial).toBeTruthy();
			expect(historyCopy.noData).toBeTruthy();
			expect(historyCopy.currentOnly).toBeTruthy();
			expect(historyCopy.correction.malformed).toBeTruthy();
		}
		expect(reliabilityCopy.en.controls.activeWindow.range(1, window.from, window.to)).toContain(
			'1 day,',
		);
		expect(reliabilityCopy.fr.controls.activeWindow.range(1, window.from, window.to)).toContain(
			'1 jour,',
		);
	});
});
