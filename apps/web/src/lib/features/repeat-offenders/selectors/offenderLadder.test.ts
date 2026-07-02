import { describe, expect, it } from 'vitest';
import { selectOffenderLadder } from './offenderLadder';
import type { RepeatOffenderEntry } from '$lib/v1/schemas';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';

const labels = {
	title: 'Worst offenders',
	xLabel: 'Severe-delay rate',
	unit: '%',
	ciLabel: '95% CI',
	note: (e: RepeatOffenderEntry) => `n=${e.observation_count ?? 0}`,
	unnamed: (e: RepeatOffenderEntry) => `Item ${e.id}`,
	href: (e: RepeatOffenderEntry) => (e.route ? `/lines/${e.route}` : null),
};

const entry = (over: Partial<RepeatOffenderEntry>): RepeatOffenderEntry => ({
	type: 'trip',
	id: 'T1',
	route: '11',
	route_name: 'Montagne',
	severe_pct: 40,
	observation_count: 100,
	...over,
});

describe('selectOffenderLadder', () => {
	it('pins the ABSOLUTE SEVERE_DOMAIN [0,100] and never re-sorts (sort: given)', () => {
		const res = selectOffenderLadder(
			[entry({}), entry({ id: 'T2', severe_pct: 90 })],
			10,
			'en',
			labels,
		);
		expect(res.spec.kind).toBe('magnitude-bars');
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.domain).toEqual(SEVERE_DOMAIN);
		expect(res.spec.domain).toEqual([0, 100]);
		expect(res.spec.sort).toBe('given');
		expect(res.spec.mark).toBe('lollipop');
		expect(res.spec.scale).toBe('severity');
		// DB order is PRESERVED — T1 (40) stays first even though T2 (90) is "worse".
		expect(res.spec.rows.map((r) => r.value)).toEqual([40, 90]);
	});

	it('encodes severe_pct as the bar value and flips the Wilson CI onto the severe scale', () => {
		// wilson_lo/hi bracket the NOT-severe rate; the flip is [100 - hi, 100 - lo].
		const res = selectOffenderLadder(
			[entry({ severe_pct: 40, wilson_lo: 55, wilson_hi: 65 })],
			10,
			'en',
			labels,
		);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		const row = res.spec.rows[0];
		expect(row.value).toBe(40);
		expect(row.wilsonLo).toBe(100 - 65); // 35
		expect(row.wilsonHi).toBe(100 - 55); // 45
	});

	it('null severe_pct → a no-data value (null), never a fabricated 0', () => {
		const res = selectOffenderLadder([entry({ severe_pct: null })], 10, 'en', labels);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.rows[0].value).toBeNull();
	});

	it('null Wilson bounds → null CI (honest absence), never a fabricated interval', () => {
		const res = selectOffenderLadder(
			[entry({ wilson_lo: null, wilson_hi: null })],
			10,
			'en',
			labels,
		);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.rows[0].wilsonLo).toBeNull();
		expect(res.spec.rows[0].wilsonHi).toBeNull();
	});

	it('truncates to the worst-N cap as a DISPLAY slice (shown ≤ cap, total = full)', () => {
		const entries = Array.from({ length: 8 }, (_, i) => entry({ id: `T${i}`, severe_pct: 50 - i }));
		const res = selectOffenderLadder(entries, 5, 'en', labels);
		expect(res.total).toBe(8);
		expect(res.shown).toBe(5);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.rows).toHaveLength(5);
	});

	it('an empty ranked set → an honest absence spec, never an empty axis', () => {
		const res = selectOffenderLadder([], 10, 'en', labels);
		expect(res.spec.kind).toBe('absence');
		expect(res.shown).toBe(0);
		expect(res.total).toBe(0);
	});

	it('labels a row by route_name, falling back to the unnamed builder', () => {
		const res = selectOffenderLadder([entry({ route_name: null, route: '77' })], 10, 'en', labels);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.rows[0].label).toBe('Item T1');
	});
});
