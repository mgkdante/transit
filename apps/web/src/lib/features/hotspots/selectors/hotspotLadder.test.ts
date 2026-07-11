// hotspotLadder.test.ts — the S12 cross-kind worst-N ladder selector.
//
// Guarantees: the DB Wilson-LB worst-first order is PRESERVED (preRanked, no re-sort);
// the bar rides the ABSOLUTE SEVERE_DOMAIN [0,100] literal (never in-view /max); the
// worst-N cap TRUNCATES without rescaling (fewer rows, same domain); evidence fields
// (n, flipped Wilson CI, note, href) map through; and an empty grain degrades to the
// honest AbsenceSpec.

import { describe, it, expect } from 'vitest';
import { selectHotspotLadder, type HotspotLadderLabels } from './hotspotLadder';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import type { HotspotEntry } from '$lib/v1/schemas';
import type { MagnitudeBarsSpec, AbsenceSpec } from '$lib/components/dataviz/chart';

const labels: HotspotLadderLabels = {
	title: 'Worst spots',
	xLabel: 'Severe-delay rate',
	unit: '%',
	ciLabel: '95% CI',
	note: (e) => `n=${e.observation_count}`,
	unnamed: (id) => `Item ${id}`,
	href: (e) => (e.type === 'stop' ? `/stop/${e.id}` : e.type === 'route' ? `/lines/${e.id}` : null),
	tapPopover: (entry, href, evidence) => {
		const heading = entry.name ?? `Item ${entry.id}`;
		return {
			key: `${entry.type}-${entry.id}`,
			heading,
			meta: `${entry.type} · ${entry.id}`,
			rows: [
				...(entry.severe_pct != null
					? [{ label: 'Severe-delay rate', value: `${entry.severe_pct}%` }]
					: []),
				...(evidence.wilsonLo != null && evidence.wilsonHi != null
					? [{ label: '95% CI', value: `${evidence.wilsonLo}%–${evidence.wilsonHi}%` }]
					: []),
			],
			...(href
				? {
						action: {
							href,
							label: entry.type === 'route' ? 'View line' : 'View stop',
							ariaLabel: `View detail for ${heading}`,
						},
					}
				: {}),
		};
	},
};

const entries: HotspotEntry[] = [
	{
		rank: 1,
		type: 'stop',
		id: 'S1',
		name: 'Berri-UQAM',
		severe_pct: 70,
		observation_count: 80,
		wilson_lo: 16.8,
		wilson_hi: 30.1,
		otp_delta_pts: -20,
		avg_delay_min: 6.7,
	},
	{
		rank: 2,
		type: 'route',
		id: '51',
		severe_pct: 40,
		observation_count: 100,
		wilson_lo: 50.2,
		wilson_hi: 60,
	},
	{ rank: 3, type: 'stop', id: 'S3', severe_pct: null, observation_count: 30 },
];

const asBars = (r: { spec: unknown }): MagnitudeBarsSpec => r.spec as MagnitudeBarsSpec;

describe('selectHotspotLadder', () => {
	it('preserves the DB worst-first order (preRanked — no re-sort)', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		expect(spec.rows.map((row) => row.key)).toEqual(['stop-S1', 'route-51', 'stop-S3']);
	});

	it('rides the ABSOLUTE SEVERE_DOMAIN [0,100] literal, lollipop, given-sort', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		expect(spec.domain).toBe(SEVERE_DOMAIN);
		expect(spec.domain).toEqual([0, 100]);
		expect(spec.mark).toBe('lollipop');
		expect(spec.sort).toBe('given');
		expect(spec.scale).toBe('severity');
	});

	it('encodes severe_pct as the bar value (the rank variable, always >= 0)', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		expect(spec.rows[0].value).toBe(70);
		expect(spec.rows[1].value).toBe(40);
		// a null severe_pct → an honest no-data swatch, never a fake 0.
		expect(spec.rows[2].value).toBeNull();
	});

	it('flips the Wilson CI onto the severe scale so it brackets the bar value', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		// wilson_lo/hi bracket the NOT-severe rate; the displayed CI = [100 - hi, 100 - lo].
		expect(spec.rows[0].wilsonLo).toBe(69.9); // 100 - 30.1
		expect(spec.rows[0].wilsonHi).toBe(83.2); // 100 - 16.8
		// a row missing a bound → null CI (honest absence).
		expect(spec.rows[2].wilsonLo).toBeNull();
		expect(spec.rows[2].wilsonHi).toBeNull();
	});

	it('maps evidence: n, note, and the drill href per kind', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		expect(spec.rows[0].n).toBe(80);
		expect(spec.rows[0].note).toBe('n=80');
		expect(spec.rows[0].href).toBe('/stop/S1');
		expect(spec.rows[1].href).toBe('/lines/51');
		expect(spec.ciLabel).toBe('95% CI');
	});

	it('maps a normalized popover with row identity, flipped evidence, and the drill action', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		expect(spec.rows[0].tapPopover).toEqual({
			key: 'stop-S1',
			heading: 'Berri-UQAM',
			meta: 'stop · S1',
			rows: [
				{ label: 'Severe-delay rate', value: '70%' },
				{ label: '95% CI', value: '69.9%–83.2%' },
			],
			action: {
				href: '/stop/S1',
				label: 'View stop',
				ariaLabel: 'View detail for Berri-UQAM',
			},
		});
		expect(spec.rows[1].tapPopover?.heading).toBe('Item 51');
	});

	it('falls back to the unnamed label when the cell has no name', () => {
		const spec = asBars(selectHotspotLadder(entries, 10, 'en', labels));
		expect(spec.rows[1].label).toBe('Item 51'); // route 51 has no name
	});

	it('truncates to the worst-N cap WITHOUT rescaling — fewer rows, same domain', () => {
		const capped = selectHotspotLadder(entries, 2, 'en', labels);
		const spec = asBars(capped);
		expect(spec.rows).toHaveLength(2);
		expect(spec.rows.map((r) => r.key)).toEqual(['stop-S1', 'route-51']);
		// the domain is the FIXED literal regardless of the cap (never in-view /max).
		expect(spec.domain).toEqual([0, 100]);
		// the honest counts: shown < total.
		expect(capped.total).toBe(3);
		expect(capped.shown).toBe(2);
	});

	it('Infinity cap (the "all" rung) shows every ranked entry', () => {
		const r = selectHotspotLadder(entries, Number.POSITIVE_INFINITY, 'en', labels);
		expect(r.shown).toBe(3);
		expect(r.total).toBe(3);
	});

	it('degrades an empty grain to the honest AbsenceSpec (no fake ladder)', () => {
		const r = selectHotspotLadder([], 10, 'en', labels);
		const spec = r.spec as AbsenceSpec;
		expect(spec.kind).toBe('absence');
		expect(spec.reason).toBe('no-observations');
		expect(r.total).toBe(0);
		expect(r.shown).toBe(0);
	});

	it('drops the href for an unknown cell type (a plain, non-linked row)', () => {
		const spec = asBars(
			selectHotspotLadder([{ type: 'corridor', id: 'C9', severe_pct: 10 }], 10, 'en', labels),
		);
		expect(spec.rows[0].href).toBeUndefined();
		expect(spec.rows[0].tapPopover?.action).toBeUndefined();
	});
});
