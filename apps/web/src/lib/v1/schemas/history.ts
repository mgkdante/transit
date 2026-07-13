// history.ts — Zod mirrors of the shared retained-history collection and
// availability contracts.

import { z } from 'zod';
import { encodeHistoryEntityId } from '../history/entity';
import { isoUtc, payloadEnvelopeFields } from './types';

export const HistorySelectionModeSchema = z.enum(['range', 'date']);
export type HistorySelectionMode = z.infer<typeof HistorySelectionModeSchema>;

export const HistoryMetricAggregationSchema = z.enum(['additive', 'daily_only', 'current_only']);
export type HistoryMetricAggregation = z.infer<typeof HistoryMetricAggregationSchema>;

export const HistoryMetricNameSchema = z.enum([
	'delay',
	'delay_percentiles',
	'vehicles',
	'cancellation',
	'occupancy',
	'service_span',
	'skipped_stops',
]);
export type HistoryMetricName = z.infer<typeof HistoryMetricNameSchema>;

const isCanonicalDate = (value: string): boolean => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year === 0 || month < 1 || month > 12) return false;
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day >= 1 && day <= daysInMonth[month - 1];
};

const HistoryDateSchema = z.string().refine(isCanonicalDate, 'Expected a valid YYYY-MM-DD date.');
const HistoryMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const HistoricCoverageGapSchema = z.object({
	start_date: z.string(),
	end_date: z.string(),
	reason: z.string().nullable().optional(),
});
export type HistoricCoverageGap = z.infer<typeof HistoricCoverageGapSchema>;

export const HistoricPartitionRefSchema = z.object({
	path: z.string(),
	coverage_start: z.string(),
	coverage_end: z.string(),
	count: z.number().int().min(0).nullable().optional(),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.nullable()
		.optional(),
	byte_size: z.number().int().min(1).nullable().optional(),
});
export type HistoricPartitionRef = z.infer<typeof HistoricPartitionRefSchema>;

export const HistoricMetricCoverageSchema = z.object({
	metric: HistoryMetricNameSchema,
	aggregation: HistoryMetricAggregationSchema,
	first_available_date: z.string().nullable().optional(),
	last_available_date: z.string().nullable().optional(),
	gaps: z.array(HistoricCoverageGapSchema).optional(),
});
export type HistoricMetricCoverage = z.infer<typeof HistoricMetricCoverageSchema>;

export const HistoricCollectionIndexSchema = z.object({
	generated_utc: isoUtc(),
	family: z.string(),
	selection_mode: HistorySelectionModeSchema,
	entity_id: z.string().nullable().optional(),
	collection_generation_id: z.string().nullable().optional(),
	first_available_date: z.string().nullable().optional(),
	last_available_date: z.string().nullable().optional(),
	available_dates: z.array(z.string()).optional(),
	gaps: z.array(HistoricCoverageGapSchema).optional(),
	partitions: z.array(HistoricPartitionRefSchema).optional(),
	metrics: z.array(HistoricMetricCoverageSchema).optional(),
	...payloadEnvelopeFields(),
});
export type HistoricCollectionIndex = z.infer<typeof HistoricCollectionIndexSchema>;

export const HistoricFamilyAvailabilitySchema = z.object({
	family: z.string(),
	selection_mode: HistorySelectionModeSchema,
	index_path: z.string(),
	collection_generation_id: z.string().nullable().optional(),
	first_available_date: z.string().nullable().optional(),
	last_available_date: z.string().nullable().optional(),
	gaps: z.array(HistoricCoverageGapSchema).optional(),
	metrics: z.array(HistoricMetricCoverageSchema).optional(),
});
export type HistoricFamilyAvailability = z.infer<typeof HistoricFamilyAvailabilitySchema>;

export const HistoricEntityIndexRefSchema = z
	.object({
		entity_id: z.string().min(1),
		encoded_id: z.string().regex(/^(?:[0-9a-f]{2})+$/),
		index_path: z.string().min(1),
		collection_generation_id: z.string().min(1),
		first_available_date: z.string().nullable().optional(),
		last_available_date: z.string().nullable().optional(),
	})
	.superRefine((value, ctx) => {
		let expectedEncodedId: string;
		try {
			expectedEncodedId = encodeHistoryEntityId(value.entity_id);
		} catch {
			ctx.addIssue({
				code: 'custom',
				path: ['entity_id'],
				message: 'entity_id must be valid Unicode without lone UTF-16 surrogates',
			});
			return;
		}
		if (value.encoded_id !== expectedEncodedId) {
			ctx.addIssue({
				code: 'custom',
				path: ['encoded_id'],
				message: 'encoded_id must be the lowercase UTF-8 hex of entity_id',
			});
		}
	});
export type HistoricEntityIndexRef = z.infer<typeof HistoricEntityIndexRefSchema>;

