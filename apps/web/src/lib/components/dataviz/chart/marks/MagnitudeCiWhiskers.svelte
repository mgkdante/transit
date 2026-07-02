<!--
  MagnitudeCiWhiskers — the per-row 95% Wilson CI whisker for the §4 worst-stops magnitude bars
  (PR-WEB-5). A thin horizontal line from wilsonLo → wilsonHi with end caps, centered on each bar's
  band row, so the bar reads as the point estimate and the whisker as its uncertainty (a wide
  whisker on a small-n stop = "don't over-trust this rank"). The CI is already flipped onto the
  bar's (severe-rate) scale by the selector, so the whisker BRACKETS its bar honestly.

  Renders INSIDE LayerChart's <Svg> (the bars' plot group), reading the live x/y scales via
  getChartContext() — the per-row scale access the band-height bars don't expose otherwise. The
  geometry (both-bounds gate, clamp-to-domain, non-finite filter) is the pure ciWhiskerGeometry()
  helper so those invariants stay unit-testable off jsdom's zero-width plot. A row missing either
  bound draws NO whisker (honest absence, never a 0-length mark); a bound outside the spec domain
  clamps to the axis edge (like the bar); degenerate scales (SSR / jsdom) yield non-finite coords
  and are filtered out, so this never throws.
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';
	import type { MagnitudeDatum } from '../ChartSpec';
	import { ciWhiskerGeometry, type LinearScale, type BandScale } from './ciWhiskerGeometry';

	export interface MagnitudeCiWhiskersProps {
		/** The rows to draw whiskers for (only those carrying BOTH Wilson bounds draw). */
		rows: readonly MagnitudeDatum[];
		/** The mark's absolute [lo,hi] domain — each bound is clamped to it (like the bar). */
		domain: readonly [number, number];
	}
	let { rows, domain }: MagnitudeCiWhiskersProps = $props();

	const ctx = getChartContext();
	/** px half-height of the end caps (the vertical ticks at each bound). */
	const CAP = 4;

	// Per-row whisker geometry, recomputed reactively when the scales change (resize). The pure
	// helper does the both-bounds gate, the clamp to the spec domain, and the non-finite filter.
	const whiskers = $derived(
		ciWhiskerGeometry(rows, ctx.xScale as LinearScale, ctx.yScale as BandScale, domain),
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
