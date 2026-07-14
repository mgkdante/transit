import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkFile, NetworkShift, TrendPoint } from '$lib/v1';
import type { HistoricCollectionIndex, IsoUtc, NetworkHistoryPartition } from '$lib/v1/schemas';
import NetworkSurface from './NetworkSurface.svelte';
import { networkReliabilityCopy } from '../network-reliability.copy';

const harness = vi.hoisted(() => {
	const page = {
		url: new URL('http://localhost/network'),
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
		getNetworkHistoryIndex: vi.fn(),
		loadNetworkHistoryRange: vi.fn(),
		liveClock: { ageSeconds: 20 as number | null },
	};
});

const currentNetwork = {
	generated_utc: '2026-06-16T02:00:00Z' as IsoUtc,
	vehicles_in_service: 10,
	on_time_pct: 80,
	status_dist: { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 },
	delay_p50_min: 1,
	delay_p90_min: 6,
	non_responding: 1,
	feed_freshness_s: 20,
	coverage_pct: 95,
	occupancy_mix: null,
	delay_histogram: null,
	non_responding_by_route: [{ route_id: '51', count: 1 }],
} satisfies NetworkFile as NetworkFile;

const currentDaily: TrendPoint[] = [
	{
		date: '2026-06-14',
		otp_pct: 78,
		avg_delay_min: 2.1,
		p90_min: 5,
		vehicles: 9,
		cancellation_rate: 1.2,
		occupancy_mix: null,
	},
	{
		date: '2026-06-15',
		otp_pct: 81,
		avg_delay_min: 1.8,
		p90_min: 6,
		vehicles: 11,
		cancellation_rate: 2.6,
		occupancy_mix: null,
	},
];
const currentDailyOriginal = currentDaily.slice();

function currentDays(count: number): TrendPoint[] {
	return Array.from({ length: count }, (_, offset) => {
		const date = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
		return {
			date,
			otp_pct: 70 + (offset % 20),
			avg_delay_min: 1 + (offset % 5),
			p90_min: 4 + (offset % 6),
			vehicles: 100 + offset,
			cancellation_rate: null,
			occupancy_mix: null,
		};
	});
}

const currentWeekly = [
	{ date: '2026-06-08', otp_pct: 77, avg_delay_min: 2.2, p90_min: null, vehicles: null },
	{ date: '2026-06-15', otp_pct: 83, avg_delay_min: 1.6, p90_min: null, vehicles: null },
] satisfies TrendPoint[];

const currentMonthly = [
	{ date: '2026-05-01', otp_pct: 76, avg_delay_min: 2.5, p90_min: null, vehicles: null },
] satisfies TrendPoint[];

const currentByShift = [
	{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3 },
] satisfies NetworkShift[];

