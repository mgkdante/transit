import { isoUtc } from '#lib/v1/schemas/types.ts';
import { expect, it } from 'vitest';
import { closeNetworkTrend } from './closedTrend';
it('keeps closed points and every cut', () => {
	for (const provider of ['invented-network']) {
		const trend = {
			generated_utc: isoUtc().parse('2026-11-11T12:00:00Z'),
			provider,
			series: [{ date: '2026-11-10' }, { date: '2026-11-11' }],
			by_shift: [{ grain: 'am_peak' }],
			by_daytype: [{ grain: 'weekday' }],
		};
		const closed = closeNetworkTrend(trend, '2026-11-10');
		expect(closed?.series).toEqual([{ date: '2026-11-10' }]);
		expect(closed?.by_shift).toBe(trend.by_shift);
		expect(closed?.by_daytype).toBe(trend.by_daytype);
		expect(trend.series).toHaveLength(2);
	}
	expect(closeNetworkTrend(null, null)).toBeNull();
	expect(closeNetworkTrend(undefined, null)).toBeNull();
});
