// ciWhiskerGeometry.ts — the PURE geometry for the per-row Wilson 95% CI whisker drawn on a
// `kind: 'magnitude-bars'` mark (D5, S10; the visual whisker first shipped in PR-WEB-5).
//
// WHY A PURE HELPER (data project, no DOM): the whisker lives inside LayerChart's <Svg> and
// reads the live x/y scales via getChartContext(). In jsdom those scales report a zero-width
// plot, so the rendered <g> collapses to nothing and can't be asserted on. Lifting the geometry
// out (the axisGutter.ts precedent) lets the invariants be unit-tested against mock scales: the
// both-bounds gate (honest absence, never a 0-length mark), the clamp to the spec domain (a
// bound outside [lo,hi] pins to the edge like the bar, never draws past the plot), the value
// bracket, and the non-finite filter (degenerate SSR / jsdom scales emit no NaN line).

import type { MagnitudeDatum } from '../ChartSpec';

/** A linear value → pixel scale (LayerChart's xScale). */
export type LinearScale = (v: number) => number;
/** A band label → pixel scale with an optional bandwidth (LayerChart's yScale). */
export type BandScale = ((label: string) => number | undefined) & { bandwidth?: () => number };

/** One resolved whisker: a horizontal line [x0,x1] at row-centre `yc`, plus the caps' half-height. */
export interface CiWhisker {
	readonly key: string;
	/** Pixel x of the (clamped) lower bound. */
	readonly x0: number;
	/** Pixel x of the (clamped) upper bound. */
	readonly x1: number;
	/** Pixel y of the row's band centre. */
	readonly yc: number;
}

/** Clamp a value to the closed spec domain so a bound outside it pins to the axis edge (like the bar). */
const clampToDomain = (v: number, domain: readonly [number, number]): number => {
	const lo = Math.min(domain[0], domain[1]);
	const hi = Math.max(domain[0], domain[1]);
	return v < lo ? lo : v > hi ? hi : v;
};

/**
 * Resolve the per-row whisker geometry for the rows that carry BOTH Wilson bounds.
 *
 * A row missing either bound draws NO whisker (honest absence). Each bound is clamped to the
 * spec `domain` before the x-scale, so a CI wider than the axis pins to the edge instead of
 * drawing past the plot. Rows whose resolved coords are non-finite (a degenerate pre-layout
 * scale) are dropped, so this never emits a NaN line.
 */
export function ciWhiskerGeometry(
	rows: readonly MagnitudeDatum[],
	xScale: LinearScale,
	yScale: BandScale,
	domain: readonly [number, number],
): CiWhisker[] {
	const bw = typeof yScale.bandwidth === 'function' ? yScale.bandwidth() : 0;
	return rows
		.filter((r) => r.wilsonLo != null && r.wilsonHi != null)
		.map((r) => {
			const top = yScale(r.label);
			return {
				key: r.key,
				x0: xScale(clampToDomain(r.wilsonLo as number, domain)),
				x1: xScale(clampToDomain(r.wilsonHi as number, domain)),
				yc: (top ?? 0) + bw / 2,
			};
		})
		.filter((w) => Number.isFinite(w.x0) && Number.isFinite(w.x1) && Number.isFinite(w.yc));
}