const currentByDaytype = [
	{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
] satisfies NetworkShift[];

const generation = 'f'.repeat(64);
const januarySha = 'a'.repeat(64);
const februarySha = 'b'.repeat(64);

function metric(metric: string, aggregation: string) {
	return {
		metric,
		aggregation,
		first_available_date: '2026-01-30',
		last_available_date: '2026-02-02',
		gaps: [],
	};
}

function coverageMetric(metricName: string, aggregation: string, date: string) {
	return {
		...metric(metricName, aggregation),
		first_available_date: date,
		last_available_date: date,
	};
}

const historyIndex = {
	generated_utc: '2026-07-13T12:00:00Z' as IsoUtc,
	family: 'network',
	selection_mode: 'range',
	collection_generation_id: generation,
	first_available_date: '2026-01-30',
	last_available_date: '2026-02-02',
	gaps: [],
	partitions: [
		{
			path: `historic/history/network/generations/${januarySha}/2026-01.json`,
			coverage_start: '2026-01-30',
			coverage_end: '2026-01-31',
			count: 2,
			sha256: januarySha,
			byte_size: 100,
		},
		{
			path: `historic/history/network/generations/${februarySha}/2026-02.json`,
			coverage_start: '2026-02-01',
			coverage_end: '2026-02-02',
			count: 2,
			sha256: februarySha,
			byte_size: 100,
		},
	],
	metrics: [
		metric('delay', 'additive'),
		metric('delay_percentiles', 'daily_only'),
		metric('vehicles', 'daily_only'),
		metric('cancellation', 'additive'),
		metric('occupancy', 'additive'),
	],
} as HistoricCollectionIndex;
const januaryPartitionRef = historyIndex.partitions?.[0];
if (januaryPartitionRef == null) throw new Error('Expected January history fixture partition');

function retainedDay(date: string, observations: number, onTime: number) {
	return {
		date,
		delay: {
			observation_count: observations,
			in_clamp_observation_count: observations,
			on_time_count: onTime,
			severe_count: 1,
			sum_delay_seconds: observations * 60,
		},
		delay_percentiles: {
			observation_count: observations,
			p50_delay_seconds: 60,
			p90_delay_seconds: 120,
		},
		vehicles: Math.max(1, Math.min(observations, 7)),
		cancellation: {
			canceled_trip_days: 1,
			total_trip_days: observations,
			scheduled_trip_days: observations,
			delivered_trip_days: observations - 1,
			silent_trip_days: 0,
		},
		occupancy: { empty: 1, many_seats: 1, few_seats: 1, standing: 1, full: 1 },
	};
}

const retainedPartitions = [
	{
		generated_utc: '2026-07-13T12:00:00Z' as IsoUtc,
		month: '2026-01',
		days: [retainedDay('2026-01-30', 20, 10), retainedDay('2026-01-31', 10, 2)],
	},
	{
		generated_utc: '2026-07-13T12:00:00Z' as IsoUtc,
		month: '2026-02',
		days: [retainedDay('2026-02-01', 90, 81), retainedDay('2026-02-02', 20, 18)],
	},
] as NetworkHistoryPartition[];

vi.mock('$app/state', () => ({ page: harness.page }));

vi.mock('$lib/site/urlMirror', () => ({
	mirrorSearchParams: harness.mirrorSearchParams,
	mirrorSearchParam: vi.fn(),
}));

vi.mock('$lib/nav', () => ({
	layout: { isDesktop: true },
	openSurface: vi.fn(),
	routeFor: (target: { kind: string; id?: string; search?: string }) => {
		const base =
			target.kind === 'line' && target.id
				? `/lines/${encodeURIComponent(target.id)}`
				: `/${target.kind}`;
		return target.search ? `${base}?${target.search}` : base;
	},
}));

vi.mock('$lib/v1', async () => {
	const history = await import('$lib/v1/history');
	return {
		...history,
		getV1Context: () => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
		createLiveStore: () => ({
			vehicles: null,
			trips: null,
			departures: null,
			alerts: null,
			network: currentNetwork,
			index: {
				vehiclesById: new Map(),
				vehiclesByRoute: new Map(),
				vehiclesByTrip: new Map(),
				stopsById: new Map(),
				tripsById: new Map(),
				alertsById: new Map(),
			},
			generatedUtc: currentNetwork.generated_utc,
			get ageSeconds() {
				return harness.liveClock.ageSeconds;
			},
			isStale: false,
			loading: false,
			error: null,
			start: vi.fn(),
			stop: vi.fn(),
			refresh: vi.fn(),
		}),
		getNetworkTrend: vi.fn(),
		getProvenance: vi.fn(),
		getNetworkHistoryIndex: harness.getNetworkHistoryIndex,
		loadNetworkHistoryRange: harness.loadNetworkHistoryRange,
	};
});

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (loader: () => unknown) => {
		const source = loader.toString();
		const isProvenance = /Provenance|provenance/.test(source);
		return {
			data: isProvenance
				? { conformance: null }
				: {
						series: currentDaily,
						weekly: currentWeekly,
						monthly: currentMonthly,
						by_shift: currentByShift,
						by_daytype: currentByDaytype,
					},
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function trendRows(container: HTMLElement): Element[] {
	const trend = container.querySelector(
		'[data-toc="net-historic"] [data-slot="trend-mark"]',
	) as HTMLElement | null;
	return trend == null ? [] : Array.from(trend.querySelectorAll('table.sr-only tbody tr'));
}

function rowOtp(row: Element): string {
	return row.querySelectorAll('td')[0]?.textContent?.trim() ?? '';
}

beforeEach(() => {
	harness.page.url = new URL('http://localhost/network');
	harness.mirrorSearchParams.mockClear();
	harness.getNetworkHistoryIndex.mockReset();
	harness.loadNetworkHistoryRange.mockReset();
	harness.getNetworkHistoryIndex.mockResolvedValue(historyIndex);
	harness.loadNetworkHistoryRange.mockResolvedValue(retainedPartitions);
});

afterEach(() => {
	cleanup();
	currentDaily.splice(0, currentDaily.length, ...currentDailyOriginal);
});

describe('NetworkSurface retained-history integration', () => {
	it('keeps the default singleton unchanged while discovery never triggers a partition load', async () => {
		const view = render(NetworkSurface);

		await waitFor(() => expect(harness.getNetworkHistoryIndex).toHaveBeenCalledTimes(1));
		expect(harness.loadNetworkHistoryRange).not.toHaveBeenCalled();
		expect(trendRows(view.container)).toHaveLength(2);
		expect(trendRows(view.container).map(rowOtp)).toEqual(['78', '81']);
		const navigator = view.container.querySelector(
			'[data-slot="surface-rail"] [data-slot="history-navigator"]',
		) as HTMLElement;
		expect(
			Array.from(navigator.querySelectorAll<HTMLInputElement>('input[type="date"]')).map(
				(input) => input.value,
			),
		).toEqual(['', '']);
		expect(navigator.querySelector('[data-slot="history-selection"]')).toBeNull();
		expect(
			within(navigator).queryByRole('button', { name: 'Return to current snapshot' }),
		).toBeNull();
	});

	it('does not flash the current historic chart while an explicit deep link is pending', async () => {
		const pending = deferred<NetworkHistoryPartition[]>();
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		harness.loadNetworkHistoryRange.mockReturnValue(pending.promise);
		const view = render(NetworkSurface);

		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(1));
		expect(trendRows(view.container)).toHaveLength(0);
		expect(
			view.container.querySelector('[data-toc="net-historic"] [data-slot="trend-mark"]'),
		).toBeNull();
	});

	it('falls back to the current singleton when optional history discovery is absent', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01&focus=keep');
		harness.getNetworkHistoryIndex.mockResolvedValue(null);
		const view = render(NetworkSurface);

		await waitFor(() => expect(harness.getNetworkHistoryIndex).toHaveBeenCalledTimes(1));
		expect(harness.loadNetworkHistoryRange).not.toHaveBeenCalled();
		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['78', '81']));
		expect(harness.mirrorSearchParams).toHaveBeenCalledWith({
			grain: null,
			from: null,
			to: null,
		});
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		expect(view.container.querySelector('[data-slot="history-navigator"]')).toBeNull();
	});

	it('does not render a false no-observations navigator while discovery is pending', async () => {
		const pending = deferred<HistoricCollectionIndex | null>();
		harness.getNetworkHistoryIndex.mockReturnValue(pending.promise);
		const view = render(NetworkSurface);

		await waitFor(() => expect(harness.getNetworkHistoryIndex).toHaveBeenCalledTimes(1));
		expect(view.container.querySelector('[data-slot="history-navigator"]')).toBeNull();

		pending.resolve(historyIndex);
		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="history-navigator"]')).not.toBeNull(),
		);
	});

	it('keeps the honest empty treatment when discovery returns a real empty index', async () => {
		harness.getNetworkHistoryIndex.mockResolvedValue({
			...historyIndex,
			first_available_date: null,
			last_available_date: null,
			partitions: [],
			metrics: [],
		});
		const view = render(NetworkSurface);

		const navigator = await waitFor(() => {
			const element = view.container.querySelector('[data-slot="history-navigator"]');
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(within(navigator).getByText('No data')).toBeInTheDocument();
		expect(within(navigator).getByText('not enough readings yet')).toBeInTheDocument();
	});

	it('renders exact cross-month days and a weighted retained week, bypassing 7/30/90 slicing', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		const view = render(NetworkSurface);

		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['20', '90']));
		expect(view.queryByRole('radiogroup', { name: 'Trend window' })).toBeNull();

		await fireEvent.click(view.getByRole('radio', { name: 'Week' }));
		await waitFor(() => expect(trendRows(view.container)).toHaveLength(1));
		expect(rowOtp(trendRows(view.container)[0])).toBe('83');
	});

	it('renders one real retained day without fabricating a connecting line', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-01-31');
		harness.loadNetworkHistoryRange.mockResolvedValue([retainedPartitions[0]]);
		const view = render(NetworkSurface);

		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['20']));
	});

	it('preserves the default singleton absence treatment for one coarse point', async () => {
		harness.page.url = new URL('http://localhost/network?grain=month');
		const view = render(NetworkSurface);

		await waitFor(() => expect(harness.getNetworkHistoryIndex).toHaveBeenCalledTimes(1));
		expect(trendRows(view.container)).toHaveLength(0);
	});

	it('labels partial metric coverage and the daily-only/current-only scopes once', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		harness.getNetworkHistoryIndex.mockResolvedValue({
			...historyIndex,
			metrics: [metric('delay', 'additive')],
		});
		harness.loadNetworkHistoryRange.mockResolvedValue(
			retainedPartitions.map((partition) => ({
				...partition,
				days: partition.days.map((day) => ({ date: day.date, delay: day.delay })),
			})) as NetworkHistoryPartition[],
		);
		const view = render(NetworkSurface);

		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['20', '90']));
		expect(view.container.querySelectorAll('[data-slot="history-partial"]')).toHaveLength(1);
		expect(view.container.querySelectorAll('[data-slot="history-daily-only"]')).toHaveLength(1);
		expect(view.container.querySelectorAll('[data-slot="history-current-only"]')).toHaveLength(1);
		const delayGroup = view.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(delayGroup).getByRole('radio', { name: 'Slowest 10%' })).toBeDisabled();
		expect(within(delayGroup).getByRole('radio', { name: 'Average' })).toBeChecked();
		const header = view.container.querySelectorAll(
			'[data-slot="trend-mark"] table.sr-only thead th',
		)[2];
		expect(header).toHaveTextContent('Average delay (min)');
	});

	it('renders independently retained p90 readings when OTP is unavailable', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-01-31');
		harness.getNetworkHistoryIndex.mockResolvedValue({
			...historyIndex,
			first_available_date: '2026-01-31',
			last_available_date: '2026-01-31',
			partitions: [
				{
					...januaryPartitionRef,
					coverage_start: '2026-01-31',
					coverage_end: '2026-01-31',
					count: 1,
				},
			],
			metrics: [coverageMetric('delay_percentiles', 'daily_only', '2026-01-31')],
		});
		harness.loadNetworkHistoryRange.mockResolvedValue([
			{
				...retainedPartitions[0],
				days: [
					{
						date: '2026-01-31',
						delay_percentiles: {
							observation_count: 10,
							p50_delay_seconds: 60,
							p90_delay_seconds: 120,
						},
					},
				],
			},
		] as NetworkHistoryPartition[]);
		const view = render(NetworkSurface);

		await waitFor(() => expect(trendRows(view.container)).toHaveLength(1));
		const figure = view.container.querySelector('[data-slot="trend-mark"]') as HTMLElement;
		const headers = figure.querySelectorAll('table.sr-only thead th');
		expect(headers[1]).toHaveTextContent('Slowest 10% (min)');
		expect(headers).toHaveLength(2);
		expect(trendRows(view.container)[0].querySelectorAll('td')[0]).toHaveTextContent('2');
		expect(figure.querySelector('caption')).toHaveTextContent('Chosen daily delay series');
		const delayGroup = view.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(delayGroup).getByRole('radio', { name: 'Slowest 10%' })).toBeChecked();
		expect(within(delayGroup).getByRole('radio', { name: 'Average' })).toBeDisabled();
		await fireEvent.click(view.getByRole('button', { name: 'About Daily trend' }));
		expect(view.getByRole('link', { name: /How this is measured/ })).toHaveAttribute(
			'href',
			'/metrics#p50-p90',
		);
	});

	it('hides the delay-series control for a retained vehicles-only range', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-30&to=2026-01-31');
		harness.getNetworkHistoryIndex.mockResolvedValue({
			...historyIndex,
			first_available_date: '2026-01-30',
			last_available_date: '2026-01-31',
			partitions: [januaryPartitionRef],
			metrics: [
				{
					...coverageMetric('vehicles', 'daily_only', '2026-01-30'),
					last_available_date: '2026-01-31',
				},
			],
		});
		harness.loadNetworkHistoryRange.mockResolvedValue([
			{
				...retainedPartitions[0],
				days: [
					{ date: '2026-01-30', vehicles: 6 },
					{ date: '2026-01-31', vehicles: 7 },
				],
			},
		] as NetworkHistoryPartition[]);
		const view = render(NetworkSurface);

		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="vehicles-reporting-row"]')).not.toBeNull(),
		);
		expect(view.queryByRole('radiogroup', { name: 'Delay series' })).toBeNull();
	});

	it('restores the richest current window after clearing a short retained deep link', async () => {
		currentDaily.splice(0, currentDaily.length, ...currentDays(90));
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-01-31');
		harness.loadNetworkHistoryRange.mockResolvedValue([retainedPartitions[0]]);
		const view = render(NetworkSurface);

		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['20']));
		const navigator = view.container.querySelector(
			'[data-slot="surface-rail"] [data-slot="history-navigator"]',
		) as HTMLElement;
		await fireEvent.click(
			within(navigator).getByRole('button', { name: 'Return to current snapshot' }),
		);

		const windowGroup = await view.findByRole('radiogroup', { name: 'Trend window' });
		expect(within(windowGroup).getByRole('radio', { name: '90d' })).toBeChecked();
		await waitFor(() => expect(trendRows(view.container)).toHaveLength(90));
	});

	it('does not let an interactive retained range clamp the seeded current window', async () => {
		currentDaily.splice(0, currentDaily.length, ...currentDays(90));
		harness.loadNetworkHistoryRange.mockResolvedValue([retainedPartitions[0]]);
		const view = render(NetworkSurface);
		const initialWindow = await view.findByRole('radiogroup', { name: 'Trend window' });
		expect(within(initialWindow).getByRole('radio', { name: '90d' })).toBeChecked();

		const navigator = view.container.querySelector(
			'[data-slot="surface-rail"] [data-slot="history-navigator"]',
		) as HTMLElement;
		const inputs = navigator.querySelectorAll<HTMLInputElement>('input[type="date"]');
		await fireEvent.change(inputs[0], { target: { value: '2026-01-31' } });
		await fireEvent.change(inputs[1], { target: { value: '2026-01-31' } });
		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['20']));

		await fireEvent.click(
			within(navigator).getByRole('button', { name: 'Return to current snapshot' }),
		);
		const restoredWindow = await view.findByRole('radiogroup', { name: 'Trend window' });
		expect(within(restoredWindow).getByRole('radio', { name: '90d' })).toBeChecked();
		await waitFor(() => expect(trendRows(view.container)).toHaveLength(90));
	});

	it('renders an honest retained no-data state instead of fabricating zero-valued days', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		harness.loadNetworkHistoryRange.mockResolvedValue(
			retainedPartitions.map((partition) => ({
				...partition,
				days: partition.days.map((day) => ({ date: day.date })),
			})) as NetworkHistoryPartition[],
		);
		const view = render(NetworkSurface);

		await waitFor(() =>
			expect(view.container.querySelector('[data-slot="history-no-data"]')).toHaveTextContent(
				'No data is retained for this range.',
			),
		);
		expect(trendRows(view.container)).toHaveLength(0);
		expect(view.queryByRole('radiogroup', { name: 'Delay series' })).toBeNull();
	});

	it('seats the controlled navigator in the one SurfaceRail and its one mobile sheet', async () => {
		const view = render(NetworkSurface);
		await waitFor(() => expect(harness.getNetworkHistoryIndex).toHaveBeenCalledTimes(1));

		const rail = view.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(view.container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		expect(within(rail).getByRole('region', { name: /history/i })).toHaveAttribute(
			'data-slot',
			'history-navigator',
		);

		const mobile = view.container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(within(mobile).getByRole('button'));
		const dialog = within(mobile).getByRole('dialog');
		expect(within(dialog).getByRole('region', { name: /history/i })).toHaveAttribute(
			'data-slot',
			'history-navigator',
		);
		expect(
			view.container.querySelectorAll('[data-slot="surface-rail-mobile"] [role="dialog"]'),
		).toHaveLength(1);
	});

	it('batches grain/from/to ownership and preserves unrelated query parameters', async () => {
		harness.page.url = new URL(
			'http://localhost/network?grain=week&from=2026-01-31&to=2026-02-01&focus=keep',
		);
		const view = render(NetworkSurface);
		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(1));
		harness.mirrorSearchParams.mockClear();

		const rail = view.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const navigator = rail.querySelector('[data-slot="history-navigator"]') as HTMLElement;
		const inputs = navigator.querySelectorAll<HTMLInputElement>('input[type="date"]');
		expect(inputs).toHaveLength(2);
		await fireEvent.change(inputs[0], { target: { value: '2026-01-30' } });

		await waitFor(() =>
			expect(harness.mirrorSearchParams).toHaveBeenLastCalledWith({
				grain: 'week',
				from: '2026-01-30',
				to: '2026-02-01',
			}),
		);
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
	});

	it('corrects an invalid pair to current without loading a fallback retained window', async () => {
		harness.page.url = new URL(
			'http://localhost/network?grain=month&from=bad&to=2026-02-01&focus=keep',
		);
		const view = render(NetworkSurface);

		await waitFor(() => expect(harness.getNetworkHistoryIndex).toHaveBeenCalledTimes(1));
		expect(harness.loadNetworkHistoryRange).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(harness.mirrorSearchParams).toHaveBeenCalledWith({
				grain: 'month',
				from: null,
				to: null,
			}),
		);
		expect(harness.page.url.searchParams.get('focus')).toBe('keep');
		expect(trendRows(view.container)).toHaveLength(0);
		const announcement = view.container.querySelector(
			'[data-slot="history-page-announcement"]',
		) as HTMLElement;
		expect(announcement).toHaveAttribute('role', 'status');
		expect(announcement).toHaveAttribute('aria-live', 'polite');
		expect(announcement).toHaveTextContent(
			'The invalid date range was replaced with the current snapshot.',
		);
		for (const duplicate of view.container.querySelectorAll('[data-slot="history-announcement"]')) {
			expect(duplicate).not.toHaveAttribute('role');
			expect(duplicate).not.toHaveAttribute('aria-live');
		}
	});

	it('announces the same correction again after a valid range is selected', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		const view = render(NetworkSurface);
		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(1));
		const announcement = view.container.querySelector(
			'[data-slot="history-page-announcement"]',
		) as HTMLElement;
		const navigator = view.container.querySelector(
			'[data-slot="surface-rail"] [data-slot="history-navigator"]',
		) as HTMLElement;
		const inputs = navigator.querySelectorAll<HTMLInputElement>('input[type="date"]');

		await fireEvent.change(inputs[0], { target: { value: '2025-01-01' } });
		await waitFor(() =>
			expect(announcement).toHaveTextContent(
				'The unavailable date range was replaced with the current snapshot.',
			),
		);

		await fireEvent.change(inputs[0], { target: { value: '2026-01-31' } });
		await fireEvent.change(inputs[1], { target: { value: '2026-02-01' } });
		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(2));
		expect(announcement).toHaveTextContent('');

		await fireEvent.change(inputs[0], { target: { value: '2025-01-01' } });
		await waitFor(() =>
			expect(announcement).toHaveTextContent(
				'The unavailable date range was replaced with the current snapshot.',
			),
		);
	});

	it('never propagates the retained query onto line or map destinations', async () => {
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		const view = render(NetworkSurface);
		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(1));

		for (const link of view.container.querySelectorAll<HTMLAnchorElement>(
			'a[href^="/lines/"], a[href^="/map"]',
		)) {
			expect(link.href).not.toMatch(/[?&](?:from|to)=/);
		}
		expect(view.getByRole('link', { name: 'View line 51' })).toHaveAttribute('href', '/lines/51');
	});

	it('aborts a superseded range and ignores its late result', async () => {
		const first = deferred<NetworkHistoryPartition[]>();
		const second = deferred<NetworkHistoryPartition[]>();
		const signals: AbortSignal[] = [];
		harness.page.url = new URL('http://localhost/network?from=2026-01-31&to=2026-02-01');
		harness.loadNetworkHistoryRange
			.mockImplementationOnce((_index, _window, context) => {
				signals.push(context.signal);
				return first.promise;
			})
			.mockImplementationOnce((_index, _window, context) => {
				signals.push(context.signal);
				return second.promise;
			});
		const view = render(NetworkSurface);
		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(1));

		const navigator = view.container.querySelector(
			'[data-slot="surface-rail"] [data-slot="history-navigator"]',
		) as HTMLElement;
		const start = navigator.querySelectorAll<HTMLInputElement>('input[type="date"]')[0];
		await fireEvent.change(start, { target: { value: '2026-01-30' } });
		await waitFor(() => expect(harness.loadNetworkHistoryRange).toHaveBeenCalledTimes(2));
		expect(signals[0].aborted).toBe(true);

		const replacement = retainedPartitions.map((partition) => ({
			...partition,
			days: partition.days.map((day) => retainedDay(day.date, 10, 0)),
		}));
		second.resolve(replacement);
		await waitFor(() => expect(trendRows(view.container).map(rowOtp)).toEqual(['0', '0', '0']));

		first.resolve(retainedPartitions);
		await Promise.resolve();
		expect(trendRows(view.container).map(rowOtp)).toEqual(['0', '0', '0']);
	});
});

