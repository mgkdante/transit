<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Portal } from 'bits-ui';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import type { ChartTooltipRow, ChartTooltipSide } from './useChartTooltip.svelte';

	export interface ChartTooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		open: boolean;
		xPct: number;
		yPct: number;
		heading?: string;
		rows: ChartTooltipRow[];
		side?: ChartTooltipSide;
		id: string;
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

	const GAP = 8;
	const EDGE = 8;

	let resolvedSide = $state<ChartTooltipSide>('top');
	let fixedLeft = $state(0);
	let fixedTop = $state(0);
	let placed = $state(false);

	let wrapEl = $state<HTMLDivElement | null>(null);
	let tipEl = $state<HTMLDivElement | null>(null);

	const TRANSFORMS: Record<ChartTooltipSide, string> = {
		top: `translate(-50%, calc(-100% - ${GAP}px))`,
		bottom: `translate(-50%, ${GAP}px)`,
		left: `translate(calc(-100% - ${GAP}px), -50%)`,
		right: `translate(${GAP}px, -50%)`,
	};

	const transform = $derived(TRANSFORMS[resolvedSide]);

	$effect(() => {
		if (!open) {
			resolvedSide = side;
			placed = false;
			return;
		}
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

		const anchorX = wb.left + (xPct / 100) * wb.width;
		const anchorY = wb.top + (yPct / 100) * wb.height;

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

		let left = anchorX;
		const top = anchorY;

		if (next === 'top' || next === 'bottom') {
			const half = tb.width / 2;
			const minLeft = EDGE + half;
			const maxLeft = vw - EDGE - half;
			left = maxLeft >= minLeft ? Math.min(Math.max(left, minLeft), maxLeft) : vw / 2;
		} else {
			const minLeft = next === 'right' ? EDGE - GAP : EDGE + tb.width + GAP;
			const maxLeft = next === 'right' ? vw - EDGE - tb.width - GAP : vw - EDGE + GAP;
			left = maxLeft >= minLeft ? Math.min(Math.max(left, minLeft), maxLeft) : left;
		}

		fixedLeft = left;
		fixedTop = top;
		placed = true;
	});

	const animate = $derived(!$prefersReducedMotion);
</script>

<div
	bind:this={wrapEl}
	class={cn('chart-tooltip-wrap', className)}
	data-slot="chart-tooltip-wrap"
	{...rest}
>
	{@render children()}
</div>

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
		transition: opacity var(--duration-instant) var(--ease-out);
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
