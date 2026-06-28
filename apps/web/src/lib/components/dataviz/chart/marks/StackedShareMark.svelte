<!--
  StackedShareMark — the LayerChart renderer for a `kind: 'stacked-share'` ChartSpec
  (A7/A9/A10, S7 P5). A single 100%-stacked horizontal proportion bar: each band's segment
  length IS its share of the whole on the dataviz scale (occupancy luminance / status). EXEMPT
  from the absolute-magnitude domain law (self-normalising to 100%). A per-segment <title> +
  an aria-label summary carry the read; an sr-only <table> is the accessible fallback. The
  glyph rides wide segments as a second channel; the caller pairs it with a labelled legend.
-->
<script lang="ts">
	import { Chart as LcChart, Svg } from 'layerchart';
	import { scaleLinear, scaleBand } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import StackedShareBar, { type ShareSeg, type ShareHover } from './StackedShareBar.svelte';
	import { occupancyVar, statusVar } from '$lib/components/dataviz/tokens';
	import type { StackedShareSpec } from '../ChartSpec';
	import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';

	export interface StackedShareMarkProps {
		spec: StackedShareSpec;
		class?: string;
	}
	let { spec, class: className }: StackedShareMarkProps = $props();

	const fillFor = (seg: StackedShareSpec['segments'][number]): string => {
		if (spec.scale === 'occupancy' && seg.occupancy)
			return occupancyVar(seg.occupancy as OccupancyCode);
		if (spec.scale === 'status' && seg.status) return statusVar(seg.status as StatusCode);
		return 'var(--muted)';
	};

	// Cumulative [start,end] offsets so each segment renders at its place in the 100% strip.
	const segs = $derived.by<ShareSeg[]>(() => {
		let offset = 0;
		return spec.segments.map((s) => {
			const start = offset;
			offset += s.share;
			return {
				key: s.key,
				label: s.label,
				share: s.share,
				start,
				end: offset,
				fill: fillFor(s),
			};
		});
	});

	const round = (v: number): number => Math.round(v);
	const summary = $derived(spec.segments.map((s) => `${s.label} ${round(s.share)}%`).join(', '));

	// The segment under the pointer (band + share + pixel centre), driving the styled hover readout.
	let hovered = $state<ShareHover | null>(null);
</script>

<figure
	class={cn('dv-share-mark m-0', className)}
	aria-label={`${spec.title}: ${summary}`}
	data-slot="stacked-share-mark"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="dv-share-track" onpointerleave={() => (hovered = null)}>
		<ChartFrame height="0.875rem" class="dv-share-plot">
			<LcChart
				data={segs}
				x={(d: ShareSeg) => d.start}
				xScale={scaleLinear()}
				xDomain={[0, 100]}
				y={() => ''}
				yScale={scaleBand()}
				yDomain={['']}
				padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
			>
				<Svg>
					<StackedShareBar segments={segs} onhover={(h) => (hovered = h)} />
				</Svg>
			</LcChart>
		</ChartFrame>
		{#if hovered}
			<div class="dv-share-tip" data-slot="share-tip" role="status" style="left: {hovered.cx}px;">
				{hovered.label} · {round(hovered.share)}%
			</div>
		{/if}
	</div>

	<!-- AT fallback: each band's share as a row (the colour read in words). -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<tbody>
			{#each spec.segments as s (s.key)}
				<tr><th scope="row">{s.label}</th><td>{round(s.share)}%</td></tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	/* Crisp 1px segment dividers so adjacent bands read apart by colour alone (no glyph) —
	   the labelled legend + the hover readout carry the meaning. */
	:global(rect.dv-share-seg) {
		stroke: var(--card);
		stroke-width: 1;
	}
	/* The positioning context for the styled hover readout (cx is a plot-pixel offset; the
	   plot has zero padding so it maps straight onto this track). */
	.dv-share-track {
		position: relative;
	}
	/* The styled per-segment tooltip — the same hover face as every other chart, centred over
	   the hovered band and floated just above the strip. */
	.dv-share-tip {
		position: absolute;
		bottom: calc(100% + 4px);
		transform: translateX(-50%);
		white-space: nowrap;
		pointer-events: none;
		z-index: 2;
		padding: 0.2rem 0.45rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--popover-foreground, var(--foreground));
		background: var(--popover, var(--card));
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 0.4rem);
		box-shadow: var(--shadow-sm, 0 1px 3px rgb(0 0 0 / 0.2));
	}
</style>
