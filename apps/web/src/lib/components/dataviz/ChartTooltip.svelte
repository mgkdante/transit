<!--
  ChartTooltip — presentational HTML overlay for chart hover/focus tooltips.

  The chart <svg> is passed as `children` and rendered inside a position:relative
  wrapper that hosts the pointer handlers. The tip itself is PORTALED to <body>
  as a position:FIXED layer (NOT an in-wrapper absolute box): that frees it from
  every ancestor's overflow/clip and from the wrapper's width, so it keeps its
  natural size and is anchored in VIEWPORT coordinates instead. pointer-events:none
  so it never eats the pointer events that drive it.

  State lives in `createChartTooltip()` (useChartTooltip.svelte.ts); this is the
  dumb renderer — spread the controller onto it. On open it measures itself
  against the VIEWPORT (getBoundingClientRect) and FLIPS the side / SHIFTS the
  horizontal offset so the box stays on screen. It REPOSITIONS, never shrinks.

  Doctrine: surface tokens only (--popover / --border-strong / --shadow-card);
  NO --primary anywhere in the tooltip (it is not interactive chrome). The fade
  is ~80ms and is gated on !prefersReducedMotion.current (snaps when reduced).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Portal } from 'bits-ui';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import type { ChartTooltipRow, ChartTooltipSide } from './useChartTooltip.svelte';

	export interface ChartTooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		/** Whether the tooltip is shown. */
		open: boolean;
		/** Horizontal anchor as a percentage [0,100] of the wrapper width. */
		xPct: number;
		/** Vertical anchor as a percentage [0,100] of the wrapper height. */
		yPct: number;
		/** Optional heading line (x-axis category / timestamp). */
		heading?: string;
		/** Body rows (swatch + label + value). */
		rows: ChartTooltipRow[];
		/** Preferred side; auto-flips on open to stay in bounds. Default 'top'. */
		side?: ChartTooltipSide;
		/** Stable DOM id (from the controller) for aria wiring. */
		id: string;
		/** The chart <svg> (or any chart markup) the tooltip overlays. */
		children: Snippet;
		class?: string;
	}

	let {
		open,
		xPct,
		yPct,
		heading,
		rows,
		side = 'top',
		id,
		children,
		class: className,
		...rest
	}: ChartTooltipProps = $props();

	// Gap between the box and its anchor point, and the minimum margin we keep
	// from the viewport edge when shifting the box back on-screen.
	const GAP = 8;
	const EDGE = 8;

	// The resolved side after flip, and the box's final viewport coordinates
	// (left/top in px). Driven by the measuring $effect below.
	let resolvedSide = $state<ChartTooltipSide>('top');
	let fixedLeft = $state(0);
	let fixedTop = $state(0);
	// Whether we have a measured position yet (suppresses a one-frame flash at 0,0).
	let placed = $state(false);

	let wrapEl = $state<HTMLDivElement | null>(null);
	let tipEl = $state<HTMLDivElement | null>(null);

	// Per-side base transform: the box is laid out at (left,top) = the anchor's
	// VIEWPORT point, then translated so the chosen edge meets the anchor with a
	// GAP. `top`/`bottom` centre horizontally; `left`/`right` centre vertically.
	const TRANSFORMS: Record<ChartTooltipSide, string> = {
		top: `translate(-50%, calc(-100% - ${GAP}px))`,
		bottom: `translate(-50%, ${GAP}px)`,
		left: `translate(calc(-100% - ${GAP}px), -50%)`,
		right: `translate(${GAP}px, -50%)`,
	};

	const transform = $derived(TRANSFORMS[resolvedSide]);

	// On open, measure against the VIEWPORT: map the wrapper-relative anchor (xPct,
	// yPct) to a viewport point, flip top/bottom if the preferred side would clip,
	// and SHIFT left/top so the natural-width box stays on screen. It repositions,
	// never shrinks. Re-runs whenever the anchor / content changes.
	$effect(() => {
		if (!open) {
			resolvedSide = side;
			placed = false;
			return;
		}
		// Read reactive deps so the effect re-runs when the anchor/content moves.
		void xPct;
		void yPct;
		void rows;
		void heading;

		const wrap = wrapEl;
		const tip = tipEl;
		if (!wrap || !tip) {
			resolvedSide = side;
			return;
		}

		const wb = wrap.getBoundingClientRect();
		const tb = tip.getBoundingClientRect();
		if (wb.width === 0 || wb.height === 0) {
			resolvedSide = side;
			return;
		}

		const vw = typeof window !== 'undefined' ? window.innerWidth : wb.right;
		const vh = typeof window !== 'undefined' ? window.innerHeight : wb.bottom;

		// Anchor point in VIEWPORT coordinates.
		const anchorX = wb.left + (xPct / 100) * wb.width;
		const anchorY = wb.top + (yPct / 100) * wb.height;

		// Vertical flip for top/bottom: if the preferred side overflows that edge
		// of the viewport but the opposite side fits, flip.
		let next = side;
		if (
			side === 'top' &&
			anchorY - tb.height - GAP < EDGE &&
			anchorY + tb.height + GAP <= vh - EDGE
		) {
			next = 'bottom';
		} else if (
			side === 'bottom' &&
			anchorY + tb.height + GAP > vh - EDGE &&
			anchorY - tb.height - GAP >= EDGE
		) {
			next = 'top';
		}
		resolvedSide = next;

		// Place the box at the anchor point, then shift it back on-screen. The CSS
		// transform centres/offsets the box around (anchorX, anchorY); we compute
		// the box's resulting edges and nudge (anchorX, anchorY) so those edges sit
		// within [EDGE, viewport - EDGE]. Width/height never change.
		let left = anchorX;
		const top = anchorY;

		if (next === 'top' || next === 'bottom') {
			// Box is horizontally centred on `left`.
			const half = tb.width / 2;
			const minLeft = EDGE + half;
			const maxLeft = vw - EDGE - half;
			// When the box is wider than the viewport, centre it (min wins ≥ max).
			left = maxLeft >= minLeft ? Math.min(Math.max(left, minLeft), maxLeft) : vw / 2;
		} else {
			// Box sits to the left/right of `left` (its inner edge is GAP from it).
			const minLeft = next === 'right' ? EDGE - GAP : EDGE + tb.width + GAP;
			const maxLeft = next === 'right' ? vw - EDGE - tb.width - GAP : vw - EDGE + GAP;
			left = maxLeft >= minLeft ? Math.min(Math.max(left, minLeft), maxLeft) : left;
		}

		fixedLeft = left;
		fixedTop = top;
		placed = true;
	});

	const animate = $derived(!prefersReducedMotion.current);
