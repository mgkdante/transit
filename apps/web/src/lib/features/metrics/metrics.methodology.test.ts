import { describe, it, expect } from 'vitest';
import {
	methodologyNoteFor,
	METHODOLOGY_METRIC_KEY,
	METRIC_METHODOLOGY_KEY,
	METRICS_BY_KEY,
} from './metrics.content';

describe('methodologyNoteFor (pure resolver)', () => {
	const methodology = {
		otp_definition: 'on-time = observed delay between -60s and +300s',
		percentiles: 'route and stop p50/p90 from a daily fact-derived percentile rollup',
		cancellation: 'cancellation_rate = canceled trip-days / observed trip-days',
		network_no_data: 'network.json values are null (not 0) when their denominator is empty',
		occupancy: '   ',
	};

	it('returns the verbatim published string for a mapped metric', () => {
		expect(methodologyNoteFor('otp', methodology)).toBe(methodology.otp_definition);
		expect(methodologyNoteFor('p50p90', methodology)).toBe(methodology.percentiles);
		expect(methodologyNoteFor('cancellation', methodology)).toBe(methodology.cancellation);
	});

	it('returns null for a metric with no methodology key (e.g. excessWait)', () => {
		expect(methodologyNoteFor('excessWait', methodology)).toBeNull();
	});

	it('returns null when the mapped key is absent from the dict', () => {
		expect(METRIC_METHODOLOGY_KEY.avgDelay).toBe('delay_unit');
		expect(methodologyNoteFor('avgDelay', methodology)).toBeNull();
	});

	it('returns null for a blank / whitespace-only published value', () => {
		expect(methodologyNoteFor('occupancy', methodology)).toBeNull();
	});

	it('returns null for a null / absent methodology dict', () => {
		expect(methodologyNoteFor('otp', null)).toBeNull();
		expect(methodologyNoteFor('otp', undefined)).toBeNull();
		expect(methodologyNoteFor('otp', {})).toBeNull();
	});

	it('maps every methodology key to a real, distinct metric', () => {
		const metricKeys = Object.values(METHODOLOGY_METRIC_KEY);
		for (const k of metricKeys) expect(METRICS_BY_KEY[k]).toBeDefined();
		expect(new Set(metricKeys).size).toBe(metricKeys.length);
	});
});
