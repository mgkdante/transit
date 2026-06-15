<!--
  ChartTooltip — presentational HTML overlay for chart hover/focus tooltips.

  An HTML overlay (NOT an SVG <foreignObject>): the chart <svg> is passed as
  `children` and rendered inside a position:relative wrapper; the tooltip is an
  absolutely-positioned <div role="tooltip"> placed at (xPct, yPct) % of the
  wrapper, transformed per `side`. pointer-events:none so it never eats the
  pointer events that drive it.

  State lives in `createChartTooltip()` (useChartTooltip.svelte.ts); this is the
  dumb renderer — spread the controller onto it. On open it measures itself
  against the wrapper (getBoundingClientRect) and FLIPS the side / CLAMPS the
  horizontal offset so the box never leaves the wrapper bounds.

  Doctrine: surface tokens only (--popover / --border-strong / --shadow-card);
  NO --primary anywhere in the tooltip (it is not interactive chrome). The fade
  is ~80ms and is gated on !prefersReducedMotion.current (snaps when reduced).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
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

	// The resolved side after flip. Seeded to the literal default; the measuring
	// $effect below syncs it to the `side` prop (and any flip) on every run, so
	// it never needs to capture the prop's initial value here.
	let resolvedSide = $state<ChartTooltipSide>('top');
	// Horizontal nudge (px) applied on top of the side transform to clamp into bounds.
	let clampX = $state(0);

	let wrapEl = $state<HTMLDivElement | null>(null);
	let tipEl = $state<HTMLDivElement | null>(null);

	// Per-side base transform. `top`/`bottom` centre horizontally; `left`/`right`
	// centre vertically. An 8px gap separates the box from the anchor.
	const TRANSFORMS: Record<ChartTooltipSide, string> = {
		top: 'translate(-50%, calc(-100% - 8px))',
		bottom: 'translate(-50%, 8px)',
		left: 'translate(calc(-100% - 8px), -50%)',
		right: 'translate(8px, -50%)',
	};

	const transform = $derived(
		clampX !== 0 ? `${TRANSFORMS[resolvedSide]} translateX(${clampX}px)` : TRANSFORMS[resolvedSide],
	);

	// On open, measure against the wrapper: flip vertically if the preferred
	// top/bottom side would overflow, and clamp the horizontal offset so the box
	// stays inside the wrapper. Runs whenever open / position / content changes.
	$effect(() => {
		if (!open) {
			resolvedSide = side;
			clampX = 0;
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
			clampX = 0;
			return;
		}

		const anchorX = (xPct / 100) * wb.width;
		const anchorY = (yPct / 100) * wb.height;

		// Vertical flip for top/bottom: if the preferred side overflows that edge
		// but the opposite side fits, flip.
		let next = side;
		if (side === 'top' && anchorY - tb.height - 8 < 0 && anchorY + tb.height + 8 <= wb.height) {
			next = 'bottom';
		} else if (
			side === 'bottom' &&
			anchorY + tb.height + 8 > wb.height &&
			anchorY - tb.height - 8 >= 0
		) {
			next = 'top';
		}
		resolvedSide = next;

		// Horizontal clamp for top/bottom (box is centred on the anchor): keep the
		// half-width inside [0, wrapWidth]. For left/right the box is to the side,
		// so no horizontal clamp is applied.
		if (next === 'top' || next === 'bottom') {
			const half = tb.width / 2;
			const left = anchorX - half;
			const right = anchorX + half;
			if (left < 0) clampX = -left;
			else if (right > wb.width) clampX = wb.width - right;
			else clampX = 0;
		} else {
			clampX = 0;
		}
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

	<div
		bind:this={tipEl}
		{id}
		role="tooltip"
		class="chart-tooltip"
		class:chart-tooltip--open={open}
		class:chart-tooltip--animate={animate}
		aria-hidden={!open}
		style="left: {xPct}%; top: {yPct}%; transform: {transform};"
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
</div>

<style>
	.chart-tooltip-wrap {
		position: relative;
	}

	.chart-tooltip {
		position: absolute;
		z-index: 20;
		pointer-events: none;
		max-width: 16rem;
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