export const HistoricEntityDirectoryIndexSchema = z
	.object({
		generated_utc: isoUtc(),
		family: z.enum(['lines', 'stops']),
		selection_mode: z.literal('range'),
		collection_generation_id: z.string().min(1),
		first_available_date: z.string().nullable().optional(),
		last_available_date: z.string().nullable().optional(),
		entities: z.array(HistoricEntityIndexRefSchema).optional(),
		...payloadEnvelopeFields(),
	})
	.superRefine((value, ctx) => {
		for (const [index, entity] of (value.entities ?? []).entries()) {
			const expected = `historic/history/${value.family}/${entity.encoded_id}/index.json`;
			if (entity.index_path !== expected) {
				ctx.addIssue({
					code: 'custom',
					path: ['entities', index, 'index_path'],
					message: `entity index_path must equal ${expected}`,
				});
			}
		}
	});
export type HistoricEntityDirectoryIndex = z.infer<typeof HistoricEntityDirectoryIndexSchema>;

export const HistoricDelayMetricSchema = z
	.object({
		observation_count: z.number().int().min(1),
		in_clamp_observation_count: z.number().int().min(1).nullable().optional(),
		on_time_count: z.number().int().min(0).nullable().optional(),
		severe_count: z.number().int().min(0).nullable().optional(),
		sum_delay_seconds: z.number().int().nullable().optional(),
	})
	.superRefine((value, ctx) => {
		for (const field of ['in_clamp_observation_count', 'on_time_count', 'severe_count'] as const) {
			const count = value[field];
			if (count != null && count > value.observation_count) {
				ctx.addIssue({
					code: 'custom',
					path: [field],
					message: `${field} cannot exceed observation_count`,
				});
			}
		}
		if (value.sum_delay_seconds != null && value.in_clamp_observation_count == null) {
			ctx.addIssue({
				code: 'custom',
				path: ['sum_delay_seconds'],
				message: 'sum_delay_seconds requires in_clamp_observation_count',
			});
		}
	});
export type HistoricDelayMetric = z.infer<typeof HistoricDelayMetricSchema>;

export const HistoricDelayPercentilesSchema = z
	.object({
		observation_count: z.number().int().min(1),
		p50_delay_seconds: z.number().nullable().optional(),
		p90_delay_seconds: z.number().nullable().optional(),
	})
	.superRefine((value, ctx) => {
		if (value.p50_delay_seconds == null && value.p90_delay_seconds == null) {
			ctx.addIssue({
				code: 'custom',
				message: 'at least one delay percentile is required',
			});
		}
	});
export type HistoricDelayPercentiles = z.infer<typeof HistoricDelayPercentilesSchema>;

export const HistoricCancellationMetricSchema = z
	.object({
		canceled_trip_days: z.number().int().min(0),
		total_trip_days: z.number().int().min(0),
		scheduled_trip_days: z.number().int().min(0).nullable().optional(),
		delivered_trip_days: z.number().int().min(0).nullable().optional(),
		silent_trip_days: z.number().int().min(0).nullable().optional(),
	})
	.superRefine((value, ctx) => {
		if (value.canceled_trip_days > value.total_trip_days) {
			ctx.addIssue({
				code: 'custom',
				path: ['canceled_trip_days'],
				message: 'canceled_trip_days cannot exceed total_trip_days',
			});
		}
		if (
			value.total_trip_days === 0 &&
			!(value.scheduled_trip_days != null && value.scheduled_trip_days > 0)
		) {
			ctx.addIssue({
				code: 'custom',
				message: 'cancellation requires a positive observed or scheduled denominator',
			});
		}
	});
export type HistoricCancellationMetric = z.infer<typeof HistoricCancellationMetricSchema>;

export const HistoricOccupancyMetricSchema = z
	.object({
		empty: z.number().int().min(0),
		many_seats: z.number().int().min(0),
		few_seats: z.number().int().min(0),
		standing: z.number().int().min(0),
		full: z.number().int().min(0),
	})
	.superRefine((value, ctx) => {
		if (value.empty + value.many_seats + value.few_seats + value.standing + value.full === 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'occupancy requires at least one telemetry observation',
			});
		}
	});
export type HistoricOccupancyMetric = z.infer<typeof HistoricOccupancyMetricSchema>;

export const HistoricServiceSpanMetricSchema = z.object({
	trip_count: z.number().int().min(1),
	first_trip_utc: z.string().nullable().optional(),
	last_trip_utc: z.string().nullable().optional(),
	first_trip_delay_seconds: z.number().int().nullable().optional(),
	last_trip_delay_seconds: z.number().int().nullable().optional(),
});
export type HistoricServiceSpanMetric = z.infer<typeof HistoricServiceSpanMetricSchema>;

