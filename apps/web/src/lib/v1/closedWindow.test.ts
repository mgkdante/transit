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
