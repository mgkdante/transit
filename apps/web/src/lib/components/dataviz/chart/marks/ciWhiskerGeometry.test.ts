import { describe, it, expect } from 'vitest';
import { ciWhiskerGeometry, type BandScale } from './ciWhiskerGeometry';
import type { MagnitudeDatum } from '../ChartSpec';

const xScale = (v: number): number => v * 3;
const bandTops: Record<string, number> = { a: 0, b: 40, c: 80 };
const yScale = ((key: string): number | undefined => bandTops[key]) as BandScale;
yScale.bandwidth = () => 20;

const domain = [0, 100] as const;

const row = (over: Partial<MagnitudeDatum> & { key: string; label: string }): MagnitudeDatum => ({
	value: 50,
	...over,
});

describe('ciWhiskerGeometry — the pure whisker geometry (D5 visual Wilson CI)', () => {
	it('keeps identical display labels on separate keyed bands', () => {
		const keyed = ((key: string): number | undefined =>
			({ s1: 0, s2: 40 })[key as 's1' | 's2']) as BandScale;
		keyed.bandwidth = () => 20;
		const rows = [
			row({ key: 's1', label: 'Main Street', wilsonLo: 20, wilsonHi: 40 }),
			row({ key: 's2', label: 'Main Street', wilsonLo: 30, wilsonHi: 50 }),
		];
		expect(ciWhiskerGeometry(rows, xScale, keyed, domain).map((w) => w.yc)).toEqual([10, 50]);
	});

	it('renders a whisker for a row carrying BOTH Wilson bounds', () => {
		const rows = [row({ key: 'a', label: 'A', value: 44, wilsonLo: 31, wilsonHi: 57 })];
		const w = ciWhiskerGeometry(rows, xScale, yScale, domain);
		expect(w).toHaveLength(1);
		expect(w[0]).toEqual({ key: 'a', x0: 93, x1: 171, yc: 10 });
	});

	it('brackets the bar value: x0 (lo) ≤ value px ≤ x1 (hi)', () => {
		const rows = [row({ key: 'a', label: 'A', value: 44, wilsonLo: 31, wilsonHi: 57 })];
		const [only] = ciWhiskerGeometry(rows, xScale, yScale, domain);
		const valuePx = xScale(44);
		expect(only.x0).toBeLessThanOrEqual(valuePx);
		expect(only.x1).toBeGreaterThanOrEqual(valuePx);
	});

	it('draws NO whisker when EITHER bound is null (honest absence, tray entries)', () => {
		const rows = [
			row({ key: 'lo-only', label: 'A', wilsonLo: 20, wilsonHi: null }),
			row({ key: 'hi-only', label: 'B', wilsonLo: null, wilsonHi: 60 }),
			row({ key: 'neither', label: 'C', wilsonLo: null, wilsonHi: null }),
		];
		expect(ciWhiskerGeometry(rows, xScale, yScale, domain)).toEqual([]);
	});

	it('draws NO whisker when a bound is undefined (the field is simply absent)', () => {
		const rows = [row({ key: 'bare', label: 'A', value: 10 })];
		expect(ciWhiskerGeometry(rows, xScale, yScale, domain)).toEqual([]);
	});

	it('clamps a bound BELOW the domain to the low edge (never draws past the plot)', () => {
		const rows = [row({ key: 'a', label: 'A', wilsonLo: -20, wilsonHi: 40 })];
		const [only] = ciWhiskerGeometry(rows, xScale, yScale, domain);
		expect(only.x0).toBe(xScale(0));
		expect(only.x1).toBe(xScale(40));
	});

	it('clamps a bound ABOVE the domain to the high edge (never draws past the plot)', () => {
		const rows = [row({ key: 'a', label: 'A', wilsonLo: 60, wilsonHi: 250 })];
		const [only] = ciWhiskerGeometry(rows, xScale, yScale, domain);
		expect(only.x0).toBe(xScale(60));
		expect(only.x1).toBe(xScale(100));
	});

	it('keeps every resolved coord inside the clamped domain pixel range', () => {
		const rows = [
			row({ key: 'a', label: 'A', wilsonLo: -5, wilsonHi: 5 }),
			row({ key: 'b', label: 'B', wilsonLo: 95, wilsonHi: 120 }),
		];
		const loPx = xScale(domain[0]);
		const hiPx = xScale(domain[1]);
		for (const w of ciWhiskerGeometry(rows, xScale, yScale, domain)) {
			expect(w.x0).toBeGreaterThanOrEqual(loPx);
			expect(w.x1).toBeLessThanOrEqual(hiPx);
		}
	});

	it('filters out non-finite coords from a degenerate (pre-layout / jsdom) scale', () => {
		const nanX = (): number => NaN;
		const rows = [row({ key: 'a', label: 'A', wilsonLo: 31, wilsonHi: 57 })];
		expect(ciWhiskerGeometry(rows, nanX, yScale, domain)).toEqual([]);
	});

	it('uses the fallback center when a row key is absent from the band scale', () => {
		const rows = [row({ key: 'missing', label: 'A', wilsonLo: 10, wilsonHi: 20 })];
		const w = ciWhiskerGeometry(rows, xScale, yScale, domain);
		expect(w).toHaveLength(1);
		expect(w[0].yc).toBe(10);
	});

	it('handles a band scale with no bandwidth() (defaults to 0, yc === top)', () => {
		const noBw = ((key: string): number | undefined => bandTops[key]) as BandScale;
		const rows = [row({ key: 'b', label: 'B', wilsonLo: 10, wilsonHi: 20 })];
		const [only] = ciWhiskerGeometry(rows, xScale, noBw, domain);
		expect(only.yc).toBe(40);
	});
});
