import { z } from 'zod';
import { encodeHistoryEntityId } from '../history/entity';
import {
	isHistoryEntityIndexPath,
	isHistoryFamilyIndexPath,
	isRetainedPointHistoryFamily,
	isRetainedRangeHistoryFamily,
} from '../history/pointers';
import * as collection from './generated/historic_collection_index';
import * as availability from './generated/historic_availability_index';
import * as directory from './generated/historic_entity_directory_index';
import * as network from './generated/historic_network_history_partition';
import * as line from './generated/historic_line_history_partition';
import * as stop from './generated/historic_stop_history_partition';

export const HistorySelectionModeSchema = collection.HistorySelectionModeSchema;
export type HistorySelectionMode = z.infer<typeof HistorySelectionModeSchema>;

export const HistoryMetricAggregationSchema = collection.HistoryMetricAggregationSchema;
export type HistoryMetricAggregation = z.infer<typeof HistoryMetricAggregationSchema>;

export const HistoryMetricNameSchema = collection.HistoryMetricNameSchema;
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

export const HistoryDateSchema = z
	.string()
	.refine(isCanonicalDate, 'Expected a valid YYYY-MM-DD date.');
const HistoryMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const HistoricCoverageGapSchema = collection.HistoricCoverageGapSchema;
export type HistoricCoverageGap = z.infer<typeof HistoricCoverageGapSchema>;

export const HistoricPartitionRefSchema = collection.HistoricPartitionRefSchema;
export type HistoricPartitionRef = z.infer<typeof HistoricPartitionRefSchema>;

export const HistoricMetricCoverageSchema = collection.HistoricMetricCoverageSchema;
export type HistoricMetricCoverage = z.infer<typeof HistoricMetricCoverageSchema>;

export const HistoricCollectionIndexSchema = collection.HistoricCollectionIndexSchema;
export type HistoricCollectionIndex = z.infer<typeof HistoricCollectionIndexSchema>;

export const HistoricFamilyAvailabilitySchema =
	availability.HistoricFamilyAvailabilitySchema.superRefine((value, ctx) => {
		const family = value.family;
		if (
			(isRetainedRangeHistoryFamily(family) || isRetainedPointHistoryFamily(family)) &&
			!isHistoryFamilyIndexPath(family, value.index_path)
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['index_path'],
				message: `invalid ${family} history index_path`,
			});
		}
		if (isRetainedRangeHistoryFamily(family) && value.selection_mode !== 'range') {
			ctx.addIssue({
				code: 'custom',
				path: ['selection_mode'],
				message: `${family} history requires range selection`,
			});
		}
		if (isRetainedPointHistoryFamily(family) && value.selection_mode !== 'date') {
			ctx.addIssue({
				code: 'custom',
				path: ['selection_mode'],
				message: `${family} history requires date selection`,
			});
		}
	});
export type HistoricFamilyAvailability = z.infer<typeof HistoricFamilyAvailabilitySchema>;

const HistoricEntityIndexRefBaseSchema = directory.HistoricEntityIndexRefSchema.extend({
	encoded_id: z.string().regex(/^(?:[0-9a-f]{2})+$/),
});
export const HistoricEntityIndexRefSchema = HistoricEntityIndexRefBaseSchema.superRefine(
	(value, ctx) => {
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
	},
);
export type HistoricEntityIndexRef = z.infer<typeof HistoricEntityIndexRefSchema>;

export const HistoricEntityDirectoryIndexSchema =
	directory.HistoricEntityDirectoryIndexSchema.extend({
		entities: z.array(HistoricEntityIndexRefSchema).optional(),
	}).superRefine((value, ctx) => {
		for (const [index, entity] of (value.entities ?? []).entries()) {
			if (!isHistoryEntityIndexPath(value.family, entity.entity_id, entity.index_path)) {
				ctx.addIssue({
					code: 'custom',
					path: ['entities', index, 'index_path'],
					message: `invalid ${value.family} entity index_path`,
				});
			}
		}
	});
