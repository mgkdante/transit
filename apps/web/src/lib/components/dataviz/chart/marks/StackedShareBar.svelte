<!--
  StackedShareBar — the segment layer for StackedShareMark, rendered INSIDE the LayerChart
  <Svg> so it can scale each segment's [start,end] share through the chart context's linear
  x-scale (LayerChart geometry treats a numeric x as a raw pixel, so we scale here). One
  rect per band on the dataviz occupancy scale; the chart's band tooltipContext drives the SHARED
  LayerChart tooltip (the mark renders <Tooltip.Root> listing every band's share, the same hover
  face as every other mark), and the labelled legend + sr-only table carry the meaning for AT.
  Operator: colour only — no on-bar glyph (the dark glyph read as an ugly black mark on the strip).
-->
<script lang="ts">
	import { getChartContext } from 'layerchart';

	export interface ShareSeg {
		key: string;
		label: string;
		share: number;
		start: number;
		end: number;
		fill: string;
		/** Optional drill link (P5.2) — the band becomes a focusable SVG link. */
		href?: string;
	}
	let { segments }: { segments: readonly ShareSeg[] } = $props();

	const ctx = getChartContext();
	const h = $derived((ctx.height as number) ?? 0);
	const x = (v: number): number => (ctx.xScale(v) as number) ?? 0;
	const round = (v: number): number => Math.round(v);
</script>

{#each segments as s (s.key)}
	{@const x0 = x(s.start)}
	{@const x1 = x(s.end)}
	{#if s.href}
		<!-- SVG link: keyboard-focusable band that navigates (the legacy StackedBar's
		     onSelect was always a URL — the spec carries it as data, per MagnitudeDatum.href). -->
		<a href={s.href} aria-label={`${s.label}: ${round(s.share)}%`} class="dv-share-link">
			<rect
				class="dv-share-seg"
				data-occ={s.key}
				x={x0}
				y={0}
				width={Math.max(0, x1 - x0)}
				height={h}
				fill={s.fill}
			/>
		</a>
	{:else}
		<rect
			class="dv-share-seg"
			data-occ={s.key}
			x={x0}
			y={0}
			width={Math.max(0, x1 - x0)}
			height={h}
			fill={s.fill}
		/>
	{/if}
{/each}

<style>
	/* Focus ring for keyboard-reachable band links. --ring is an interactive
	   affordance (never a data mark) — doctrine-allow: interactive. */
	.dv-share-link:focus-visible rect {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
</style>