</script>

<div
	bind:this={wrapEl}
	class={cn('chart-tooltip-wrap', className)}
	data-slot="chart-tooltip-wrap"
	{...rest}
>
	{@render children()}
</div>

<!-- Portaled to <body>: a fixed-position layer immune to ancestor overflow/clip
     and to the wrapper's width. Anchored in viewport coordinates. -->
<Portal>
	<div
		bind:this={tipEl}
		{id}
		role="tooltip"
		class="chart-tooltip"
		class:chart-tooltip--open={open && placed}
		class:chart-tooltip--animate={animate}
		aria-hidden={!open}
		style="left: {fixedLeft}px; top: {fixedTop}px; transform: {transform};"
	>
		{#if heading}
			<p class="chart-tooltip__heading">{heading}</p>
		{/if}
		{#if rows.length}
			<ul class="chart-tooltip__rows">
				{#each rows as row, i (row.label + '-' + i)}
					<li class="chart-tooltip__row">
						{#if row.colorVar}
							<span
								class="chart-tooltip__swatch"
								style="background: {row.colorVar};"
								aria-hidden="true"
							></span>
						{/if}
						<span class="chart-tooltip__label">{row.label}</span>
						<span class="chart-tooltip__value">{row.value}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Portal>

<style>
	.chart-tooltip-wrap {
		position: relative;
	}

	.chart-tooltip {
		position: fixed;
		z-index: var(--z-nav);
		pointer-events: none;
		/* Cap only so a box never exceeds the viewport on tiny screens; on normal
		   screens the content's natural width wins. It REPOSITIONS, never shrinks. */
		max-width: min(16rem, calc(100vw - 16px));
		padding: 6px 8px;
		background: var(--popover);
		color: var(--popover-foreground);
		border: 1px solid var(--border-strong, var(--border));
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-card);
		opacity: 0;
	}

	.chart-tooltip--open {
		opacity: 1;
	}

	.chart-tooltip--animate {
		transition: opacity 80ms ease-out;
	}

	.chart-tooltip__heading {
		margin: 0 0 4px;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}

	.chart-tooltip__rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.chart-tooltip__row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.chart-tooltip__swatch {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: var(--radius-sm);
	}

	.chart-tooltip__label {
		font-size: var(--text-caption);
		color: var(--foreground);
	}

	.chart-tooltip__value {
		margin-inline-start: auto;
		padding-inline-start: 8px;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-caption);
		color: var(--foreground);
	}
</style>