export const HistoricSkippedStopMetricSchema = z
	.object({
		skipped_stop_count: z.number().int().min(0),
		stop_time_update_count: z.number().int().min(1),
	})
	.superRefine((value, ctx) => {
		if (value.skipped_stop_count > value.stop_time_update_count) {
			ctx.addIssue({
				code: 'custom',
				path: ['skipped_stop_count'],
				message: 'skipped_stop_count cannot exceed stop_time_update_count',
			});
		}
	});
export type HistoricSkippedStopMetric = z.infer<typeof HistoricSkippedStopMetricSchema>;

const requireHistoryDayMetric = (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
	if (Object.entries(value).every(([field, metric]) => field === 'date' || metric == null)) {
		ctx.addIssue({ code: 'custom', message: 'history day requires at least one real metric' });
	}
};

export const NetworkHistoryDaySchema = z
	.object({
		date: HistoryDateSchema,
		delay: HistoricDelayMetricSchema.nullable().optional(),
		delay_percentiles: HistoricDelayPercentilesSchema.nullable().optional(),
		cancellation: HistoricCancellationMetricSchema.nullable().optional(),
		occupancy: HistoricOccupancyMetricSchema.nullable().optional(),
		vehicles: z.number().int().min(1).nullable().optional(),
	})
	.superRefine(requireHistoryDayMetric);
export type NetworkHistoryDay = z.infer<typeof NetworkHistoryDaySchema>;

export const LineHistoryDaySchema = z
	.object({
		date: HistoryDateSchema,
		delay: HistoricDelayMetricSchema.nullable().optional(),
		delay_percentiles: HistoricDelayPercentilesSchema.nullable().optional(),
		cancellation: HistoricCancellationMetricSchema.nullable().optional(),
		occupancy: HistoricOccupancyMetricSchema.nullable().optional(),
		service_span: HistoricServiceSpanMetricSchema.nullable().optional(),
		skipped_stops: HistoricSkippedStopMetricSchema.nullable().optional(),
	})
	.superRefine(requireHistoryDayMetric);
export type LineHistoryDay = z.infer<typeof LineHistoryDaySchema>;

export const StopHistoryDaySchema = z
	.object({
		date: HistoryDateSchema,
		delay: HistoricDelayMetricSchema.nullable().optional(),
		delay_percentiles: HistoricDelayPercentilesSchema.nullable().optional(),
		occupancy: HistoricOccupancyMetricSchema.nullable().optional(),
	})
	.superRefine(requireHistoryDayMetric);
export type StopHistoryDay = z.infer<typeof StopHistoryDaySchema>;

const validatePartitionDays = (
	value: { month: string; days: { date: string }[] },
	ctx: z.RefinementCtx,
) => {
	const dates = value.days.map((day) => day.date);
	if (dates.some((date, index) => index > 0 && date <= dates[index - 1])) {
		ctx.addIssue({
			code: 'custom',
			path: ['days'],
			message: 'partition days must be strictly ascending and unique',
		});
	}
	for (const [index, date] of dates.entries()) {
		if (date.slice(0, 7) !== value.month) {
			ctx.addIssue({
				code: 'custom',
				path: ['days', index, 'date'],
				message: 'partition day must belong to partition month',
			});
		}
	}
};

export const NetworkHistoryPartitionSchema = z
	.object({
		generated_utc: isoUtc(),
		month: HistoryMonthSchema,
		days: z.array(NetworkHistoryDaySchema).min(1),
		...payloadEnvelopeFields(),
	})
	.superRefine(validatePartitionDays);
export type NetworkHistoryPartition = z.infer<typeof NetworkHistoryPartitionSchema>;

export const LineHistoryPartitionSchema = z
	.object({
		generated_utc: isoUtc(),
		month: HistoryMonthSchema,
		entity_id: z.string().min(1),
		days: z.array(LineHistoryDaySchema).min(1),
		...payloadEnvelopeFields(),
	})
	.superRefine(validatePartitionDays);
export type LineHistoryPartition = z.infer<typeof LineHistoryPartitionSchema>;

export const StopHistoryPartitionSchema = z
	.object({
		generated_utc: isoUtc(),
		month: HistoryMonthSchema,
		entity_id: z.string().min(1),
		days: z.array(StopHistoryDaySchema).min(1),
		...payloadEnvelopeFields(),
	})
	.superRefine(validatePartitionDays);
export type StopHistoryPartition = z.infer<typeof StopHistoryPartitionSchema>;

export const HistoricAvailabilityIndexSchema = z.object({
	generated_utc: isoUtc(),
	families: z.array(HistoricFamilyAvailabilitySchema).optional(),
	...payloadEnvelopeFields(),
});
export type HistoricAvailabilityIndex = z.infer<typeof HistoricAvailabilityIndexSchema>;
