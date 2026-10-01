<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface ScrollFrameProps {
		gutterWidth?: string;
		scrollLabel: string;
		class?: string;
		gutter: Snippet;
		scroller: Snippet;
	}

	let {
		gutterWidth = '3rem',
		scrollLabel,
		class: className,
		gutter,
		scroller,
	}: ScrollFrameProps = $props();

	let scrollEl = $state<HTMLDivElement | null>(null);
	let scrollable = $state(false);
	let moreStart = $state(false);
	let moreEnd = $state(false);

	function measure(): void {
		const el = scrollEl;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		const canScroll = max > 1;
		scrollable = canScroll;
		moreStart = canScroll && el.scrollLeft > 1;
		moreEnd = canScroll && el.scrollLeft < max - 1;
	}

	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		if (typeof ResizeObserver === 'undefined') {
			measure();
			return;
		}
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		if (el.firstElementChild) ro.observe(el.firstElementChild);
		return () => ro.disconnect();
	});
</script>

<div
	class={cn('dv-scrollframe', className)}
	style:--sf-gutter={gutterWidth}
	data-slot="scroll-frame"
	data-card-interactive
	data-scrollable={scrollable}
	data-more-start={moreStart}
	data-more-end={moreEnd}
>
	<div class="dv-scrollframe__gutter" data-slot="scroll-frame-gutter" aria-hidden="true">
		{@render gutter()}
	</div>
	<!-- Only overflow enters the tab order. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={scrollEl}
		class="dv-scrollframe__scroller"
		data-slot="scroll-frame-scroller"
		role={scrollable ? 'region' : undefined}
		aria-label={scrollable ? scrollLabel : undefined}
		tabindex={scrollable ? 0 : undefined}
		onscroll={measure}
	>
		{@render scroller()}
	</div>
</div>

<style>
	.dv-scrollframe {
		position: relative;
		display: flex;
		align-items: stretch;
		width: 100%;
	}
	.dv-scrollframe__gutter {
		flex: 0 0 var(--sf-gutter);
		width: var(--sf-gutter);
		min-width: var(--sf-gutter);
	}
	.dv-scrollframe__scroller {
		flex: 1 1 auto;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: thin;
	}
	.dv-scrollframe__scroller:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.dv-scrollframe::before,
	.dv-scrollframe::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1.25rem;
		pointer-events: none;
		opacity: 0;
		z-index: 1;
		transition: opacity var(--duration-fast) var(--ease-default);
	}
	.dv-scrollframe::before {
		left: var(--sf-gutter);
		background: linear-gradient(
			to right,
			color-mix(in oklab, var(--foreground) 16%, transparent),
			transparent
		);
	}
	.dv-scrollframe::after {
		right: 0;
		background: linear-gradient(
			to left,
			color-mix(in oklab, var(--foreground) 16%, transparent),
			transparent
		);
	}
	.dv-scrollframe[data-more-start='true']::before {
		opacity: 1;
	}
	.dv-scrollframe[data-more-end='true']::after {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.dv-scrollframe::before,
		.dv-scrollframe::after {
			transition: none;
		}
	}
</style>