describe('Network retained-history copy', () => {
	it('defines honest partial, no-data, and current-only messages in English and French', () => {
		const en = networkReliabilityCopy.en as unknown as NetworkReliabilityCopyWithHistory;
		const fr = networkReliabilityCopy.fr as unknown as NetworkReliabilityCopyWithHistory;

		expect(en.history.partial).toMatch(/partial|coverage/i);
		expect(en.history.noData).toMatch(/no data/i);
		expect(en.history.currentOnly).toMatch(/current|live/i);
		expect(en.history.currentOnly).not.toMatch(/\blive\b/i);
		expect(en.trend.retardAvg).toBe('Average');
		expect(en.trend.retardAvgLabel).toBe('Average delay (min)');
		expect(en.trend.delayOnlySummary).not.toMatch(/on-time/i);
		expect(en.trend.onTimeOnlySummary).not.toMatch(/delay/i);
		expect(fr.history.partial).toMatch(/partiel|couverture/i);
		expect(fr.history.noData).toMatch(/aucune donnée/i);
		expect(fr.history.currentOnly).toMatch(/actuel|direct/i);
		expect(fr.trend.retardAvg).toBe('Moyen');
		expect(fr.trend.retardAvgLabel).toBe('Retard moyen (min)');
		expect(fr.trend.delayOnlySummary).not.toMatch(/ponctualité/i);
		expect(fr.trend.onTimeOnlySummary).not.toMatch(/retard/i);
	});
});

interface NetworkReliabilityCopyWithHistory {
	readonly trend: {
		readonly retardAvg: string;
		readonly retardAvgLabel: string;
		readonly delayOnlySummary: string;
		readonly onTimeOnlySummary: string;
	};
	readonly history: {
		readonly partial: string;
		readonly noData: string;
		readonly currentOnly: string;
	};
}
