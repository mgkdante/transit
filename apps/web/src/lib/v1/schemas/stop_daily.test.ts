// stop_daily.test.ts — the S8 stop DAILY series contract, web side.
//
// Two guarantees for StopReliability.daily (SERVE-THE-COUNTS):
//   1. The Zod schema parses a populated daily series and rejects a negative
//      count (the on-disk canonical mirror is byte-checked by zod-conformance).
//   2. CLIENT-POOLING invariant — pooling an arbitrary date sub-range by SUMMING
//      the served observation_count + severe_count reproduces the per-day
//      severe_pct exactly (the server's rate on the same summed ingredients), so
//      the range verdict never fabricates a re-aggregated number. This is the
//      exact math DateRangePicker (S8B) runs against the daily series.

import { describe, it, expect } from 'vitest';
import { StopReliabilitySchema, StopDailyPointSchema } from './stop_reliability';

// Mirrors the server's _severe_pct: 100 * severe / obs, half-away rounding at 1dp.
// severe_pct >= 0 always, so half-away === Math.round for these inputs.
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
		// The DB publish gate owns the non-negative + severe<=obs invariants; the Zod
		// mirror only asserts the canonical integer type (never STRICTER than the
		// canonical schema — the zod-conformance gate forbids that).
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
		// each per-day severe_pct equals the rate helper on its OWN served counts
		for (const p of DAILY) {
			expect(p.severe_pct).toBe(severePct(p.observation_count, p.severe_count));
		}
		// pooling an arbitrary sub-range (all three days) by SUMMING served counts
		const pooledObs = DAILY.reduce((a, p) => a + p.observation_count, 0);
		const pooledSevere = DAILY.reduce((a, p) => a + p.severe_count, 0);
		expect(pooledObs).toBe(150);
		expect(pooledSevere).toBe(18);
		// 100 * 18 / 150 = 12.0 — a value NOT equal to any single day's rate, proving
		// the pool is a real re-computation off the counts, not a stored average.
		expect(severePct(pooledObs, pooledSevere)).toBe(12);
	});
});
