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
	import StackedShareBar, { type ShareSeg } from './StackedShareBar.svelte';
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
				glyph: s.glyph ?? '',
			};
		});
	});

	const round = (v: number): number => Math.round(v);
	const summary = $derived(spec.segments.map((s) => `${s.label} ${round(s.share)}%`).join(', '));
</script>

<figure
	class={cn('dv-share-mark m-0', className)}
	aria-label={`${spec.title}: ${summary}`}
	data-slot="stacked-share-mark"
>
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
				<StackedShareBar segments={segs} />
			</Svg>
		</LcChart>
	</ChartFrame>

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
	:global(rect.dv-share-seg) {
		stroke: var(--card);
		stroke-width: 0.5;
	}
	/* The fill glyph (occupancy ▁▃▅▇█) on a wide segment — a second channel beside hue.
	   Quiet, paired with the labelled legend the caller renders. */
	.dv-share-glyph {
		fill: var(--background);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		opacity: 0.7;
		pointer-events: none;
	}
</style>
