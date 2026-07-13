// receipts_regranulation.test.ts — the S13 re-granulated receipt, web side.
//
// Guarantees for Receipt.by_shift / Receipt.service_states and ReceiptsIndex.available
// (the on-disk canonical JSON mirror is byte-checked by zod-conformance):
//   1. ADDITIVE-OPTIONAL back-compat — a pre-S13 receipt (scalar-only, no by_shift /
//      service_states) and a pre-S13 index (dates-only, no available) still parse.
//   2. A populated payload parses: ordered shift cuts, the service-state split with the
//      ONE completeness number + the not-reported route list, and per-date availability.
//   3. Honest-NULL survives the round-trip (null completeness, null counts).

import { describe, it, expect } from 'vitest';
import { ReceiptSchema } from './receipts';
import { ReceiptsIndexSchema } from './receipts_index';

describe('Receipt.by_shift / service_states — S13 re-granulation', () => {
	it('parses a scalar-only (pre-S13) receipt — the new cuts are additive-optional', () => {
		const legacy = {
			generated_utc: '2026-06-08T00:00:00Z',
			date: '2026-06-08',
			otp_pct: 82,
			avg_delay_min: 3.4,
			affected_routes: 5,
			alerts: 2,
		};
		const parsed = ReceiptSchema.parse(legacy);
		expect(parsed.by_shift).toBeUndefined();
		expect(parsed.service_states).toBeUndefined();
		expect(parsed.otp_pct).toBe(82);
	});

	it('parses ordered shift cuts + the service-state split + not-reported list', () => {
		const payload = {
			generated_utc: '2026-06-08T00:00:00Z',
			date: '2026-06-08',
			otp_pct: 70,
			avg_delay_min: 6.1,
			severe_pct: 12.3,
			by_shift: [
				{
					shift: 'am_peak',
					observation_count: 200,
					severe_count: 10,
					severe_pct: 5,
					avg_delay_min: 4.2,
				},
				{
					shift: 'pm_peak',
					observation_count: 180,
					severe_count: 20,
					severe_pct: 11.1,
					avg_delay_min: 7.9,
				},
			],
			service_states: {
				scheduled_trip_days: 100,
				delivered_trip_days: 80,
				cancelled_trip_days: 5,
				silent_trip_days: 15,
				not_reported_route_count: 3,
				service_completeness_pct: 80,
				not_reported_routes: [
					{ id: '51', name: 'Édouard-Montpetit', scheduled_trip_days: 12 },
					{ id: '24', name: 'Sherbrooke', scheduled_trip_days: 8 },
				],
			},
		};
		const parsed = ReceiptSchema.parse(payload);
		expect(parsed.by_shift?.map((c) => c.shift)).toEqual(['am_peak', 'pm_peak']);
		expect(parsed.service_states?.service_completeness_pct).toBe(80);
		expect(parsed.service_states?.not_reported_route_count).toBe(3);
		expect(parsed.service_states?.not_reported_routes?.[0].id).toBe('51');
	});

	it('round-trips honest-NULL completeness + counts (never fabricated 0)', () => {
		const parsed = ReceiptSchema.parse({
			generated_utc: '2026-06-08T00:00:00Z',
			date: '2026-06-08',
			service_states: {
				scheduled_trip_days: null,
				delivered_trip_days: null,
				cancelled_trip_days: 2,
				service_completeness_pct: null,
				not_reported_route_count: null,
			},
		});
		expect(parsed.service_states?.service_completeness_pct).toBeNull();
		expect(parsed.service_states?.scheduled_trip_days).toBeNull();
		expect(parsed.service_states?.cancelled_trip_days).toBe(2);
	});
});

describe('ReceiptsIndex.available — S13 availability metadata', () => {
	it('parses a dates-only (pre-S13) index — available is additive-optional', () => {
		const parsed = ReceiptsIndexSchema.parse({
			generated_utc: '2026-06-08T00:00:00Z',
			dates: ['2026-06-07', '2026-06-08'],
		});
		expect(parsed.available).toBeUndefined();
		expect(parsed.collection_generation_id).toBeUndefined();
		expect(parsed.dates).toEqual(['2026-06-07', '2026-06-08']);
	});

	it('preserves the additive semantic collection generation pin', () => {
		const parsed = ReceiptsIndexSchema.parse({
			generated_utc: '2026-06-08T00:00:00Z',
			collection_generation_id: 'semantic-receipt-generation',
		});
		expect(parsed.collection_generation_id).toBe('semantic-receipt-generation');
	});

	it('parses per-date availability distinguishing rich / shell / schedule-known days', () => {
		const parsed = ReceiptsIndexSchema.parse({
			generated_utc: '2026-06-08T00:00:00Z',
			dates: ['2026-06-07', '2026-06-08'],
			available: [
				{ date: '2026-06-07', has_data: true, has_schedule: true, publish_generation_id: 'g1' },
				{ date: '2026-06-08', has_data: false, has_schedule: false },
			],
		});
		expect(parsed.available?.[0].has_data).toBe(true);
		expect(parsed.available?.[1].has_data).toBe(false);
		expect(parsed.available?.[0].publish_generation_id).toBe('g1');
	});
});
