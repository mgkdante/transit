<!--
  ChartFrame — the measured, visibility-gated container every LayerChart mark renders into.

  WHY (S7 P1.4 pilot finding): LayerChart sizes itself by MEASURING its container (unlike
  the old viewBox SVG, which scales at any size). If a chart mounts inside a `display:none`
  tab panel — as the whole reliability surface does on the line-detail page — LayerChart
  measures 0×0 and does NOT recover when the tab is later shown. So the mark would stay an
  invisible 0×0 SVG forever.

  The fix: observe our own size and only render the chart (the `children`) once the
  container has a real, non-zero box. When a hidden tab becomes visible the box goes
  0 → sized, the ResizeObserver fires, and the chart mounts FRESH while visible — it
  measures correctly. Bonus: charts in inactive tabs never mount at all (lazy).

  Client-only by construction (ResizeObserver in onMount); charts already render only
  under the createResource/ResourceBoundary client boundary, so SSR shows the skeleton.
-->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface ChartFrameProps {
		/** Plot height (any CSS length). Width is fluid (100%). */
		height?: string;
		class?: string;
		children?: Snippet;
	}

	let { height = '7.5rem', class: className, children }: ChartFrameProps = $props();

	let el = $state<HTMLDivElement | null>(null);
	let w = $state(0);
	let h = $state(0);

	onMount(() => {
		if (!el) return;
		const measure = () => {
			if (el) {
				w = el.clientWidth;
				h = el.clientHeight;
			}
		};
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		measure();
		return () => ro.disconnect();
	});

	const ready = $derived(w > 0 && h > 0);
</script>

<div bind:this={el} class={cn('chart-frame', className)} style:height data-slot="chart-frame">
	{#if ready}{@render children?.()}{/if}
</div>

<style>
	.chart-frame {
		position: relative;
		width: 100%;
	}
</style>
