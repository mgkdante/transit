<!--
  ScrollFrame — a horizontally-scrollable plot with a FROZEN left gutter (the row axis/labels),
  for a chart too wide for a phone (the §1 7×24 heatmap). The category labels stay PINNED while
  the plot scrolls, so a rider never loses which row is which mid-scroll. Soft scroll-edge shadows
  hint "there's more →"; the scroller is keyboard-focusable + labelled for assistive tech.

  Layout-only: the consumer supplies the `gutter` (the pinned axis column) and the `scroller` (the
  wide plot) as snippets. Both must share the SAME row band layout (height + top/bottom padding) so
  the gutter labels line up with the plot rows. On a viewport wide enough for the whole plot the
  scroller simply doesn't overflow and both edge shadows stay off (no fake affordance). The shadows
  are pure overlays (never mask the data cells), reduced-motion-guarded.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface ScrollFrameProps {
		/** Width of the frozen left gutter (the axis column). Any CSS length. */
		gutterWidth?: string;
		/** a11y label for the scroll region (e.g. "Scroll sideways to see every hour"). */
		scrollLabel: string;
		class?: string;
		/** The pinned axis column (row labels). Aligned to the scroller's rows by the consumer. */
		gutter: Snippet;
		/** The wide, horizontally-scrollable plot (cells + value axis). */
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
	// Default both OFF so a non-overflowing plot shows no shadow (and SSR is shadow-free).
	let moreStart = $state(false);
	let moreEnd = $state(false);

	function measure(): void {
		const el = scrollEl;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		scrollable = max > 1;
		moreStart = scrollable && el.scrollLeft > 1;
		moreEnd = scrollable && el.scrollLeft < max - 1;
	}

	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		measure();
		if (typeof ResizeObserver === 'undefined') return;
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
	<!-- A real horizontal overflow becomes keyboard-operable; a fitting grid stays out of the
	     tab order and does not advertise a fake scroll region. -->
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
	/* The frozen axis column: fixed width, never scrolls, aligns row-for-row with the scroller. */
	.dv-scrollframe__gutter {
		flex: 0 0 var(--sf-gutter);
		width: var(--sf-gutter);
		min-width: var(--sf-gutter);
	}
	/* The wide plot scrolls horizontally; keyboard-focusable so it's reachable without a pointer. */
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
	/* Soft edge shadows = a "there's more to scroll" affordance, overlaid (never clip the data) and
	   shown ONLY on the side with hidden content (toggled by data-more-start / data-more-end). */
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
