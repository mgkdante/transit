import { expect, it } from 'vitest';
import { selectDailyChange } from './dailyChange';
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
