import { describe, expect, it } from 'vitest';
import { dailyPercentileCaption, selectDailyPercentiles } from './dailyPercentiles';

function range(p50: number | null, p90: number | null) {
	return {
		window: { from: '2026-06-17', to: '2026-06-17' },
		delayPercentiles: {
			status: 'complete',
			value: [
				{
					date: '2026-06-17',
					value: {
						p50_delay_seconds: p50,
						p90_delay_seconds: p90,
						observation_count: 40,
					},
				},
			],
		},
	} satisfies NonNullable<Parameters<typeof selectDailyPercentiles>[0]>;
}

describe('daily percentile spread', () => {
	it('subtracts seconds before rounding once, with the selected date and percentile population', () => {
		const day = selectDailyPercentiles(range(32, 88))!;
		expect(day.spreadMin).toBe(56 / 60);
		expect(dailyPercentileCaption(day, 'en')).toBe(
			'p90 − median spread: 0.9 min. 2026-06-17 · 40 eligible delay predictions.',
		);
		expect(dailyPercentileCaption(day, 'fr')).toContain('Écart p90 − médiane : 0,9 min.');
	});

	it.each([
		[null, 90],
		[30, null],
		[Infinity, 90],
		[30, NaN],
		[90, 30],
	])('withholds an invalid spread (%s, %s) without manufacturing zero', (p50, p90) => {
		const day = selectDailyPercentiles(range(p50, p90))!;
		expect(day.spreadMin).toBeNull();
		expect(dailyPercentileCaption(day, 'en')).toBe('2026-06-17 · 40 eligible delay predictions.');
	});

	it('preserves a real zero and partial coverage', () => {
		const input = range(-60, -60);
		const day = selectDailyPercentiles({
			...input,
			delayPercentiles: { ...input.delayPercentiles, status: 'partial' },
		})!;
		expect(day.spreadMin).toBe(0);
		expect(dailyPercentileCaption(day, 'en')).toContain(
			'0.0 min. 2026-06-17 · 40 eligible delay predictions · partial coverage.',
		);
	});

	it('never subtracts across dates or presents a multi-day spread', () => {
		const input = range(30, 90);
		expect(
			selectDailyPercentiles({ ...input, window: { from: '2026-06-16', to: '2026-06-17' } }),
		).toBeNull();
		expect(
			selectDailyPercentiles({ ...input, window: { from: '2026-06-16', to: '2026-06-16' } }),
		).toBeNull();
		expect(selectDailyPercentiles(null)).toBeNull();
	});
});
