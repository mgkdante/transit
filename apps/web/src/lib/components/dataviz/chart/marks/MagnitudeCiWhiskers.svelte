<!--
  MagnitudeCiWhiskers — the per-row 95% Wilson CI whisker for the §4 worst-stops magnitude bars
  (PR-WEB-5). A thin horizontal line from wilsonLo → wilsonHi with end caps, centered on each bar's
  band row, so the bar reads as the point estimate and the whisker as its uncertainty (a wide
  whisker on a small-n stop = "don't over-trust this rank"). The CI is already flipped onto the
  bar's (severe-rate) scale by the selector, so the whisker BRACKETS its bar honestly.

  Renders INSIDE LayerChart's <Svg> (the bars' plot group), reading the live x/y scales via
  getChartContext() — the per-row scale access the band-height bars don't expose otherwise. A row
  missing either bound draws NO whisker (honest absence, never a 0-length mark); degenerate scales
  (SSR / jsdom, zero-width plot) yield non-finite coords and are filtered out, so this never throws.
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';
	import type { MagnitudeDatum } from '../ChartSpec';

	export interface MagnitudeCiWhiskersProps {
		/** The rows to draw whiskers for (only those carrying BOTH Wilson bounds draw). */
		rows: readonly MagnitudeDatum[];
	}
	let { rows }: MagnitudeCiWhiskersProps = $props();

	const ctx = getChartContext();
	/** px half-height of the end caps (the vertical ticks at each bound). */
	const CAP = 4;

	// Per-row whisker geometry, recomputed reactively when the scales change (resize). x via the
	// SAME linear x-scale the bars use; y via the band scale's row centre. Filtered to finite coords
	// so a degenerate (pre-layout) scale never emits a NaN line.
	const whiskers = $derived(
		rows
			.filter((r) => r.wilsonLo != null && r.wilsonHi != null)
			.map((r) => {
				const xScale = ctx.xScale as (v: number) => number;
				const yScale = ctx.yScale as ((v: string) => number) & { bandwidth?: () => number };
				const top = yScale(r.label);
				const bw = typeof yScale.bandwidth === 'function' ? yScale.bandwidth() : 0;
				return {
					key: r.key,
					x0: xScale(r.wilsonLo as number),
					x1: xScale(r.wilsonHi as number),
					yc: (top ?? 0) + bw / 2,
				};
			})
			.filter((w) => Number.isFinite(w.x0) && Number.isFinite(w.x1) && Number.isFinite(w.yc)),
	);
</script>

{#each whiskers as w (w.key)}
	<g class="dv-ci-whisker" data-slot="ci-whisker" data-key={w.key} aria-hidden="true">
		<line x1={w.x0} x2={w.x1} y1={w.yc} y2={w.yc} class="dv-ci-line" />
		<line x1={w.x0} x2={w.x0} y1={w.yc - CAP} y2={w.yc + CAP} class="dv-ci-cap" />
		<line x1={w.x1} x2={w.x1} y1={w.yc - CAP} y2={w.yc + CAP} class="dv-ci-cap" />
	</g>
{/each}

<style>
	/* The CI reads as UNCERTAINTY, not a second magnitude: a thin neutral line + caps that stay
	   legible over every severity-coloured bar (watch/high/critical) and in both themes. */
	.dv-ci-line,
	.dv-ci-cap {
		stroke: var(--foreground);
		stroke-width: 1.5;
		opacity: 0.62;
		stroke-linecap: round;
	}
</style>
