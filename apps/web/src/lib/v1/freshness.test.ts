import { describe, expect, it } from 'vitest';
import { tierFreshness, type FreshnessTier } from './freshness';
import type { Manifest } from './schemas';

// tierFreshness turns a tier's manifest pointer into a published/age/stale
// verdict. Staleness is DERIVED (2x the tier's effective ttl), never a literal
// 30s — so the boundary cases here exercise the per-tier scaling, the null /
// absent generated_utc empty-state path, clock-skew clamping, and bad input.

const NOW = new Date('2026-06-15T12:00:00Z');

/** Minimal valid Manifest carrying just the per-tier files we vary. */
function manifest(
	files: Partial<Manifest['files']> & { live?: Manifest['files']['live'] },
): Manifest {
	return {
		provider: 'stm',
		display_name: 'STM',
		bbox: [-73.9, 45.4, -73.4, 45.7],
		attribution: 'STM',
		dataset_version: 'test',
		labels: {},
		surfaces: [],
		files: {
			// live.generated_utc is required by the schema; default it far in the past
			// so the live node is always present unless a test overrides it.
			live: { generated_utc: '2026-06-15T11:59:00Z' },
			...files,
		},
	} as Manifest;
}

/** Build a Manifest whose given tier was generated `ageS` seconds before NOW. */
function manifestAged(tier: FreshnessTier, ageS: number, ttlS?: number): Manifest {
	const generated = new Date(NOW.getTime() - ageS * 1000).toISOString();
	const node = {
		generated_utc: generated,
		...(ttlS != null ? { ttl_s: ttlS } : {}),
	} as Manifest['files']['live'];
	if (tier === 'live') return manifest({ live: node });
	return manifest({ [tier]: node } as Partial<Manifest['files']>);
}

describe('tierFreshness — published verdict + age math', () => {
	it('reports published with the clamped age and the source generated_utc', () => {
		const f = tierFreshness('live', manifestAged('live', 10), NOW);
		expect(f.published).toBe(true);
		if (!f.published) throw new Error('expected published');
		expect(f.ageSeconds).toBe(10);
		expect(f.generatedUtc).toBe(new Date(NOW.getTime() - 10_000).toISOString());
	});

	it('clamps a future-stamped build (clock skew) to age 0, not negative', () => {
		const f = tierFreshness('live', manifestAged('live', -30), NOW);
		expect(f.published).toBe(true);
		if (!f.published) throw new Error('expected published');
		expect(f.ageSeconds).toBe(0);
		expect(f.isStale).toBe(false);
	});
});

describe('tierFreshness — staleness threshold (2x effective ttl)', () => {
	// live default ttl 30 → stale at age >= 60.
	it('live: fresh below the 60s threshold', () => {
		const f = tierFreshness('live', manifestAged('live', 59), NOW);
		if (!f.published) throw new Error('expected published');
		expect(f.isStale).toBe(false);
	});

	it('live: stale exactly AT the 60s boundary (>=)', () => {
		const f = tierFreshness('live', manifestAged('live', 60), NOW);
		if (!f.published) throw new Error('expected published');
		expect(f.isStale).toBe(true);
	});

	it('live: stale above the boundary', () => {
		const f = tierFreshness('live', manifestAged('live', 120), NOW);
		if (!f.published) throw new Error('expected published');
		expect(f.isStale).toBe(true);
	});

	// static/historic default ttl 86400 → stale at age >= 172800 (~2 days).
	it.each<FreshnessTier>(['static', 'historic'])(
		'%s: scales the threshold to ~2 days, not 60s',
		(tier) => {
			// One day old: well past the 60s live threshold, but fresh for a daily tier.
			const oneDay = tierFreshness(tier, manifestAged(tier, 86_400), NOW);
			if (!oneDay.published) throw new Error('expected published');
			expect(oneDay.isStale).toBe(false);

			// Exactly 2x ttl: stale at the boundary.
			const twoDays = tierFreshness(tier, manifestAged(tier, 172_800), NOW);
			if (!twoDays.published) throw new Error('expected published');
			expect(twoDays.isStale).toBe(true);
		},
	);

	it('honors a manifest-supplied ttl_s over the schema default', () => {
		// ttl_s 10 → stale threshold 20s.
		const fresh = tierFreshness('live', manifestAged('live', 19, 10), NOW);
		if (!fresh.published) throw new Error('expected published');
		expect(fresh.isStale).toBe(false);

		const stale = tierFreshness('live', manifestAged('live', 20, 10), NOW);
		if (!stale.published) throw new Error('expected published');
		expect(stale.isStale).toBe(true);
	});
});

describe('tierFreshness — unpublished + bad-input empty states', () => {
	it('reports { published: false } when generated_utc is null', () => {
		const m = manifest({ static: { generated_utc: null } });
		expect(tierFreshness('static', m, NOW)).toEqual({ published: false });
	});

	it('reports { published: false } when the tier node is absent entirely', () => {
		// No static node at all → tierPointer reads generatedUtc as null.
		const m = manifest({});
		expect(tierFreshness('historic', m, NOW)).toEqual({ published: false });
	});

	it('treats an invalid timestamp as never-published rather than NaN-stale', () => {
		const m = manifest({ static: { generated_utc: 'not-a-date' } as Manifest['files']['live'] });
		expect(tierFreshness('static', m, NOW)).toEqual({ published: false });
	});
});
