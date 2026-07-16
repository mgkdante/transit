<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ChartViewportLayout } from './ChartSpec';

	export interface ChartViewportProps {
		layout: ChartViewportLayout;
		label: string;
		mobileMinWidth?: string;
		children?: Snippet;
	}

	let { layout, label, mobileMinWidth, children }: ChartViewportProps = $props();
	let viewport = $state<HTMLDivElement | null>(null);
	let scrollable = $state(false);
	let moreStart = $state(false);
	let moreEnd = $state(false);

	function measure(): void {
		const element = viewport;
		if (!element) return;
		const overflowX = getComputedStyle(element).overflowX;
		const scrollRange = element.scrollWidth - element.clientWidth;
		scrollable =
			layout === 'dense' && (overflowX === 'auto' || overflowX === 'scroll') && scrollRange > 1;
		moreStart = scrollable && element.scrollLeft > 1;
		moreEnd = scrollable && element.scrollLeft < scrollRange - 1;
	}

	$effect(() => {
		const element = viewport;
		if (!element) return;
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	});
</script>

<div
	class="chart-output"
	data-slot="chart-output"
	data-card-interactive
	data-chart-layout={layout}
	data-scrollable={scrollable}
	data-more-start={moreStart}
	data-more-end={moreEnd}
>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={viewport}
		class="chart-viewport"
		data-slot="chart-viewport"
		role={scrollable ? 'region' : undefined}
		aria-label={scrollable ? label : undefined}
		tabindex={scrollable ? 0 : undefined}
		onscroll={measure}
	>
		<div
			class="chart-canvas"
			data-slot="chart-canvas"
			style:--chart-mobile-min-width={mobileMinWidth}
		>
			{@render children?.()}
		</div>
	</div>
</div>

<style>
	.chart-output,
	.chart-viewport,
	.chart-canvas {
		min-width: 0;
	}

	.chart-output {
		position: relative;
		width: 100%;
		max-width: 100%;
	}

	.chart-viewport,
	.chart-canvas {
		width: 100%;
		max-width: 100%;
	}

	.chart-viewport {
		overflow: visible;
	}

	.chart-viewport:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.chart-output::before,
	.chart-output::after {
		content: '';
		position: absolute;
		inset-block: 0;
		width: 2rem;
		z-index: 1;
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-default);
	}

	.chart-output::before {
		inset-inline-start: 0;
		background: linear-gradient(to right, var(--card), transparent);
	}

	.chart-output::after {
		inset-inline-end: 0;
		background: linear-gradient(to left, var(--card), transparent);
	}

	.chart-output[data-more-start='true']::before,
	.chart-output[data-more-end='true']::after {
		opacity: 1;
	}

	@media (max-width: 1023px) {
		.chart-output[data-chart-layout='dense'] .chart-viewport {
			max-width: 100%;
			overflow-x: auto;
			overflow-y: hidden;
			scrollbar-width: thin;
			overscroll-behavior-inline: contain;
			touch-action: pan-x pan-y;
		}

		.chart-output[data-chart-layout='dense'] .chart-canvas {
			min-width: var(--chart-mobile-min-width, 48rem);
			max-width: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chart-output::before,
		.chart-output::after {
			transition: none;
		}
	}
</style>
