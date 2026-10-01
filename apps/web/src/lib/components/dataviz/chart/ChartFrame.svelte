<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface ChartFrameProps {
		height?: string;
		class?: string;
		children?: Snippet;
	}

	let { height = '7.5rem', class: className, children }: ChartFrameProps = $props();

	let el = $state<HTMLDivElement | null>(null);
	let hasSize = $state(false);
	let enteredViewport = $state(false);

	onMount(() => {
		if (!el) return;
		const node = el;
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return;
			hasSize = entry.contentRect.width > 0 && entry.contentRect.height > 0;
		});
		ro.observe(node);

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
					root: node.closest('#main'),
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

	const ready = $derived(enteredViewport && hasSize);
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
		min-height: var(--chart-frame-h);
	}
</style>
