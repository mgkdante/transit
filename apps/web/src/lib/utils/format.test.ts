import { describe, expect, it } from 'vitest';
import { fmtCount, fmtDelayMin, fmtPct } from './format';

const ABSENT = [null, undefined, NaN, Infinity, -Infinity] as const;

describe('fmtPct — honesty branch', () => {
	it('returns null for every absent input by default (caller renders no-data)', () => {
		for (const v of ABSENT) expect(fmtPct(v)).toBeNull();
	});

	it('returns the localized no-data string when one is supplied', () => {
		for (const v of ABSENT) expect(fmtPct(v, { noData: 'no data' })).toBe('no data');
	});

	it('never fabricates a 0 or a bare dot for an absent value', () => {
		for (const v of ABSENT) {
			const out = fmtPct(v, { noData: 'no data' });
			expect(out).not.toBe('0');
			expect(out).not.toBe('0%');
			expect(out).not.toContain('·');
		}
	});
});

describe('fmtPct — rounding + suffix variants', () => {
	it('raw value with default % suffix (Cluster01, +page raw percent)', () => {
		expect(fmtPct(82)).toBe('82%');
	});

	it('rounds whole percentages', () => {
		expect(fmtPct(81.6, { rounding: 'round' })).toBe('82%');
		expect(fmtPct(82.4, { rounding: 'round' })).toBe('82%');
	});

	it('formats one-decimal percentages', () => {
		expect(fmtPct(4.2, { rounding: 'fixed1' })).toBe('4.2%');
		expect(fmtPct(2.56, { rounding: 'fixed1' })).toBe('2.6%');
		expect(fmtPct(3, { rounding: 'fixed1' })).toBe('3.0%');
	});

	it('custom suffix token (receipt/network t.units.pct)', () => {
		expect(fmtPct(82, { suffix: '%', noData: 'no data' })).toBe('82%');
	});

	it('locale-aware percent with FR " %" suffix (SnapshotStrip)', () => {
		expect(fmtPct(82, { locale: 'fr', suffix: ' %' })).toBe('82 %');
		expect(fmtPct(82, { locale: 'en', suffix: '%' })).toBe('82%');
	});

	it('locale grouping applies to the numeric core when locale is passed', () => {
		expect(fmtPct(1234, { locale: 'en', suffix: '%' })).toBe('1,234%');
	});
});

describe('fmtCount — honesty branch', () => {
	it('returns null for every absent input by default', () => {
		for (const v of ABSENT) expect(fmtCount(v)).toBeNull();
	});

	it('returns the localized no-data string when supplied', () => {
		for (const v of ABSENT) expect(fmtCount(v, { noData: 'no data' })).toBe('no data');
	});

	it('never fabricates a 0 for an absent value', () => {
		for (const v of ABSENT) expect(fmtCount(v, { noData: 'no data' })).not.toBe('0');
	});
});

describe('fmtCount — rounding + locale variants', () => {
	it('raw integer, no suffix (Cluster02 count)', () => {
		expect(fmtCount(5)).toBe('5');
	});

	it('localized thousands separators (receipt/network/+page count)', () => {
		expect(fmtCount(1234, { locale: 'en' })).toBe('1,234');
		// FR uses a narrow no-break space as the grouping separator.
		expect(fmtCount(1234, { locale: 'fr' })).toMatch(/^1\s?234$/u);
	});

	it('formats a one-decimal number without units', () => {
		expect(fmtCount(3.25, { rounding: 'fixed1' })).toBe('3.3');
		expect(fmtCount(4, { rounding: 'fixed1' })).toBe('4.0');
	});

	it('a real 0 still renders as "0" (a present value is NOT no-data)', () => {
		expect(fmtCount(0)).toBe('0');
	});
});

describe('fmtDelayMin — honesty branch', () => {
	it('returns null for every absent input by default', () => {
		for (const v of ABSENT) expect(fmtDelayMin(v)).toBeNull();
	});

	it('returns the localized no-data string when supplied', () => {
		for (const v of ABSENT) expect(fmtDelayMin(v, { noData: 'no data' })).toBe('no data');
	});

	it('never fabricates "0 min" for an absent value', () => {
		for (const v of ABSENT) {
			const out = fmtDelayMin(v, { noData: 'no data' });
			expect(out).not.toBe('0 min');
			expect(out).not.toContain('·');
		}
	});
});

describe('fmtDelayMin — rounding + suffix variants', () => {
	it('raw value + default " min" suffix (network fmtMin)', () => {
		expect(fmtDelayMin(3)).toBe('3 min');
	});

	it('formats one-decimal minute values', () => {
		expect(fmtDelayMin(3.2, { rounding: 'fixed1' })).toBe('3.2 min');
		expect(fmtDelayMin(12.4, { rounding: 'fixed1' })).toBe('12.4 min');
	});

	it('auto rounding keeps integers integer, else one decimal (receipt fmtMin)', () => {
		expect(fmtDelayMin(3, { rounding: 'auto' })).toBe('3 min');
		expect(fmtDelayMin(3.4, { rounding: 'auto' })).toBe('3.4 min');
		expect(fmtDelayMin(3.25, { rounding: 'auto' })).toBe('3.3 min');
	});

	it('auto + locale defers to Intl with <=1 fraction digit (SnapshotStrip)', () => {
		expect(fmtDelayMin(3, { rounding: 'auto', locale: 'en' })).toBe('3 min');
		expect(fmtDelayMin(3.2, { rounding: 'auto', locale: 'en' })).toBe('3.2 min');
	});

	it('custom suffix token (receipt/network t.units.min)', () => {
		expect(fmtDelayMin(3, { suffix: ' min', noData: 'no data' })).toBe('3 min');
	});

	it('a real 0 renders "0 min" (a present value is NOT no-data)', () => {
		expect(fmtDelayMin(0)).toBe('0 min');
	});
});

describe('unitless numeric formatting', () => {
	it('shares the count implementation while allowing bounded localized precision', async () => {
		const { fmtNumber } = await import('./format');
		expect(fmtNumber).toBe(fmtCount);
		expect(fmtNumber(200 / 3, { rounding: 'auto', locale: 'en' })).toBe('66.7');
		expect(fmtNumber(200 / 3, { rounding: 'auto', locale: 'fr' })).toBe('66,7');
		expect(fmtNumber(0, { rounding: 'auto', locale: 'fr' })).toBe('0');
		for (const value of [null, undefined, NaN, Infinity])
			expect(fmtNumber(value, { rounding: 'auto', locale: 'en' })).toBeNull();
	});
});

describe('metric display rounding', () => {
	it.each([
		['round', 2.5, '3', '-3'],
		['fixed1', 2.55, '2.6', '-2.6'],
		['auto', 2.55, '2.6', '-2.6'],
	] as const)(
		'%s uses decimal half-away ties with or without a locale',
		(rounding, value, positive, negative) => {
			for (const locale of [undefined, 'en', 'fr'] as const) {
				const local = (text: string) => (locale === 'fr' ? text.replace('.', ',') : text);
				expect(fmtDelayMin(value, { rounding, locale })).toBe(local(positive) + ' min');
				expect(fmtDelayMin(-value, { rounding, locale })).toBe(local(negative) + ' min');
				expect(fmtPct(-value, { rounding, locale })).toBe(local(negative) + '%');
			}
		},
	);
});
