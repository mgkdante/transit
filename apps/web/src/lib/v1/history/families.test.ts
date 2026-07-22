import { describe, expect, it } from 'vitest';
import type { DateWindow } from '$lib/v1/history';
import {
	HistoricCollectionIndexSchema,
	LineHistoryPartitionSchema,
	NetworkHistoryPartitionSchema,
	StopHistoryPartitionSchema,
	type HistoricCollectionIndex,
	type HistoricMetricCoverage,
	type HistoricPartitionRef,
	type LineHistoryPartition,
	type NetworkHistoryPartition,
	type StopHistoryPartition,
} from '$lib/v1/schemas';
import { HistoryArtifactContractError } from './partitions';
import {
	LINE_CURRENT_ONLY_SECTIONS,
	NETWORK_CURRENT_ONLY_SECTIONS,
	STOP_CURRENT_ONLY_SECTIONS,
	mergeLineHistory,
	mergeNetworkHistory,
	mergeStopHistory,
	selectLineHistoryPartitionRefs,
	selectNetworkHistoryPartitionRefs,
	selectStopHistoryPartitionRefs,
	validateLineHistoryPartition,
	validateNetworkHistoryPartition,
	validateStopHistoryPartition,
} from './index';

const ISO = '2026-03-31T12:00:00Z';
const COLLECTION_GENERATION = 'c'.repeat(64);
const FULL_WINDOW: DateWindow = { from: '2026-01-31', to: '2026-02-01' };

function metric(
	metricName: HistoricMetricCoverage['metric'],
	aggregation: HistoricMetricCoverage['aggregation'],
	first = FULL_WINDOW.from,
	last = FULL_WINDOW.to,
	gaps: HistoricMetricCoverage['gaps'] = [],
): HistoricMetricCoverage {
	return {
		metric: metricName,
		aggregation,
		first_available_date: first,
		last_available_date: last,
		gaps,
	};
}

const NETWORK_METRICS: HistoricMetricCoverage[] = [
	metric('delay', 'additive'),
	metric('delay_percentiles', 'daily_only'),
	metric('vehicles', 'daily_only'),
	metric('cancellation', 'additive'),
	metric('occupancy', 'additive'),
];

const LINE_METRICS: HistoricMetricCoverage[] = [
	metric('delay', 'additive'),
	metric('delay_percentiles', 'daily_only'),
	metric('cancellation', 'additive'),
	metric('occupancy', 'additive'),
	metric('service_span', 'daily_only'),
	metric('skipped_stops', 'additive'),
];

const STOP_METRICS: HistoricMetricCoverage[] = [
	metric('delay', 'additive'),
	metric('delay_percentiles', 'daily_only'),
	metric('occupancy', 'additive'),
];

function partitionRef(
	family: 'network' | 'lines' | 'stops',
	month: string,
	shaCharacter: string,
	entityId?: string,
): HistoricPartitionRef {
	const sha = shaCharacter.repeat(64);
	const coverageDate =
		month === FULL_WINDOW.from.slice(0, 7)
			? FULL_WINDOW.from
			: month === FULL_WINDOW.to.slice(0, 7)
				? FULL_WINDOW.to
				: `${month}-01`;
	const entitySegment =
		family === 'network'
			? ''
			: `${new TextEncoder()
					.encode(entityId ?? '')
					.reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '')}/`;
	return {
		path: `historic/history/${family}/${entitySegment}generations/${sha}/${month}.json`,
		coverage_start: coverageDate,
		coverage_end: coverageDate,
		count: 1,
		sha256: sha,
		byte_size: 100,
	};
}

function collectionIndex(
	family: 'network' | 'lines' | 'stops',
	entityId: string | null,
	partitions: HistoricPartitionRef[],
	metrics: HistoricMetricCoverage[],
): HistoricCollectionIndex {
	const coverageStarts = partitions.map((ref) => ref.coverage_start).sort();
	const coverageEnds = partitions.map((ref) => ref.coverage_end).sort();
	return HistoricCollectionIndexSchema.parse({
		generated_utc: ISO,
		family,
		selection_mode: 'range',
		entity_id: entityId,
		collection_generation_id: COLLECTION_GENERATION,
		first_available_date: coverageStarts[0] ?? null,
		last_available_date: coverageEnds.at(-1) ?? null,
		gaps: [],
		partitions,
		metrics,
	});
}

