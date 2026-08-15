import { describe, expect, it } from 'vitest';
import type { IsoUtc, ReliabilityPeriod, RouteReliability } from '$lib/v1';
import { toReliabilityClusters } from '../clusters';
import { selectDayVerdictHeadline } from './dayVerdictHeadline';

const route = (periods?: readonly ReliabilityPeriod[]): RouteReliability => ({
	id: '24',
	generated_utc: '2026-08-15T00:00:00Z' as IsoUtc,
	periods: periods == null ? undefined : [...periods],
});

const fullHeadline = (data: RouteReliability) => {
	const { otpPct, observationCount, onTime } = toReliabilityClusters(data, {
		grain: 'day',
	}).punctuality.headline;
	return { otpPct, observationCount, onTime };
};

describe('selectDayVerdictHeadline', () => {
	it.each([
		['missing periods', route()],
		['empty periods', route([])],
		[
			'most-recent dated day rather than array order',
			route([
				{ grain: 'week', date: '2026-08-15', otp_pct: 51, observation_count: 10, on_time: 5 },
				{ grain: 'day', date: '2026-08-14', otp_pct: 82, observation_count: 100, on_time: 82 },
				{ grain: 'day', date: '2026-08-12', otp_pct: 74, observation_count: 90, on_time: 67 },
				{ grain: 'day', date: '2026-08-13', otp_pct: 79, observation_count: 95, on_time: 75 },
				{ grain: 'month', date: '2026-08-01', otp_pct: 70, observation_count: 1_000, on_time: 700 },
			]),
		],
		[
			'last duplicate-date day wins and preserves real zeroes',
			route([
				{ grain: 'day', date: '2026-08-14', otp_pct: 80, observation_count: 100, on_time: 80 },
				{ grain: 'day', date: '2026-08-14', otp_pct: 0, observation_count: 30, on_time: 0 },
			]),
		],
		[
			'last dateless day wins',
			route([
				{ grain: 'day', otp_pct: 60, observation_count: 40, on_time: 24 },
				{ grain: 'day', otp_pct: 65, observation_count: 40, on_time: 26 },
			]),
		],
		[
			'no-day fallback uses first grouped week before month',
			route([
				{ grain: 'month', date: '2026-08-01', otp_pct: 68, observation_count: 300, on_time: 204 },
				{ grain: 'week', date: '2026-08-11', otp_pct: 71, observation_count: 70, on_time: 50 },
			]),
		],
		[
			'non-calendar grains do not leak into the headline',
			route([{ grain: 'am_peak', otp_pct: 99, observation_count: 100, on_time: 99 }]),
		],
		[
			'nullable fields stay null instead of becoming zero',
			route([{ grain: 'day', date: '2026-08-14', otp_pct: null }]),
		],
	] as const)('matches the full day-grain mapper for %s', (_label, data) => {
		expect(selectDayVerdictHeadline(data)).toEqual(fullHeadline(data));
	});
});
