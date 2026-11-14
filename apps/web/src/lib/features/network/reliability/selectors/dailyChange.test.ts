import { expect, it } from 'vitest';
import { selectDailyChange as projectedDailyChange } from './dailyChange';
import { networkReliabilityView } from '#lib/v1/reliabilityView.ts';
import type { TrendPoint } from '#lib/v1/index.ts';
const selectDailyChange = (points: readonly TrendPoint[]) =>
	projectedDailyChange(networkReliabilityView({ points }).points);
it('compares two closed days and preserves missing on-time values', () => {
	expect(
		selectDailyChange([
			{ date: '2026-11-09', otp_pct: 80 },
			{ date: '2026-11-10', otp_pct: 82 },
		])?.points,
	).toBe(2);
	expect(
		selectDailyChange([{ date: '2026-11-09' }, { date: '2026-11-10', otp_pct: 82 }]),
	).toBeNull();
	expect(
		selectDailyChange([{ date: '2026-11-09', otp_pct: 80 }, { date: '2026-11-10' }]),
	).toBeNull();
});
