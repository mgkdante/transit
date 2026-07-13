import { describe, expect, it } from 'vitest';
import { selectOffenderLadder } from './offenderLadder';
import type { RepeatOffenderEntry } from '$lib/v1/schemas';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import type { ChartDatumPopoverModel } from '$lib/components/dataviz/chart';

const labels = {
	title: 'Worst offenders',
	xLabel: 'Severe-delay rate',
	unit: '%',
	ciLabel: '95% CI',
	note: (e: RepeatOffenderEntry) => `n=${e.observation_count ?? 0}`,
	unnamed: (e: RepeatOffenderEntry) => `Item ${e.id}`,
	href: (e: RepeatOffenderEntry) => (e.route ? `/lines/${e.route}` : null),
};

const popoverLabels = {
	...labels,
	tapPopover: (
		e: RepeatOffenderEntry,
		href: string | null,
		evidence: { readonly wilsonLo: number | null; readonly wilsonHi: number | null },
	): ChartDatumPopoverModel => ({
		key: `${e.type}-${e.id}-${e.route ?? ''}`,
		heading: e.route_name ?? `Item ${e.id}`,
		meta: `${e.type} · ${e.id}`,
		rows: [
			...(e.severe_pct != null ? [{ label: 'Severe-delay rate', value: `${e.severe_pct}%` }] : []),
			...(e.observation_count != null
				? [{ label: 'Readings', value: String(e.observation_count) }]
				: []),
			...(evidence.wilsonLo != null && evidence.wilsonHi != null
				? [{ label: '95% CI', value: `${evidence.wilsonLo}%–${evidence.wilsonHi}%` }]
				: []),
		],
		...(href
			? {
					action: {
						href,
						label: 'View line',
						ariaLabel: `View detail for ${e.route_name ?? e.id}`,
					},
				}
			: {}),
	}),
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

	it('attaches a caller-supplied popover to every displayed ranked row without changing chart truth', () => {
		const res = selectOffenderLadder(
			[
				entry({
					id: 'T-first',
					route: '51',
					route_name: 'First route',
					severe_pct: 82.4,
					observation_count: 210,
					wilson_lo: 10.2,
					wilson_hi: 22.5,
				}),
				entry({
					type: 'vehicle',
					id: 'V-null',
					route: null,
					route_name: null,
					severe_pct: null,
					observation_count: null,
					wilson_lo: null,
					wilson_hi: null,
				}),
				entry({ id: 'T-capped', route: '11', severe_pct: 99 }),
			],
			2,
			'en',
			popoverLabels,
		);

		expect(res.total).toBe(3);
		expect(res.shown).toBe(2);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.domain).toBe(SEVERE_DOMAIN);
		expect(res.spec.domain).toEqual([0, 100]);
		expect(res.spec.rows.map((row) => row.key)).toEqual(['trip-T-first-51', 'vehicle-V-null-']);
		expect(res.spec.rows.map((row) => row.value)).toEqual([82.4, null]);
		expect(res.spec.rows.map((row) => row.n)).toEqual([210, null]);
		expect(res.spec.rows.map((row) => [row.wilsonLo, row.wilsonHi])).toEqual([
			[77.5, 89.8],
			[null, null],
		]);
		expect(res.spec.rows[0].href).toBe('/lines/51');
		expect(res.spec.rows[1].href).toBeUndefined();
		expect(res.spec.rows.every((row) => row.tapPopover != null)).toBe(true);
		expect(res.spec.rows[0].tapPopover).toEqual({
			key: 'trip-T-first-51',
			heading: 'First route',
			meta: 'trip · T-first',
			rows: [
				{ label: 'Severe-delay rate', value: '82.4%' },
				{ label: 'Readings', value: '210' },
				{ label: '95% CI', value: '77.5%–89.8%' },
			],
			action: {
				href: '/lines/51',
				label: 'View line',
				ariaLabel: 'View detail for First route',
			},
		});
		expect(res.spec.rows[1].tapPopover?.rows).toEqual([]);
		expect(res.spec.rows[1].tapPopover?.action).toBeUndefined();
	});

	it('keeps the existing non-opt-in selector contract unchanged', () => {
		const res = selectOffenderLadder(
			[
				entry({
					severe_pct: null,
					observation_count: null,
					wilson_lo: null,
					wilson_hi: null,
				}),
			],
			10,
			'en',
			labels,
		);
		if (res.spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(res.spec.rows[0]).toMatchObject({
			value: null,
			n: null,
			wilsonLo: null,
			wilsonHi: null,
			href: '/lines/11',
		});
		expect(res.spec.rows[0].tapPopover).toBeUndefined();
	});
});