function reducerIndex(
	family: 'network' | 'lines' | 'stops',
	entityId: string | null,
	months: string[],
	metrics: HistoricMetricCoverage[],
): HistoricCollectionIndex {
	return collectionIndex(
		family,
		entityId,
		months.map((month, index) =>
			partitionRef(family, month, ((index % 9) + 1).toString(16), entityId ?? undefined),
		),
		metrics,
	);
}

function networkPartition(
	month: string,
	days: Array<Record<string, unknown>>,
): NetworkHistoryPartition {
	return NetworkHistoryPartitionSchema.parse({ generated_utc: ISO, month, days });
}

function linePartition(
	entityId: string,
	month: string,
	days: Array<Record<string, unknown>>,
): LineHistoryPartition {
	return LineHistoryPartitionSchema.parse({ generated_utc: ISO, month, entity_id: entityId, days });
}

function stopPartition(
	entityId: string,
	month: string,
	days: Array<Record<string, unknown>>,
): StopHistoryPartition {
	return StopHistoryPartitionSchema.parse({ generated_utc: ISO, month, entity_id: entityId, days });
}

describe('exact retained-family partition discovery', () => {
	it('accepts exact network/line/stop paths, awkward UTF-8 IDs, and sorts selected refs by month', () => {
		const networkJanuary = partitionRef('network', '2026-01', 'a');
		const networkFebruary = partitionRef('network', '2026-02', 'b');
		const lineJanuary = partitionRef('lines', '2026-01', 'a', 'A/B');
		const stopFebruary = partitionRef('stops', '2026-02', 'b', '..');

		expect(
			selectNetworkHistoryPartitionRefs(
				collectionIndex('network', null, [networkFebruary, networkJanuary], NETWORK_METRICS),
				FULL_WINDOW,
			).map((ref) => ref.path),
		).toEqual([networkJanuary.path, networkFebruary.path]);
		expect(
			selectLineHistoryPartitionRefs(
				'A/B',
				collectionIndex(
					'lines',
					'A/B',
					[lineJanuary],
					LINE_METRICS.map((coverage) => ({
						...coverage,
						last_available_date: '2026-01-31',
					})),
				),
				{ from: '2026-01-01', to: '2026-01-31' },
			)[0]?.path,
		).toContain('/412f42/generations/');
		expect(
			selectStopHistoryPartitionRefs(
				'..',
				collectionIndex(
					'stops',
					'..',
					[stopFebruary],
					STOP_METRICS.map((coverage) => ({
						...coverage,
						first_available_date: '2026-02-01',
					})),
				),
				{ from: '2026-02-01', to: '2026-02-28' },
			)[0]?.path,
		).toContain('/2e2e/generations/');
	});

	it.each([
		'https://evil.test/file.json',
		'//evil.test/file.json',
		'/historic/history/network/generations/' + 'a'.repeat(64) + '/2026-01.json',
		'historic\\history\\network\\generations\\' + 'a'.repeat(64) + '\\2026-01.json',
		'historic/history/network/generations/' + 'a'.repeat(64) + '/2026-01.json?raw=1',
		'historic/history/network/generations/' + 'a'.repeat(64) + '/2026-01.json#x',
		'historic/history/network/generations/' + 'a'.repeat(64) + '/../2026-01.json',
		'historic/history/network/generations/' + 'a'.repeat(64) + '/%2e%2e.json',
		'historic/history/network/generations/' + 'A'.repeat(64) + '/2026-01.json',
		'historic/history/network/generations/' + 'a'.repeat(64) + '/2026-13.json',
	])('rejects a non-contract family path before selection: %s', (unsafePath) => {
		const advertised = { ...partitionRef('network', '2026-01', 'a'), path: unsafePath };
		const index = collectionIndex('network', null, [advertised], NETWORK_METRICS);

		expect(() =>
			selectNetworkHistoryPartitionRefs(index, { from: '2026-01-01', to: '2026-01-31' }),
		).toThrowError(HistoryArtifactContractError);
	});

	it('requires exact SHA/path/coverage metadata and safe additive integers', () => {
		const valid = partitionRef('network', '2026-01', 'a');
		const variants = [
			{ ...valid, sha256: 'b'.repeat(64) },
			{ ...valid, coverage_start: '2025-12-31' },
			{ ...valid, coverage_end: '2026-02-01' },
			{ ...valid, count: Number.MAX_SAFE_INTEGER + 1 },
			{ ...valid, byte_size: Number.MAX_SAFE_INTEGER + 1 },
		];

		for (const advertised of variants) {
			const index = {
				...collectionIndex('network', null, [], NETWORK_METRICS),
				partitions: [advertised],
			} as HistoricCollectionIndex;
			expect(() =>
				selectNetworkHistoryPartitionRefs(index, {
					from: '2026-01-01',
					to: '2026-01-31',
				}),
			).toThrowError(HistoryArtifactContractError);
		}
	});

	it('rejects duplicate paths or duplicate months instead of silently deduplicating', () => {
		const januaryA = partitionRef('network', '2026-01', 'a');
		const januaryB = partitionRef('network', '2026-01', 'b');

		for (const refs of [
			[januaryA, { ...januaryA }],
			[januaryA, januaryB],
		]) {
			const index = collectionIndex('network', null, refs, NETWORK_METRICS);
			expect(() =>
				selectNetworkHistoryPartitionRefs(index, {
					from: '2026-01-01',
					to: '2026-01-31',
				}),
			).toThrowError(HistoryArtifactContractError);
		}
	});

	it('rejects malformed collection coverage before selecting a partition', () => {
		const ref = {
			...partitionRef('network', '2026-01', 'a'),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const valid = collectionIndex(
			'network',
			null,
			[ref],
			[metric('delay', 'additive', '2026-01-31', '2026-01-31')],
		);
		const invalid = [
			{ ...valid, first_available_date: 'not-a-date' },
			{ ...valid, last_available_date: null },
			{ ...valid, first_available_date: '2026-02-01' },
			{ ...valid, first_available_date: '2026-01-30' },
			{
				...valid,
				gaps: [{ start_date: '2026-01-30', end_date: '2026-01-30' }],
			},
			{
				...valid,
				gaps: [
					{ start_date: '2026-01-31', end_date: '2026-01-31' },
					{ start_date: '2026-01-31', end_date: '2026-01-31' },
				],
			},
			{
				...valid,
				partitions: [],
				first_available_date: '2026-01-31',
				last_available_date: '2026-01-31',
			},
			{
				...collectionIndex(
					'network',
					null,
					[],
					[metric('delay', 'additive', '2026-01-31', '2026-01-31')],
				),
			},
			{
				...valid,
				metrics: [metric('delay', 'additive', '2026-01-30', '2026-01-31')],
			},
		] as HistoricCollectionIndex[];

		for (const index of invalid) {
			expect(() =>
				selectNetworkHistoryPartitionRefs(index, {
					from: '2026-01-31',
					to: '2026-01-31',
				}),
			).toThrowError(HistoryArtifactContractError);
		}
	});

	it('selects only inclusive coverage intersections after validating the full index', () => {
		const january = partitionRef('network', '2026-01', 'a');
		const february = partitionRef('network', '2026-02', 'b');
		const index = collectionIndex('network', null, [january, february], NETWORK_METRICS);

		expect(
			selectNetworkHistoryPartitionRefs(index, {
				from: '2026-02-01',
				to: '2026-02-01',
			}),
		).toEqual([february]);
	});
});

describe('exact ref-to-payload validation', () => {
	it('cross-checks family, entity, month, count, coverage, and additive ingredients', () => {
		const lineId = 'A/B';
		const ref = {
			...partitionRef('lines', '2026-01', 'a', lineId),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const index = collectionIndex(
			'lines',
			lineId,
			[ref],
			LINE_METRICS.map((coverage) => ({
				...coverage,
				last_available_date: '2026-01-31',
			})),
		);
		const value = linePartition(lineId, '2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 8,
					on_time_count: 6,
					severe_count: 1,
					sum_delay_seconds: 80,
				},
			},
		]);

		expect(validateLineHistoryPartition(lineId, index, ref, value)).toBe(value);
		expect(() => validateLineHistoryPartition('other', index, ref, value)).toThrowError(
			HistoryArtifactContractError,
		);
		expect(() =>
			validateLineHistoryPartition(lineId, index, ref, { ...value, entity_id: 'other' }),
		).toThrowError(HistoryArtifactContractError);
		expect(() =>
			validateLineHistoryPartition(lineId, index, { ...ref, count: 2 }, value),
		).toThrowError(HistoryArtifactContractError);
	});

	it('rejects same-path ref metadata that differs from the collection index', () => {
		const advertised = {
			...partitionRef('network', '2026-01', 'a'),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const index = collectionIndex(
			'network',
			null,
			[advertised],
			[metric('delay', 'additive', '2026-01-30', '2026-01-31')],
		);
		const altered = {
			...advertised,
			coverage_start: '2026-01-30',
			count: 2,
			byte_size: 200,
		};
		const value = networkPartition('2026-01', [
			{
				date: '2026-01-30',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 8,
					on_time_count: 6,
					severe_count: 1,
					sum_delay_seconds: 80,
				},
			},
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 8,
					on_time_count: 6,
					severe_count: 1,
					sum_delay_seconds: 80,
				},
			},
		]);

		expect(() => validateNetworkHistoryPartition(index, altered, value)).toThrowError(
			HistoryArtifactContractError,
		);
	});

	it('uses family-specific delay requirements and rejects loaded metric dates outside coverage', () => {
		const networkRef = {
			...partitionRef('network', '2026-01', 'a'),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const networkIndex = collectionIndex(
			'network',
			null,
			[networkRef],
			[metric('delay', 'additive', '2026-01-31', '2026-01-31')],
		);
		const missingOtp = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 8,
					severe_count: 1,
					sum_delay_seconds: 80,
				},
			},
		]);
		expect(() =>
			validateNetworkHistoryPartition(networkIndex, networkRef, missingOtp),
		).toThrowError(HistoryArtifactContractError);

		const stopId = 'stop/é';
		const stopRef = {
			...partitionRef('stops', '2026-01', 'b', stopId),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const stopIndex = collectionIndex(
			'stops',
			stopId,
			[stopRef],
			[metric('delay', 'additive', '2026-02-01', '2026-02-01')],
		);
		const stopValue = stopPartition(stopId, '2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 8,
					severe_count: 1,
					sum_delay_seconds: 80,
				},
			},
		]);
		expect(() => validateStopHistoryPartition(stopId, stopIndex, stopRef, stopValue)).toThrowError(
			HistoryArtifactContractError,
		);
	});

	it('rejects unsafe integer precision in loaded additive counts and sums', () => {
		const ref = {
			...partitionRef('network', '2026-01', 'a'),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const index = collectionIndex(
			'network',
			null,
			[ref],
			[metric('delay', 'additive', '2026-01-31', '2026-01-31')],
		);
		const unsafe = {
			generated_utc: ISO,
			month: '2026-01',
			days: [
				{
					date: '2026-01-31',
					delay: {
						observation_count: Number.MAX_SAFE_INTEGER + 1,
						in_clamp_observation_count: 8,
						on_time_count: 6,
						severe_count: 1,
						sum_delay_seconds: 80,
					},
				},
			],
		} as NetworkHistoryPartition;

		expect(() => validateNetworkHistoryPartition(index, ref, unsafe)).toThrowError(
			HistoryArtifactContractError,
		);
	});

	it('rejects Stop delay when in-clamp observations do not equal the observed population', () => {
		const stopId = 'stop/é';
		const ref = {
			...partitionRef('stops', '2026-01', 'a', stopId),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const index = collectionIndex(
			'stops',
			stopId,
			[ref],
			[metric('delay', 'additive', '2026-01-31', '2026-01-31')],
		);
		const value = stopPartition(stopId, '2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 8,
					severe_count: 1,
					sum_delay_seconds: 80,
				},
			},
		]);

		expect(() => validateStopHistoryPartition(stopId, index, ref, value)).toThrowError(
			HistoryArtifactContractError,
		);
	});
});

