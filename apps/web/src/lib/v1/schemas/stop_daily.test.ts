import { describe, it, expect } from 'vitest';
import { StopReliabilitySchema, StopDailyPointSchema } from './stop_reliability';

function severePct(obs: number, severe: number): number | null {
	if (!obs || obs <= 0) return null;
	return Math.round((1000 * severe) / obs) / 10;
}

const DAILY = [
	{
		date: '2026-06-01',
		observation_count: 40,
		severe_count: 4,
		severe_pct: 10,
		avg_delay_min: 1.5,
	},
	{
		date: '2026-06-02',
		observation_count: 60,
		severe_count: 9,
		severe_pct: 15,
		avg_delay_min: 2.1,
	},
	{
		date: '2026-06-03',
		observation_count: 50,
		severe_count: 5,
		severe_pct: 10,
		avg_delay_min: 1.8,
	},
];

describe('S8 stop daily series contract', () => {
	it('parses a populated daily series', () => {
		const stop = {
			generated_utc: '2026-07-02T00:00:00Z',
			id: 's1',
			daily: DAILY,
		};
		const parsed = StopReliabilitySchema.parse(stop);
		expect(parsed.daily).toHaveLength(3);
	});

	it('rejects a non-integer count (counts are whole observation tallies)', () => {
		expect(() =>
			StopDailyPointSchema.parse({ date: '2026-06-01', observation_count: 1.5, severe_count: 0 }),
		).toThrow();
	});

	it('allows honest-NULL severe_pct / avg_delay_min (optional)', () => {
		const p = StopDailyPointSchema.parse({
			date: '2026-06-01',
			observation_count: 5,
			severe_count: 0,
		});
		expect(p.severe_pct ?? null).toBeNull();
		expect(p.avg_delay_min ?? null).toBeNull();
	});

	it('CLIENT-POOLING: summed counts reproduce the served per-day + pooled rate exactly', () => {
		for (const p of DAILY) {
			expect(p.severe_pct).toBe(severePct(p.observation_count, p.severe_count));
		}
		const pooledObs = DAILY.reduce((a, p) => a + p.observation_count, 0);
		const pooledSevere = DAILY.reduce((a, p) => a + p.severe_count, 0);
		expect(pooledObs).toBe(150);
		expect(pooledSevere).toBe(18);
		expect(severePct(pooledObs, pooledSevere)).toBe(12);
	});
});
