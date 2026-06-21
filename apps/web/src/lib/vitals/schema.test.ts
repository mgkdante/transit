import { describe, expect, it } from 'vitest';
import {
	MAX_VITALS_SAMPLES,
	parseVitalsBeacon,
	parseVitalsSample,
	type VitalsSample,
} from './schema';

const valid: VitalsSample = {
	name: 'LCP',
	value: 1234.5,
	id: 'v3-1718900000000-1234567890123',
	rating: 'good',
	navType: 'navigate',
	path: '/route/11',
	conn: '4g',
};

describe('parseVitalsSample', () => {
	it('accepts a well-formed sample', () => {
		expect(parseVitalsSample(valid)).toEqual(valid);
	});

	it('drops the optional conn when absent', () => {
		const { conn, ...rest } = valid;
		void conn;
		expect(parseVitalsSample(rest)).toEqual(rest);
		expect(parseVitalsSample(rest)).not.toHaveProperty('conn');
	});

	it('rejects an unknown metric name', () => {
		expect(parseVitalsSample({ ...valid, name: 'FID' })).toBeNull();
	});

	it('rejects an unknown rating', () => {
		expect(parseVitalsSample({ ...valid, rating: 'meh' })).toBeNull();
	});

	it('rejects an unknown navType', () => {
		expect(parseVitalsSample({ ...valid, navType: 'teleport' })).toBeNull();
	});

	it('rejects a non-finite or negative value', () => {
		expect(parseVitalsSample({ ...valid, value: Number.NaN })).toBeNull();
		expect(parseVitalsSample({ ...valid, value: Infinity })).toBeNull();
		expect(parseVitalsSample({ ...valid, value: -1 })).toBeNull();
		expect(parseVitalsSample({ ...valid, value: '5' })).toBeNull();
	});

	it('rejects a path that is not a pathname', () => {
		expect(parseVitalsSample({ ...valid, path: 'route/11' })).toBeNull();
		expect(parseVitalsSample({ ...valid, path: '' })).toBeNull();
		expect(parseVitalsSample({ ...valid, path: 'x'.repeat(300) })).toBeNull();
	});

	it('rejects a missing/oversized id', () => {
		expect(parseVitalsSample({ ...valid, id: '' })).toBeNull();
		expect(parseVitalsSample({ ...valid, id: 'x'.repeat(200) })).toBeNull();
	});

	it('rejects a non-object', () => {
		expect(parseVitalsSample(null)).toBeNull();
		expect(parseVitalsSample('LCP')).toBeNull();
		expect(parseVitalsSample(42)).toBeNull();
	});
});

describe('parseVitalsBeacon', () => {
	it('returns the clean sample list for a valid envelope', () => {
		expect(parseVitalsBeacon({ samples: [valid] })).toEqual([valid]);
	});

	it('drops malformed samples but keeps valid ones', () => {
		const out = parseVitalsBeacon({ samples: [valid, { name: 'FID' }, 7] });
		expect(out).toEqual([valid]);
	});

	it('returns null on a malformed envelope', () => {
		expect(parseVitalsBeacon(null)).toBeNull();
		expect(parseVitalsBeacon({})).toBeNull();
		expect(parseVitalsBeacon({ samples: 'nope' })).toBeNull();
		expect(parseVitalsBeacon({ samples: [] })).toBeNull();
	});

	it('returns null when the batch exceeds the sample cap', () => {
		const many = Array.from({ length: MAX_VITALS_SAMPLES + 1 }, (_, i) => ({
			...valid,
			id: `id-${i}`,
		}));
		expect(parseVitalsBeacon({ samples: many })).toBeNull();
	});
});