export type HistoricEntityDirectoryIndex = z.infer<typeof HistoricEntityDirectoryIndexSchema>;

export const HistoricDelayMetricSchema = network.HistoricDelayMetricSchema.superRefine(
	(value, ctx) => {
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
		const inClamp = value.in_clamp_observation_count ?? 0;
		for (const field of ['on_time_count', 'severe_count'] as const) {
			const count = value[field];
			if (count != null && count > inClamp) {
				ctx.addIssue({
					code: 'custom',
					path: [field],
					message: `${field} cannot exceed in_clamp_observation_count`,
				});
			}
		}
		if (
			value.on_time_count != null &&
			value.severe_count != null &&
			value.on_time_count + value.severe_count > inClamp
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['on_time_count'],
				message: 'on_time_count plus severe_count cannot exceed in_clamp_observation_count',
			});
		}
		if (value.sum_delay_seconds != null && Math.abs(value.sum_delay_seconds) > 3600 * inClamp) {
			ctx.addIssue({
				code: 'custom',
				path: ['sum_delay_seconds'],
				message: 'sum_delay_seconds exceeds the capped in-clamp population',
			});
		}
	},
);
export type HistoricDelayMetric = z.infer<typeof HistoricDelayMetricSchema>;

export const HistoricDelayPercentilesSchema = network.HistoricDelayPercentilesSchema.superRefine(
	(value, ctx) => {
		if (value.p50_delay_seconds == null && value.p90_delay_seconds == null) {
			ctx.addIssue({
				code: 'custom',
				message: 'at least one delay percentile is required',
			});
		}
		for (const field of ['p50_delay_seconds', 'p90_delay_seconds'] as const) {
			const percentile = value[field];
			if (percentile != null && (percentile < -3600 || percentile > 3600)) {
				ctx.addIssue({
					code: 'custom',
					path: [field],
					message: `${field} must be within the capped delay range`,
				});
			}
		}
		if (
			value.p50_delay_seconds != null &&
			value.p90_delay_seconds != null &&
			value.p50_delay_seconds > value.p90_delay_seconds
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['p50_delay_seconds'],
				message: 'p50_delay_seconds cannot exceed p90_delay_seconds',
			});
		}
	},
);
export type HistoricDelayPercentiles = z.infer<typeof HistoricDelayPercentilesSchema>;

export const HistoricCancellationMetricSchema =
	network.HistoricCancellationMetricSchema.superRefine((value, ctx) => {
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
		if (
			value.scheduled_trip_days == null &&
			(value.delivered_trip_days != null || value.silent_trip_days != null)
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['scheduled_trip_days'],
				message: 'delivered and silent counts require scheduled_trip_days',
			});
		}
		if (
			value.silent_trip_days != null &&
			value.scheduled_trip_days != null &&
			value.silent_trip_days > value.scheduled_trip_days
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['silent_trip_days'],
				message: 'silent_trip_days cannot exceed scheduled_trip_days',
			});
		}
		const deliveredCap = value.total_trip_days - value.canceled_trip_days;
		if (value.delivered_trip_days != null && value.delivered_trip_days > deliveredCap) {
			ctx.addIssue({
				code: 'custom',
				path: ['delivered_trip_days'],
				message: 'delivered_trip_days cannot exceed total minus canceled trip-days',
			});
		}
	});
export type HistoricCancellationMetric = z.infer<typeof HistoricCancellationMetricSchema>;

export const HistoricOccupancyMetricSchema = network.HistoricOccupancyMetricSchema.superRefine(
	(value, ctx) => {
		if (value.empty + value.many_seats + value.few_seats + value.standing + value.full === 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'occupancy requires at least one telemetry observation',
			});
		}
	},
);
export type HistoricOccupancyMetric = z.infer<typeof HistoricOccupancyMetricSchema>;

export const HistoricServiceSpanMetricSchema = line.HistoricServiceSpanMetricSchema;
export type HistoricServiceSpanMetric = z.infer<typeof HistoricServiceSpanMetricSchema>;

