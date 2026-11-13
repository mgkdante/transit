import { expect, it } from 'vitest';
import { closedWeek } from '#lib/features/lines/reliability/__fixtures__/closedWeek.ts';
import {
	closedTrendPoints,
	isClosedDay,
	recordClosedThrough,
	routeClosedThrough,
	trailingRouteWindow,
} from './closedWindow';

it('sums the trailing week', () => {
	expect(routeClosedThrough(closedWeek)).toBe('2026-11-10');
	const total = trailingRouteWindow(closedWeek, 'week');
	expect(total).toMatchObject({
		window: { from: '2026-11-04', to: '2026-11-10', days: 7 },
		observationCount: 227378,
		onTime: 190827,
	});
	expect(total?.avgDelayMin).toBeCloseTo((200000 * 2 + 27378 * 4) / 227378);
	expect(total?.severePct).toBeCloseTo((200000 * 10 + 27378 * 20) / 227378);
});
it('returns null without closed windows', () => {
	expect(trailingRouteWindow({ ...closedWeek, periods_by_grain: [] }, 'week')).toBeNull();
	expect(trailingRouteWindow(closedWeek, 'month')).toBeNull();
});
it('drops the open day and unfinished buckets', () => {
	const points = [
		'2026-10-01',
		'2026-11-01',
		'2026-11-02',
		'2026-11-09',
		'2026-11-10',
		'2026-11-11',
	].map((date) => ({ date }));
	expect(closedTrendPoints(points, 'day', '2026-11-10')).toEqual(points.slice(0, -1));
	expect(closedTrendPoints(points.slice(2, 4), 'week', '2026-11-10')).toEqual([points[2]]);
	expect(closedTrendPoints(points.slice(0, 2), 'month', '2026-11-10')).toEqual([points[0]]);
});
it('treats every day as open when no anchor exists', () => {
	expect(isClosedDay('2026-11-10', null)).toBe(false);
	expect(closedTrendPoints([{ date: '2026-11-10' }], 'day', null)).toEqual([]);
	expect(recordClosedThrough(null)).toBeNull();
});

it.each([
	['week', '2026-11-03'],
	['month', '2026-10-11'],
] as const)('rejects a stale %s window under a fresh anchor', (grain, date) => {
	expect(
		trailingRouteWindow(
			{
				...closedWeek,
				periods_by_grain: [
					{ grain: 'day', date: '2026-11-10' },
					{ grain, date, by_daytype: [{ grain: 'weekday', observation_count: 100, on_time: 90 }] },
				],
			},
			grain,
		),
	).toBeNull();
});

it('keeps cancellation and skipped-stop windows closed', async () => {
	const { toReliabilityClusters } = await import('#lib/features/lines/reliability/clusters.ts');
	const data = {
		...closedWeek,
		cancellations: [
			{ grain: 'day', date: '2026-11-10', total_trip_days: 100, canceled_trip_days: 2 },
			{ grain: 'day', date: '2026-11-11', total_trip_days: 100, canceled_trip_days: 90 },
		],
		skipped_stops: [
			{ date: '2026-11-10', stop_time_update_count: 100, skipped_stop_count: 3 },
			{ date: '2026-11-11', stop_time_update_count: 100, skipped_stop_count: 90 },
		],
	};
	expect(toReliabilityClusters(data, { grain: 'day' }).strip).toMatchObject({
		cancellationRatePct: 2,
		skippedStopRatePct: 3,
	});
	expect(toReliabilityClusters(data, { grain: 'week' }).strip).toMatchObject({
		cancellationRatePct: 2,
		skippedStopRatePct: 3,
	});
});
it('does not show stale weekly cuts under the closed-week label', async () => {
	const { toReliabilityClusters } = await import('#lib/features/lines/reliability/clusters.ts');
	const stale = {
		...closedWeek,
		periods_by_grain: [
			{ grain: 'day', date: '2026-11-10' },
			{
				grain: 'week',
				date: '2026-11-03',
				by_shift: [{ grain: 'am_peak', otp_pct: 90 }],
				by_daytype: [{ grain: 'weekday', observation_count: 100, on_time: 90 }],
				day_of_week: [{ day_of_week_iso: 1, avg_delay_min: 3 }],
			},
		],
	};
	const pane = toReliabilityClusters(stale, { grain: 'week' }).punctuality;
	expect(pane.peakOffPeak.byShift).toEqual([]);
	expect(pane.peakOffPeak.byDayType).toEqual([]);
	expect(pane.dayOfWeek).toEqual([]);
});
