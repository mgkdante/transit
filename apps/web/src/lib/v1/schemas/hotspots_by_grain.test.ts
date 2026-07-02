// hotspots_by_grain.test.ts — the S12 re-granulated hotspots ladders, web side.
//
// Three guarantees for Hotspots.by_grain (the on-disk canonical mirror is
// byte-checked by zod-conformance):
//   1. ADDITIVE-OPTIONAL back-compat — a pre-S12 hotspots.json (scalar-only, no
//      by_grain key) still parses, so already-published files keep validating.
//   2. A populated by_grain ladder parses: cross-kind entries ranked on the shared
//      not-severe Wilson LB, a sub-MIN_N tray with rank=null, and the 'shift' grain
//      carrying date=null (a time-of-day cut, not a trailing window).
//   3. The ranked/tray discipline the DB serves survives the round-trip: a ranked
//      entry keeps its 1-based ladder rank; a tray entry's rank is null.

import { describe, it, expect } from 'vitest';
import { HotspotsSchema, HotspotGrainSchema } from './hotspots';

describe('Hotspots.by_grain — S12 re-granulated ladders', () => {
	it('parses a scalar-only (pre-S12) payload — by_grain is additive-optional', () => {
		const legacy = {
			generated_utc: '2026-06-19T02:00:00Z',
			hotspots: [{ rank: 1, type: 'route', id: '51', severity: 'high' }],
		};
		const parsed = HotspotsSchema.parse(legacy);
		expect(parsed.by_grain).toBeUndefined();
		expect(parsed.hotspots?.[0].id).toBe('51');
	});

	it('parses a populated cross-kind ladder + tray + a date-less shift grain', () => {
		const payload = {
			generated_utc: '2026-06-25T00:00:00Z',
			hotspots: [],
			by_grain: [
				{
					grain: 'week',
					date: '2026-06-14',
					window_end: '2026-06-20',
					entries: [
						{
							rank: 1,
							type: 'stop',
							id: 'S1',
							name: 'Berri-UQAM',
							severe_pct: 70,
							severe_count: 56,
							observation_count: 80,
							wilson_lo: 16.8,
							wilson_hi: 30.1,
							otp_delta_pts: -20,
							issue_count: 42,
							avg_delay_min: 6.7,
						},
						{
							rank: 2,
							type: 'route',
							id: '51',
							severe_pct: 40,
							observation_count: 100,
							wilson_lo: 50.2,
							wilson_hi: 60.0,
						},
					],
					tray: [{ rank: null, type: 'stop', id: 'S2', severe_pct: 5, observation_count: 12 }],
				},
				{ grain: 'shift', date: null, window_end: null, entries: [], tray: [] },
			],
		};
		const parsed = HotspotsSchema.parse(payload);
		const week = parsed.by_grain![0];
		expect(week.entries!.map((e) => [e.rank, e.type, e.id])).toEqual([
			[1, 'stop', 'S1'],
			[2, 'route', '51'],
		]);
		// tray entry: rank is null (un-ranked, sub-MIN_N)
		expect(week.tray![0].rank).toBeNull();
		// the shift grain is a time-of-day cut — no trailing window dates
		expect(parsed.by_grain![1].date).toBeNull();
		expect(parsed.by_grain![1].window_end).toBeNull();
	});

	it('a HotspotGrain with only a grain key is valid (entries/tray optional)', () => {
		expect(() => HotspotGrainSchema.parse({ grain: 'day' })).not.toThrow();
	});
});