describe('pure retained-family reducers', () => {
	it('keeps ghost-only route delay rates real without fabricating an average', () => {
		const ref = {
			...partitionRef('network', '2026-01', 'a'),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const index = collectionIndex(
			'network',
			null,
			[ref],
			[metric('delay', 'additive', '2026-01-31', '2026-01-31')],
		);
		const partition = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 3,
					in_clamp_observation_count: null,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: null,
				},
			},
		]);

		expect(
			mergeNetworkHistory(index, [partition], {
				from: '2026-01-31',
				to: '2026-01-31',
			}).delay,
		).toEqual({
			status: 'complete',
			value: {
				observationCount: 3,
				inClampObservationCount: null,
				onTimeCount: 0,
				severeCount: 0,
				sumDelaySeconds: null,
				otpPct: 0,
				severePct: 0,
				averageDelaySeconds: null,
			},
		});
	});

	it('pools ghost-only and in-clamp route days without erasing the real average', () => {
		const index = reducerIndex(
			'network',
			null,
			['2026-01', '2026-02'],
			[metric('delay', 'additive')],
		);
		const january = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 3,
					in_clamp_observation_count: null,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: null,
				},
			},
		]);
		const february = networkPartition('2026-02', [
			{
				date: '2026-02-01',
				delay: {
					observation_count: 2,
					in_clamp_observation_count: 2,
					on_time_count: 1,
					severe_count: 1,
					sum_delay_seconds: 60,
				},
			},
		]);

		expect(mergeNetworkHistory(index, [january, february], FULL_WINDOW).delay).toEqual({
			status: 'complete',
			value: {
				observationCount: 5,
				inClampObservationCount: 2,
				onTimeCount: 1,
				severeCount: 1,
				sumDelaySeconds: 60,
				otpPct: 20,
				severePct: 20,
				averageDelaySeconds: 30,
			},
		});
	});

	it('rejects a missing intersecting advertised partition before claiming complete coverage', () => {
		const januaryRef = {
			...partitionRef('network', '2026-01', 'a'),
			coverage_start: '2026-01-31',
			coverage_end: '2026-01-31',
		};
		const februaryRef = {
			...partitionRef('network', '2026-02', 'b'),
			coverage_start: '2026-02-01',
			coverage_end: '2026-02-01',
		};
		const index = collectionIndex(
			'network',
			null,
			[januaryRef, februaryRef],
			[metric('delay', 'additive', '2026-01-31', '2026-02-01')],
		);
		const january = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 8,
					severe_count: 1,
					sum_delay_seconds: 100,
				},
			},
		]);

		expect(() => mergeNetworkHistory(index, [january], FULL_WINDOW)).toThrowError(
			HistoryArtifactContractError,
		);
	});

	it('rejects pooled additive totals that cross safe integer precision', () => {
		const index = reducerIndex(
			'network',
			null,
			['2026-01', '2026-02'],
			[metric('delay', 'additive')],
		);
		const january = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: Number.MAX_SAFE_INTEGER,
					in_clamp_observation_count: 1,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: 0,
				},
			},
		]);
		const february = networkPartition('2026-02', [
			{
				date: '2026-02-01',
				delay: {
					observation_count: 1,
					in_clamp_observation_count: 1,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: 0,
				},
			},
		]);

		expect(() => mergeNetworkHistory(index, [january, february], FULL_WINDOW)).toThrowError(
			HistoryArtifactContractError,
		);
	});

	it('pools network additive ingredients across months and keeps daily-only values exact', () => {
		const index = reducerIndex('network', null, ['2026-01', '2026-02'], NETWORK_METRICS);
		const january = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 100,
					in_clamp_observation_count: 90,
					on_time_count: 72,
					severe_count: 9,
					sum_delay_seconds: 900,
				},
				delay_percentiles: {
					observation_count: 10,
					p50_delay_seconds: 5,
					p90_delay_seconds: 40,
				},
				vehicles: 5,
				cancellation: {
					canceled_trip_days: 1,
					total_trip_days: 20,
					scheduled_trip_days: 22,
					delivered_trip_days: 19,
					silent_trip_days: 2,
				},
				occupancy: { empty: 1, many_seats: 2, few_seats: 3, standing: 4, full: 0 },
			},
		]);
		const february = networkPartition('2026-02', [
			{
				date: '2026-02-01',
				delay: {
					observation_count: 50,
					in_clamp_observation_count: 10,
					on_time_count: 5,
					severe_count: 2,
					sum_delay_seconds: 300,
				},
				delay_percentiles: {
					observation_count: 12,
					p50_delay_seconds: 7,
					p90_delay_seconds: 60,
				},
				vehicles: 7,
				cancellation: {
					canceled_trip_days: 0,
					total_trip_days: 0,
					scheduled_trip_days: 10,
					delivered_trip_days: 0,
					silent_trip_days: 10,
				},
				occupancy: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 10 },
			},
		]);

		const result = mergeNetworkHistory(index, [february, january], FULL_WINDOW);

		expect(result.delay).toEqual({
			status: 'complete',
			value: {
				observationCount: 150,
				inClampObservationCount: 100,
				onTimeCount: 77,
				severeCount: 11,
				sumDelaySeconds: 1200,
				otpPct: (100 * 77) / 150,
				severePct: (100 * 11) / 150,
				averageDelaySeconds: 12,
			},
		});
		expect(result.cancellation).toEqual({
			status: 'complete',
			value: {
				canceledTripDays: 1,
				totalTripDays: 20,
				cancellationRatePct: 5,
				scheduledTripDays: 32,
				deliveredTripDays: 19,
				silentTripDays: 12,
				completenessPct: 59.375,
			},
		});
		expect(result.occupancy).toEqual({
			status: 'complete',
			value: {
				counts: { empty: 1, many_seats: 2, few_seats: 3, standing: 4, full: 10 },
				totalCount: 20,
				mix: { empty: 0.05, many_seats: 0.1, few_seats: 0.15, standing: 0.2, full: 0.5 },
			},
		});
		expect(result.delayPercentiles.value).toEqual([
			{
				date: '2026-01-31',
				value: { observation_count: 10, p50_delay_seconds: 5, p90_delay_seconds: 40 },
			},
			{
				date: '2026-02-01',
				value: { observation_count: 12, p50_delay_seconds: 7, p90_delay_seconds: 60 },
			},
		]);
		expect(result.vehicles.value).toEqual([
			{ date: '2026-01-31', value: 5 },
			{ date: '2026-02-01', value: 7 },
		]);
	});

	it('keeps line service-span rows exact and pools skipped-stop counts with real zero numerators', () => {
		const lineId = '747';
		const index = reducerIndex('lines', lineId, ['2026-01', '2026-02'], LINE_METRICS);
		const januarySpan = {
			trip_count: 3,
			first_trip_utc: '2026-01-31T05:00:00Z',
			last_trip_utc: '2026-01-31T23:00:00Z',
			first_trip_delay_seconds: 0,
			last_trip_delay_seconds: 60,
		};
		const februarySpan = {
			trip_count: 4,
			first_trip_utc: '2026-02-01T05:10:00Z',
			last_trip_utc: '2026-02-01T22:40:00Z',
			first_trip_delay_seconds: -10,
			last_trip_delay_seconds: 30,
		};
		const partitions = [
			linePartition(lineId, '2026-02', [
				{
					date: '2026-02-01',
					service_span: februarySpan,
					skipped_stops: { skipped_stop_count: 2, stop_time_update_count: 10 },
				},
			]),
			linePartition(lineId, '2026-01', [
				{
					date: '2026-01-31',
					service_span: januarySpan,
					skipped_stops: { skipped_stop_count: 0, stop_time_update_count: 10 },
				},
			]),
		];

		const result = mergeLineHistory(lineId, index, partitions, FULL_WINDOW);

		expect(result.serviceSpan).toEqual({
			status: 'complete',
			value: [
				{ date: '2026-01-31', value: januarySpan },
				{ date: '2026-02-01', value: februarySpan },
			],
		});
		expect(result.skippedStops).toEqual({
			status: 'complete',
			value: { skippedStopCount: 2, stopTimeUpdateCount: 20, skippedStopRatePct: 10 },
		});
	});

	it('pools stop severe-delay ingredients without inventing route OTP', () => {
		const stopId = 'stop/é';
		const index = reducerIndex('stops', stopId, ['2026-01', '2026-02'], STOP_METRICS);
		const partitions = [
			stopPartition(stopId, '2026-01', [
				{
					date: '2026-01-31',
					delay: {
						observation_count: 20,
						in_clamp_observation_count: 20,
						severe_count: 2,
						sum_delay_seconds: 100,
					},
				},
			]),
			stopPartition(stopId, '2026-02', [
				{
					date: '2026-02-01',
					delay: {
						observation_count: 10,
						in_clamp_observation_count: 10,
						severe_count: 0,
						sum_delay_seconds: 25,
					},
				},
			]),
		];

		const result = mergeStopHistory(stopId, index, partitions, FULL_WINDOW);

		expect(result.delay).toEqual({
			status: 'complete',
			value: {
				observationCount: 30,
				inClampObservationCount: 30,
				severeCount: 2,
				sumDelaySeconds: 125,
				severePct: 100 / 15,
				averageDelaySeconds: 125 / 30,
			},
		});
		expect(result.delay.value).not.toHaveProperty('otpPct');
	});

	it('classifies coverage honestly, keeps sparse days absent, and declares current-only sections', () => {
		const partialMetrics = [
			metric('delay', 'additive', '2026-01-31', '2026-01-31'),
			metric('delay_percentiles', 'daily_only', '2026-01-31', '2026-01-31'),
		];
		const index = reducerIndex('network', null, ['2026-01'], partialMetrics);
		const partition = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 0,
					severe_count: 0,
					sum_delay_seconds: 0,
				},
				delay_percentiles: {
					observation_count: 10,
					p50_delay_seconds: 0,
					p90_delay_seconds: 0,
				},
			},
		]);

		const result = mergeNetworkHistory(index, [partition], FULL_WINDOW);

		expect(result.delay.status).toBe('partial');
		expect(result.delay.value).toMatchObject({ otpPct: 0, severePct: 0, averageDelaySeconds: 0 });
		expect(result.delayPercentiles).toEqual({
			status: 'partial',
			value: [
				{
					date: '2026-01-31',
					value: {
						observation_count: 10,
						p50_delay_seconds: 0,
						p90_delay_seconds: 0,
					},
				},
			],
		});
		expect(result.cancellation).toEqual({ status: 'no_data', value: null });
		expect(result.vehicles).toEqual({ status: 'no_data', value: null });
		expect(result.currentOnly).toEqual(
			Object.fromEntries(
				NETWORK_CURRENT_ONLY_SECTIONS.map((section) => [
					section,
					{ status: 'current_only', value: null },
				]),
			),
		);
		expect(LINE_CURRENT_ONLY_SECTIONS).toContain('headway');
		expect(STOP_CURRENT_ONLY_SECTIONS).toEqual([
			'identity',
			'live_status',
			'periods',
			'habits',
			'weekday',
			'time_of_day',
			'by_route',
		]);
	});

	it('treats scheduled-only cancellation as real and an all-zero occupancy aggregate as no data', () => {
		const index = reducerIndex(
			'network',
			null,
			['2026-01'],
			[
				metric('cancellation', 'additive', '2026-01-31', '2026-01-31'),
				metric('occupancy', 'additive', '2026-01-31', '2026-01-31'),
			],
		);
		const partition = {
			generated_utc: ISO,
			month: '2026-01',
			days: [
				{
					date: '2026-01-31',
					cancellation: {
						canceled_trip_days: 0,
						total_trip_days: 0,
						scheduled_trip_days: 10,
						delivered_trip_days: 0,
						silent_trip_days: 10,
					},
					occupancy: { empty: 0, many_seats: 0, few_seats: 0, standing: 0, full: 0 },
				},
			],
		} as NetworkHistoryPartition;

		const result = mergeNetworkHistory(index, [partition], {
			from: '2026-01-31',
			to: '2026-01-31',
		});

		expect(result.cancellation).toEqual({
			status: 'complete',
			value: {
				canceledTripDays: 0,
				totalTripDays: 0,
				cancellationRatePct: null,
				scheduledTripDays: 10,
				deliveredTripDays: 0,
				silentTripDays: 10,
				completenessPct: 0,
			},
		});
		expect(result.occupancy).toEqual({ status: 'no_data', value: null });
	});

	it('keeps observed cancellation usable but marks unknown scheduled completeness partial', () => {
		const index = reducerIndex(
			'network',
			null,
			['2026-01'],
			[metric('cancellation', 'additive', '2026-01-31', '2026-01-31')],
		);
		const partition = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				cancellation: { canceled_trip_days: 2, total_trip_days: 10 },
			},
		]);

		const result = mergeNetworkHistory(index, [partition], {
			from: '2026-01-31',
			to: '2026-01-31',
		});

		expect(result.cancellation).toEqual({
			status: 'partial',
			value: {
				canceledTripDays: 2,
				totalTripDays: 10,
				cancellationRatePct: 20,
				scheduledTripDays: null,
				deliveredTripDays: null,
				silentTripDays: null,
				completenessPct: null,
			},
		});
	});

	it('pools known cancellation completeness while marking unknown schedule rows partial', () => {
		const index = reducerIndex(
			'network',
			null,
			['2026-01', '2026-02'],
			[metric('cancellation', 'additive', '2026-01-31', '2026-02-01')],
		);
		const january = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				cancellation: {
					canceled_trip_days: 1,
					total_trip_days: 10,
					scheduled_trip_days: 10,
					delivered_trip_days: 8,
					silent_trip_days: 2,
				},
			},
		]);
		const february = networkPartition('2026-02', [
			{
				date: '2026-02-01',
				cancellation: { canceled_trip_days: 2, total_trip_days: 10 },
			},
		]);

		const result = mergeNetworkHistory(index, [january, february], FULL_WINDOW);

		expect(result.cancellation).toEqual({
			status: 'partial',
			value: {
				canceledTripDays: 3,
				totalTripDays: 20,
				cancellationRatePct: 15,
				scheduledTripDays: 10,
				deliveredTripDays: 8,
				silentTripDays: 2,
				completenessPct: 80,
			},
		});
	});

	it('rejects duplicate dates across partitions instead of last-write-wins', () => {
		const index = reducerIndex(
			'network',
			null,
			['2026-01'],
			[metric('delay_percentiles', 'daily_only', '2026-01-31', '2026-01-31')],
		);
		const first = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay_percentiles: { observation_count: 10, p50_delay_seconds: 1 },
			},
		]);
		const conflicting = networkPartition('2026-01', [
			{
				date: '2026-01-31',
				delay_percentiles: { observation_count: 10, p50_delay_seconds: 2 },
			},
		]);

		expect(() => mergeNetworkHistory(index, [first, conflicting], FULL_WINDOW)).toThrowError(
			HistoryArtifactContractError,
		);
	});
});