export const HistoricSkippedStopMetricSchema = line.HistoricSkippedStopMetricSchema.superRefine(
	(value, ctx) => {
		if (value.skipped_stop_count > value.stop_time_update_count) {
			ctx.addIssue({
				code: 'custom',
				path: ['skipped_stop_count'],
				message: 'skipped_stop_count cannot exceed stop_time_update_count',
			});
		}
	},
);
export type HistoricSkippedStopMetric = z.infer<typeof HistoricSkippedStopMetricSchema>;

const requireHistoryDayMetric = (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
	if (Object.entries(value).every(([field, metric]) => field === 'date' || metric == null)) {
		ctx.addIssue({ code: 'custom', message: 'history day requires at least one real metric' });
	}
};

export const NetworkHistoryDaySchema = network.NetworkHistoryDaySchema.extend({
	date: HistoryDateSchema,
	delay: HistoricDelayMetricSchema.nullable().optional(),
	delay_percentiles: HistoricDelayPercentilesSchema.nullable().optional(),
	cancellation: HistoricCancellationMetricSchema.nullable().optional(),
	occupancy: HistoricOccupancyMetricSchema.nullable().optional(),
})
	.superRefine(requireHistoryDayMetric)
	.superRefine((value, ctx) => {
		if (
			value.vehicles != null &&
			value.delay_percentiles != null &&
			value.vehicles > value.delay_percentiles.observation_count
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['vehicles'],
				message: 'vehicles cannot exceed delay percentile observations',
			});
		}
	});
export type NetworkHistoryDay = z.infer<typeof NetworkHistoryDaySchema>;

export const LineHistoryDaySchema = line.LineHistoryDaySchema.extend({
	date: HistoryDateSchema,
	delay: HistoricDelayMetricSchema.nullable().optional(),
	delay_percentiles: HistoricDelayPercentilesSchema.nullable().optional(),
	cancellation: HistoricCancellationMetricSchema.nullable().optional(),
	occupancy: HistoricOccupancyMetricSchema.nullable().optional(),
	skipped_stops: HistoricSkippedStopMetricSchema.nullable().optional(),
}).superRefine(requireHistoryDayMetric);
export type LineHistoryDay = z.infer<typeof LineHistoryDaySchema>;

export const StopHistoryDaySchema = stop.StopHistoryDaySchema.extend({
	date: HistoryDateSchema,
	delay: HistoricDelayMetricSchema.nullable().optional(),
	delay_percentiles: HistoricDelayPercentilesSchema.nullable().optional(),
	occupancy: HistoricOccupancyMetricSchema.nullable().optional(),
}).superRefine(requireHistoryDayMetric);
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

export const NetworkHistoryPartitionSchema = network.NetworkHistoryPartitionSchema.extend({
	month: HistoryMonthSchema,
	days: z.array(NetworkHistoryDaySchema).min(1),
}).superRefine(validatePartitionDays);
export type NetworkHistoryPartition = z.infer<typeof NetworkHistoryPartitionSchema>;

export const LineHistoryPartitionSchema = line.LineHistoryPartitionSchema.extend({
	month: HistoryMonthSchema,
	days: z.array(LineHistoryDaySchema).min(1),
}).superRefine(validatePartitionDays);
export type LineHistoryPartition = z.infer<typeof LineHistoryPartitionSchema>;

export const StopHistoryPartitionSchema = stop.StopHistoryPartitionSchema.extend({
	month: HistoryMonthSchema,
	days: z.array(StopHistoryDaySchema).min(1),
}).superRefine(validatePartitionDays);
export type StopHistoryPartition = z.infer<typeof StopHistoryPartitionSchema>;

export const HistoricAvailabilityIndexSchema = availability.HistoricAvailabilityIndexSchema.extend({
	families: z.array(HistoricFamilyAvailabilitySchema).optional(),
});
export type HistoricAvailabilityIndex = z.infer<typeof HistoricAvailabilityIndexSchema>;
