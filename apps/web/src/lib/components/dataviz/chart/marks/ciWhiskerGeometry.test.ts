import { describe, it, expect } from 'vitest';
import { ciWhiskerGeometry, type BandScale } from './ciWhiskerGeometry';
import type { MagnitudeDatum } from '../ChartSpec';

// A 1:1 linear scale over the [0,100] domain into a 0..300px plot (3px per unit), so a bound's
// pixel is trivially `value * 3`. This lets each assertion read the geometry directly.
const xScale = (v: number): number => v * 3;
// A band scale: row → top px, constant 20px bandwidth → row centre at top + 10.
const bandTops: Record<string, number> = { A: 0, B: 40, C: 80 };
const yScale = ((label: string): number | undefined => bandTops[label]) as BandScale;
yScale.bandwidth = () => 20;

const domain = [0, 100] as const;

const row = (over: Partial<MagnitudeDatum> & { key: string; label: string }): MagnitudeDatum => ({
	value: 50,
	...over,
});

describe('ciWhiskerGeometry — the pure whisker geometry (D5 visual Wilson CI)', () => {
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
		expect(only.x0).toBe(xScale(0)); // -20 pinned to domain lo (0)
		expect(only.x1).toBe(xScale(40));
	});

	it('clamps a bound ABOVE the domain to the high edge (never draws past the plot)', () => {
		const rows = [row({ key: 'a', label: 'A', wilsonLo: 60, wilsonHi: 250 })];
		const [only] = ciWhiskerGeometry(rows, xScale, yScale, domain);
		expect(only.x0).toBe(xScale(60));
		expect(only.x1).toBe(xScale(100)); // 250 pinned to domain hi (100)
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

	it('drops a row whose label the band scale cannot place (unknown row → top undefined → yc 0 finite, so it still emits at 0)', () => {
		// A label the band scale does not know returns undefined; the helper coalesces to 0, which is
		// finite, so it still emits (centred at bandwidth/2). This documents that behaviour rather
		// than silently trusting it.
		const rows = [row({ key: 'a', label: 'ZZ', wilsonLo: 10, wilsonHi: 20 })];
		const w = ciWhiskerGeometry(rows, xScale, yScale, domain);
		expect(w).toHaveLength(1);
		expect(w[0].yc).toBe(10);
	});

	it('handles a band scale with no bandwidth() (defaults to 0, yc === top)', () => {
		const noBw = ((label: string): number | undefined => bandTops[label]) as BandScale;
		const rows = [row({ key: 'a', label: 'B', wilsonLo: 10, wilsonHi: 20 })];
		const [only] = ciWhiskerGeometry(rows, xScale, noBw, domain);
		expect(only.yc).toBe(40); // top of B, no bandwidth offset
	});
});
