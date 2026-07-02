import { describe, it, expect } from 'vitest';
import { selectDelayHistogram } from './delayHistogram';
import { NETWORK_DELAY_HISTOGRAM_DOMAIN } from '$lib/features/reliability/domains';
import type { DelayBucket } from '$lib/v1/schemas';

const labels = {
	title: 'Delay distribution',
	caption: 'How delays spread now',
	unit: ' min',
	xLabel: 'Delay (min)',
	yLabel: 'Trips',
};

const buckets: DelayBucket[] = [
	{ lo_min: null, hi_min: -5, count: 1 },
	{ lo_min: -5, hi_min: -2, count: 4 },
	{ lo_min: -2, hi_min: 0, count: 12 },
	{ lo_min: 0, hi_min: 2, count: 20 },
	{ lo_min: 2, hi_min: 5, count: 30 },
	{ lo_min: 5, hi_min: 10, count: 9 },
	{ lo_min: 10, hi_min: 15, count: 3 },
	{ lo_min: 15, hi_min: null, count: 2 },
];

describe('selectDelayHistogram', () => {
	it('emits an A1 histogram spec with the shared signed domain and all 8 bins', () => {
		const spec = selectDelayHistogram(buckets, 1, 6, 'en', labels);
		expect(spec.kind).toBe('histogram');
		if (spec.kind !== 'histogram') return;
		expect(spec.domain).toEqual(NETWORK_DELAY_HISTOGRAM_DOMAIN);
		expect(spec.bins).toHaveLength(8);
	});

	it('scales the minute edges to SECONDS so the network distribution reads on the shared axis', () => {
		const spec = selectDelayHistogram(buckets, 1, 6, 'en', labels);
		if (spec.kind !== 'histogram') throw new Error('expected histogram');
		// -5..-2 min → -300..-120 s; the unbounded edges stay null.
		expect(spec.bins[0]).toMatchObject({ lo: null, hi: -300 });
		expect(spec.bins[1]).toMatchObject({ lo: -300, hi: -120 });
		expect(spec.bins[7]).toMatchObject({ lo: 900, hi: null });
	});

	it('pins the count domain to the distribution OWN peak (zero-based, never in-view cross-view max)', () => {
		const spec = selectDelayHistogram(buckets, 1, 6, 'en', labels);
		if (spec.kind !== 'histogram') throw new Error('expected histogram');
		// The tallest bucket is 30 (2..5 min); the count axis is [0, 30], zero-anchored.
		expect(spec.countDomain).toEqual([0, 30]);
	});

	it('converts the p50/p90 refs from minutes to seconds', () => {
		const spec = selectDelayHistogram(buckets, 1, 6, 'en', labels);
		if (spec.kind !== 'histogram') throw new Error('expected histogram');
		expect(spec.medianRef).toBe(60); // 1 min
		expect(spec.p90Ref).toBe(360); // 6 min
	});

	it('keeps null refs null (no fabricated reference line)', () => {
		const spec = selectDelayHistogram(buckets, null, null, 'en', labels);
		if (spec.kind !== 'histogram') throw new Error('expected histogram');
		expect(spec.medianRef).toBeNull();
		expect(spec.p90Ref).toBeNull();
	});

	it('is honest absence on a null distribution', () => {
		const spec = selectDelayHistogram(null, 1, 6, 'en', labels);
		expect(spec.kind).toBe('absence');
	});

	it('is honest absence on a zero-total distribution (never a flat fabricated shape)', () => {
		const zero = buckets.map((b) => ({ ...b, count: 0 }));
		const spec = selectDelayHistogram(zero, 1, 6, 'en', labels);
		expect(spec.kind).toBe('absence');
	});

	it('an all-zero-but-one distribution still floors the count domain at ≥1', () => {
		const one: DelayBucket[] = [{ lo_min: 0, hi_min: 2, count: 1 }];
		const spec = selectDelayHistogram(one, null, null, 'en', labels);
		if (spec.kind !== 'histogram') throw new Error('expected histogram');
		expect(spec.countDomain).toEqual([0, 1]);
	});
});
