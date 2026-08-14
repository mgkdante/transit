<!--
  ChartFrame — the measured, viewport-gated container every LayerChart mark renders into.

  WHY (S7 P1.4 pilot finding): LayerChart sizes itself by MEASURING its container (unlike
  the old viewBox SVG, which scales at any size). If a chart mounts inside a `display:none`
  tab panel — as the whole reliability surface does on the line-detail page — LayerChart
  measures 0×0 and does NOT recover when the tab is later shown. So the mark would stay an
  invisible 0×0 SVG forever.

  The fix: observe our size and viewport proximity, then render the chart only after the
  container has a real, non-zero box and first approaches the viewport. The viewport gate
  latches after entry, so scrolling never remounts a chart. A hidden tab still recovers when
  its box goes 0 → sized because the ResizeObserver remains active.

  Client-only by construction (observers in onMount). Without IntersectionObserver the
  size gate remains the eager fallback.
-->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { findScrollParent } from '$lib/components/shared/viewportPresence';
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
	let enteredViewport = $state(false);

	onMount(() => {
		if (!el) return;
		const node = el;
		const measure = () => {
			w = node.clientWidth;
			h = node.clientHeight;
		};
		const ro = new ResizeObserver(measure);
		ro.observe(node);
		measure();

		let io: IntersectionObserver | null = null;
		if (typeof IntersectionObserver === 'undefined') {
			enteredViewport = true;
		} else {
			io = new IntersectionObserver(
				([entry]) => {
					if (!entry?.isIntersecting) return;
					enteredViewport = true;
					io?.disconnect();
					io = null;
				},
				{
					root: findScrollParent(node),
					rootMargin: '200px 0px',
					threshold: 0,
				},
			);
			io.observe(node);
		}

		return () => {
			ro.disconnect();
			io?.disconnect();
		};
	});

	const ready = $derived(enteredViewport && w > 0 && h > 0);
</script>

<div
	bind:this={el}
	class={cn('chart-frame', className)}
	style:height
	style:--chart-frame-h={height}
	data-slot="chart-frame"
>
	{#if ready}{@render children?.()}{/if}
</div>

<style>
	.chart-frame {
		position: relative;
		width: 100%;
		/* CLS guard: reserve the plot box BEFORE the chart mounts. `height` fixes the box,
		   and `min-height` holds it even inside a flex/grid parent that would otherwise
		   collapse an empty child — so the chart popping in after hydration + the
		   createResource fetch never shifts the surrounding content. */
		min-height: var(--chart-frame-h);
	}
</style>
